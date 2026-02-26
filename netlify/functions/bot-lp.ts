import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  // 1. Environment Variable Check
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
  const DISCORD_STUDIO_CHANNEL_ID = process.env.DISCORD_STUDIO_CHANNEL_ID;

  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_STUDIO_CHANNEL_ID) {
    console.error('Server configuration error: Missing Discord Bot Token, Guild ID, or Channel ID');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
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
      console.error(`Discord API Error on ${method} ${endpoint}:`, await response.text());
      throw new Error(`Discord API Error: ${response.statusText}`);
    }
    return response.status === 204 ? null : await response.json();
  };

  const getLatestLpFromChannel = async (discordUserId: string): Promise<number> => {
    try {
      // Fetch the last 100 messages from the #creator-studio channel
      const messages = await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages?limit=100`);
      
      // Look for the most recent ledger entry for this user
      // Format: "[LP_LEDGER] | USER:123456789 | TOTAL:550"
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
    return 0; // Default to 0 if no record found
  };

  const writeLpToChannel = async (discordUserId: string, newLp: number) => {
    const content = `[LP_LEDGER] | USER:${discordUserId} | TOTAL:${newLp}`;
    try {
      await fetchDiscordAPI(`/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages`, 'POST', { content });
      console.log(`Successfully wrote LP ledger entry for user ${discordUserId}: ${newLp} LP`);
    } catch (error) {
      console.error('Failed to write LP to channel:', error);
    }
  };

  // 3. Define Roles Logic
  const ROLE_THRESHOLDS = [
    { threshold: 100, roleId: process.env.DISCORD_ROLE_ID_GENERAL_TECH, name: 'General Tech' },
    { threshold: 500, roleId: process.env.DISCORD_ROLE_ID_LAB_TECH, name: 'Lab Tech' },
    { threshold: 1000, roleId: process.env.DISCORD_ROLE_ID_STUDIO_TECH, name: 'Studio Tech' }
  ];

  // 4. Main Handler Logic
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { action, discordUserId, lpAmount } = JSON.parse(event.body || '{}');

    if (!discordUserId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing discordUserId' }) };
    }

    if (action === 'read') {
      const currentLp = await getLatestLpFromChannel(discordUserId);
      return { statusCode: 200, body: JSON.stringify({ discordUserId, lp: currentLp }) };
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
      
      // A. Write the new state to the Discord Channel Backend
      await writeLpToChannel(discordUserId, newLp);

      // B. Auto-assign roles based on the new LP threshold
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
