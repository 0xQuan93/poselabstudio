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
      let actionTimestamps: Record<string, number> = {};
      let foundLp = false;
      let lastMessageId = undefined;
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
            const matchTotal = msg.content.match(/TOTAL:(\d+)/);
            if (matchTotal && matchTotal[1]) {
              lp = parseInt(matchTotal[1], 10);
            }
            const matchActions = msg.content.match(/ACTIONS:(\{.*\})/);
            if (matchActions && matchActions[1]) {
              try {
                actionTimestamps = JSON.parse(matchActions[1]);
              } catch (e) {}
            } else {
               // Fallback to check if they had a DAILY_LOGIN message in the past to prevent reset (legacy support)
               const matchLegacyLogin = msg.content.match(/\[DAILY_LOGIN\].*TS:(\d+)/);
               if (matchLegacyLogin && matchLegacyLogin[1]) {
                  actionTimestamps['daily_login'] = parseInt(matchLegacyLogin[1], 10);
               }
            }
            foundLp = true;
          }

          if (foundLp) break;
        }

        if (foundLp) break;
        lastMessageId = messages[messages.length - 1].id;
      }

      return { lp, actionTimestamps };
    };

    const writeLpToChannel = async (discordUserId: string, newLp: number, reason: string, actionTimestamps: any, levelUpMessage?: string) => {
      const content = `[LP_LEDGER] | USER:${discordUserId} | REASON:${reason} | TOTAL:${newLp} | ACTIONS:${JSON.stringify(actionTimestamps)}`;
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
      { threshold: 500, roleId: process.env.DISCORD_ROLE_ID_GENERAL_TECH || process.env.VITE_DISCORD_ROLE_ID_GENERAL_TECH, name: 'General Tech' },
      { threshold: 2500, roleId: process.env.DISCORD_ROLE_ID_LAB_TECH || process.env.VITE_DISCORD_ROLE_ID_LAB_TECH, name: 'Lab Tech' },
      { threshold: 5000, roleId: process.env.DISCORD_ROLE_ID_STUDIO_TECH || process.env.VITE_DISCORD_ROLE_ID_STUDIO_TECH, name: 'Studio Tech' }
    ];

    const assignRoles = async (discordUserId: string, newLp: number) => {
      let newlyAssignedRole = null;
      for (const { threshold, roleId, name } of ROLE_THRESHOLDS) {
        if (newLp >= threshold && roleId) {
          try {
            await fetchDiscordAPI(`/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`, 'PUT');
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

    const body = JSON.parse(event.body || '{}');
    const { action, discordUserId, actionName } = body;

    if (!discordUserId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing discordUserId' }) };
    }

    if (action === 'read') {
      const { lp: currentLp, actionTimestamps } = await getUserLedgerData(discordUserId);
      return { statusCode: 200, body: JSON.stringify({ discordUserId, lp: currentLp, actionTimestamps }) };
    } 
    
    const ALLOWED_ACTIONS: Record<string, { reward: number, cooldownMs: number, label: string }> = {
      'daily_login': { reward: 50, cooldownMs: 24 * 60 * 60 * 1000, label: "Daily Login" },
      'explore_app': { reward: 20, cooldownMs: 24 * 60 * 60 * 1000, label: "Exploring the App" },
      'visit_tabs': { reward: 20, cooldownMs: 24 * 60 * 60 * 1000, label: "Visiting Tabs" },
      'use_sprint': { reward: 30, cooldownMs: 24 * 60 * 60 * 1000, label: "Using Sprint Mode" }
    };

    if (action === 'grant_action') {
      if (!actionName || !ALLOWED_ACTIONS[actionName]) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid or non-grantable action' }) };
      }
      
      const { lp: currentLp, actionTimestamps } = await getUserLedgerData(discordUserId);
      const actionConfig = ALLOWED_ACTIONS[actionName];
      const lastTime = actionTimestamps[actionName] || 0;
      const now = Date.now();
      
      if (now - lastTime < actionConfig.cooldownMs) {
        return { 
          statusCode: 200, 
          body: JSON.stringify({ 
            success: false, 
            reason: 'cooldown', 
            timeLeft: (lastTime + actionConfig.cooldownMs) - now,
            lp: currentLp,
            actionTimestamps
          }) 
        };
      }

      const reward = actionConfig.reward;
      const newLp = currentLp + reward;
      actionTimestamps[actionName] = now;
      
      const newLevel = Math.floor(newLp / 100) + 1;
      const oldLevel = Math.floor(currentLp / 100) + 1;

      let levelUpMessage = undefined;
      if (newLevel > oldLevel) {
        levelUpMessage = `<@${discordUserId}> has advanced to **Level ${newLevel}**!`;
      }

      // We still post a reward claimed message if we want gamification feedback
      const payload: any = {
        content: `[ACTION_LOG] | USER:${discordUserId} | ACTION:${actionName} | REWARD:${reward}`,
        embeds: [{
          title: `🎁 Reward Claimed: ${actionConfig.label}!`,
          description: `<@${discordUserId}> claimed their Lab Points!`,
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
        console.error('Failed to log gamification message', e);
      }

      await writeLpToChannel(discordUserId, newLp, actionName, actionTimestamps, levelUpMessage);
      await assignRoles(discordUserId, newLp);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          reward,
          lp: newLp,
          level: newLevel,
          actionTimestamps
        })
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action. Must be read or grant_action' }) };

  } catch (error: any) {
    console.error('Bot LP Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message }),
    };
  }
};
