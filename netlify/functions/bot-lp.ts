import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  console.log('Bot LP Handler Started');
  
  try {
    // 1. Environment Variable Check
    const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.VITE_DISCORD_BOT_TOKEN;
    const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || process.env.VITE_DISCORD_GUILD_ID;
    const DISCORD_STUDIO_CHANNEL_ID = process.env.DISCORD_STUDIO_CHANNEL_ID || process.env.VITE_DISCORD_STUDIO_CHANNEL_ID;
    const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID;

    if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_STUDIO_CHANNEL_ID || !DISCORD_CLIENT_ID) {
      console.error('Server configuration error: Missing Discord Bot Token, Guild ID, Channel ID, or Client ID');
      const missing = [];
      if (!DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN');
      if (!DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID');
      if (!DISCORD_STUDIO_CHANNEL_ID) missing.push('DISCORD_STUDIO_CHANNEL_ID');
      if (!DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
      
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Server configuration error', 
          details: `Missing variables: ${missing.join(', ')}` 
        })
      };
    }

    // 2. Define Helper Functions (capturing env vars)
    const fetchDiscordAPI = async (endpoint: string, method: string = 'GET', body?: any) => {
      const url = `https://discord.com/api/v10${endpoint}`;
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      
      // console.log(`Fetching Discord API: ${method} ${endpoint}`);
      const response = await fetch(url, options);
      if (!response.ok && response.status !== 204) {
        const text = await response.text();
        console.error(`Discord API Error on ${method} ${endpoint}:`, text);
        throw new Error(`Discord API Error: ${response.statusText} - ${text}`);
      }
      return response.status === 204 ? null : await response.json();
    };

    const getUserLedgerData = async (discordUserId: string) => {
      let lp = 0;
      let lastLoginTime = 0;
      let foundLp = false;
      let foundLogin = false;
      let lastMessageId = undefined;
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const startTime = Date.now();

      while (true) {
        // Stop if we take too long to prevent Netlify function timeout (10s max)
        if (Date.now() - startTime > 8500) {
          console.warn(`Timeout reached while searching ledger for user ${discordUserId}.`);
          break;
        }

        const query = lastMessageId ? `?limit=100&before=${lastMessageId}` : '?limit=100';
        const messages = await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages${query}`);
        if (!messages || messages.length === 0) break;

        for (const msg of messages) {
          // Verify that this message was posted by our specific Bot ID to prevent spoofing
          if (msg.author.id !== DISCORD_CLIENT_ID) continue;

          if (!foundLp && msg.content.includes(`[LP_LEDGER] | USER:${discordUserId}`)) {
            const match = msg.content.match(/TOTAL:(\d+)/);
            if (match && match[1]) {
              lp = parseInt(match[1], 10);
              foundLp = true;
            }
          }

          if (!foundLogin && msg.content.includes(`[DAILY_LOGIN] | USER:${discordUserId}`)) {
             const match = msg.content.match(/TS:(\d+)/);
             if (match && match[1]) {
               lastLoginTime = parseInt(match[1], 10);
             } else {
               lastLoginTime = new Date(msg.timestamp).getTime();
             }
             foundLogin = true;
          }

          if (foundLp && foundLogin) break;
        }

        if (foundLp && foundLogin) break;
        lastMessageId = messages[messages.length - 1].id;
      }

      return { 
        lp, 
        lastLoginTime, 
        allowedDaily: (now - lastLoginTime) >= ONE_DAY_MS 
      };
    };

    const writeLpToChannel = async (discordUserId: string, newLp: number, reason: string, levelUpMessage?: string) => {
      const content = `[LP_LEDGER] | USER:${discordUserId} | REASON:${reason} | TOTAL:${newLp}`;
      const payload: any = { content };
      
      if (levelUpMessage) {
        payload.embeds = [{
          title: "🌟 Level Up!",
          description: levelUpMessage,
          color: 0xFFD700, // Gold
          fields: [
            { name: "New LP Total", value: `${newLp} LP`, inline: true },
            { name: "Level", value: `${Math.floor(newLp / 100) + 1}`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }];
      }

      try {
        await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages`, 'POST', payload);
      } catch (error) {
        console.error('Failed to write LP to channel:', error);
      }
    };

    const ROLE_THRESHOLDS = [
      { threshold: 100, roleId: process.env.DISCORD_ROLE_ID_GENERAL_TECH || process.env.VITE_DISCORD_ROLE_ID_GENERAL_TECH, name: 'General Tech' },
      { threshold: 500, roleId: process.env.DISCORD_ROLE_ID_LAB_TECH || process.env.VITE_DISCORD_ROLE_ID_LAB_TECH, name: 'Lab Tech' },
      { threshold: 1000, roleId: process.env.DISCORD_ROLE_ID_STUDIO_TECH || process.env.VITE_DISCORD_ROLE_ID_STUDIO_TECH, name: 'Studio Tech' }
    ];

    const assignRoles = async (discordUserId: string, newLp: number) => {
      let newlyAssignedRole = null;
      for (const { threshold, roleId, name } of ROLE_THRESHOLDS) {
        if (newLp >= threshold && roleId) {
          try {
            // Discord PUT is idempotent, but we don't know if they already had it unless we fetch member info.
            // To be safe and avoid spam, we'll just assign it. A better way would be to check current roles.
            await fetchDiscordAPI(`/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`, 'PUT');
            // If we wanted to announce only NEW roles, we'd need to compare against their previous LP or fetch their roles first.
            // For now, we ensure they have the role.
          } catch (roleError) {
             console.error(`Failed to assign ${name}`, roleError);
          }
        }
      }
      return newlyAssignedRole;
    };

    // 4. Main Handler Logic
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { action, discordUserId, lpAmount, reason } = JSON.parse(event.body || '{}');

    if (!discordUserId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing discordUserId' }) };
    }

    if (action === 'read') {
      const { lp: currentLp } = await getUserLedgerData(discordUserId);
      return { statusCode: 200, body: JSON.stringify({ discordUserId, lp: currentLp }) };
    } 
    
    if (action === 'daily_login') {
      const { lp: currentLp, allowedDaily, lastLoginTime } = await getUserLedgerData(discordUserId);
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      if (!allowedDaily) {
        const timeLeft = lastLoginTime ? (lastLoginTime + ONE_DAY_MS) - now : 0;
        return { 
          statusCode: 200, 
          body: JSON.stringify({ 
            success: false, 
            reason: 'cooldown', 
            timeLeft,
            lp: currentLp
          }) 
        };
      }

      const reward = 50;
      const newLp = currentLp + reward;
      const newLevel = Math.floor(newLp / 100) + 1;
      const oldLevel = Math.floor(currentLp / 100) + 1;

      const content = `[DAILY_LOGIN] | USER:${discordUserId} | TS:${now} | DATE:${new Date().toISOString()}`;
      const payload: any = {
        content,
        embeds: [{
          title: "🎁 Daily Login Reward Claimed!",
          description: `<@${discordUserId}> claimed their daily Lab Points!`,
          color: 0x00FF00, // Green
          fields: [
            { name: "Reward", value: `+${reward} LP`, inline: true },
            { name: "Total LP", value: `${newLp}`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      };

      try {
        await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages`, 'POST', payload);
      } catch (e) {
        console.error('Failed to log daily login message', e);
      }

      let levelUpMessage = undefined;
      if (newLevel > oldLevel) {
        levelUpMessage = `<@${discordUserId}> has advanced to **Level ${newLevel}**!`;
      }

      await writeLpToChannel(discordUserId, newLp, 'daily_login', levelUpMessage);
      await assignRoles(discordUserId, newLp);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          reward,
          lp: newLp,
          level: newLevel
        })
      };
    }

    if (action === 'write' || action === 'add') {
      if (typeof lpAmount !== 'number') {
         return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid lpAmount' }) };
      }

      const { lp: currentLp } = await getUserLedgerData(discordUserId);
      let newLp = lpAmount;
      if (action === 'add') {
         newLp = currentLp + lpAmount;
      }

      const newLevel = Math.floor(newLp / 100) + 1;
      const oldLevel = Math.floor(currentLp / 100) + 1;
      
      let levelUpMessage = undefined;
      if (newLevel > oldLevel) {
        levelUpMessage = `<@${discordUserId}> has advanced to **Level ${newLevel}**!`;
      }

      const txReason = reason || action;
      await writeLpToChannel(discordUserId, newLp, txReason, levelUpMessage);
      await assignRoles(discordUserId, newLp);

      return { 
        statusCode: 200, 
        body: JSON.stringify({ 
          success: true, 
          discordUserId, 
          lp: newLp,
          level: newLevel
        }) 
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action. Must be read, write, or add' }) };

  } catch (error: any) {
    console.error('Bot LP Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message }),
    };
  }
};
