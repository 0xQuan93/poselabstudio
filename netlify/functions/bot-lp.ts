import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  console.log('Bot LP Handler Started');
  
  try {
    // 1. Environment Variable Check
    const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.VITE_DISCORD_BOT_TOKEN;
    const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || process.env.VITE_DISCORD_GUILD_ID;
    const DISCORD_STUDIO_CHANNEL_ID = process.env.DISCORD_STUDIO_CHANNEL_ID || process.env.VITE_DISCORD_STUDIO_CHANNEL_ID;

    if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_STUDIO_CHANNEL_ID) {
      console.error('Server configuration error: Missing Discord Bot Token, Guild ID, or Channel ID');
      const missing = [];
      if (!DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN');
      if (!DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID');
      if (!DISCORD_STUDIO_CHANNEL_ID) missing.push('DISCORD_STUDIO_CHANNEL_ID');
      
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

    const getLatestLpFromChannel = async (discordUserId: string): Promise<number> => {
      try {
        const messages = await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages?limit=100`);
        for (const msg of messages) {
          if (msg.author.bot && msg.content.includes(`[LP_LEDGER] | USER:${discordUserId} | TOTAL:`)) {
            const match = msg.content.match(/TOTAL:(\d+)/);
            if (match && match[1]) {
              return parseInt(match[1], 10);
            }
          }
        }
      } catch (error) {
        console.error('Failed to read LP from channel:', error);
      }
      return 0;
    };

    const writeLpToChannel = async (discordUserId: string, newLp: number) => {
      const content = `[LP_LEDGER] | USER:${discordUserId} | TOTAL:${newLp}`;
      try {
        await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages`, 'POST', { content });
      } catch (error) {
        console.error('Failed to write LP to channel:', error);
      }
    };

    const checkDailyLoginStatus = async (discordUserId: string): Promise<{ allowed: boolean, lastLoginTime?: number }> => {
      try {
        const messages = await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages?limit=100`);
        const now = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        for (const msg of messages) {
          if (msg.author.bot && msg.content.includes(`[DAILY_LOGIN] | USER:${discordUserId}`)) {
             const match = msg.content.match(/TS:(\d+)/);
             let lastLoginTime = 0;
             if (match && match[1]) {
               lastLoginTime = parseInt(match[1], 10);
             } else {
               lastLoginTime = new Date(msg.timestamp).getTime();
             }

             const diff = now - lastLoginTime;
             if (diff < ONE_DAY_MS) {
               return { allowed: false, lastLoginTime };
             }
             return { allowed: true, lastLoginTime };
          }
        }
        return { allowed: true };
      } catch (error) {
        console.error('Failed to check daily login:', error);
        return { allowed: true }; 
      }
    };

    const ROLE_THRESHOLDS = [
      { threshold: 100, roleId: process.env.DISCORD_ROLE_ID_GENERAL_TECH, name: 'General Tech' },
      { threshold: 500, roleId: process.env.DISCORD_ROLE_ID_LAB_TECH, name: 'Lab Tech' },
      { threshold: 1000, roleId: process.env.DISCORD_ROLE_ID_STUDIO_TECH, name: 'Studio Tech' }
    ];

    // 4. Main Handler Logic
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { action, discordUserId, lpAmount } = JSON.parse(event.body || '{}');

    if (!discordUserId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing discordUserId' }) };
    }

    if (action === 'read') {
      const currentLp = await getLatestLpFromChannel(discordUserId);
      return { statusCode: 200, body: JSON.stringify({ discordUserId, lp: currentLp }) };
    } 
    
    if (action === 'daily_login') {
      const { allowed, lastLoginTime } = await checkDailyLoginStatus(discordUserId);
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      if (!allowed) {
        const timeLeft = lastLoginTime ? (lastLoginTime + ONE_DAY_MS) - now : 0;
        return { 
          statusCode: 200, 
          body: JSON.stringify({ 
            success: false, 
            reason: 'cooldown', 
            timeLeft 
          }) 
        };
      }

      const content = `[DAILY_LOGIN] | USER:${discordUserId} | TS:${now} | DATE:${new Date().toISOString()}`;
      try {
        await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages`, 'POST', { content });
      } catch (e) {
        console.error('Failed to log daily login message', e);
      }

      const reward = 50;
      const currentLp = await getLatestLpFromChannel(discordUserId);
      const newLp = currentLp + reward;
      const newLevel = Math.floor(newLp / 100) + 1;

      await writeLpToChannel(discordUserId, newLp);

      for (const { threshold, roleId, name } of ROLE_THRESHOLDS) {
        if (newLp >= threshold && roleId) {
          try {
            await fetchDiscordAPI(`/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`, 'PUT');
          } catch (roleError) {
             console.error(`Failed to assign ${name}`, roleError);
          }
        }
      }

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

      let newLp = lpAmount;
      if (action === 'add') {
         const currentLp = await getLatestLpFromChannel(discordUserId);
         newLp = currentLp + lpAmount;
      }

      const newLevel = Math.floor(newLp / 100) + 1;
      
      await writeLpToChannel(discordUserId, newLp);

      for (const { threshold, roleId, name } of ROLE_THRESHOLDS) {
        if (newLp >= threshold && roleId) {
          try {
            await fetchDiscordAPI(`/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`, 'PUT');
            console.log(`Ensured role ${name} (${roleId}) for user ${discordUserId}`);
          } catch (roleError) {
            console.error(`Failed to assign ${name} role:`, roleError);
          }
        }
      }

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
