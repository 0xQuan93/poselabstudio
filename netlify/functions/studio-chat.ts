import { Handler } from '@netlify/functions';

// Use the specific channel ID provided by the user
const STUDIO_CHAT_CHANNEL_ID = '1475638321685336290';

export const handler: Handler = async (event) => {
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.VITE_DISCORD_BOT_TOKEN;
  const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || process.env.VITE_DISCORD_GUILD_ID;

  if (!DISCORD_BOT_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing DISCORD_BOT_TOKEN' }),
    };
  }


  const fetchDiscordAPI = async (endpoint: string, method: string = 'GET', body?: any) => {
    const url = `https://discord.com/api/v10${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      console.error(`Discord API Error: ${text}`);
      throw new Error(text);
    }
    return response.status === 204 ? null : await response.json();
  };

  try {
    if (event.httpMethod === 'GET') {
      // Fetch messages and guild info in parallel
      const [messages, guildInfo] = await Promise.all([
        fetchDiscordAPI(`/channels/${STUDIO_CHAT_CHANNEL_ID}/messages?limit=50`),
        // Get guild info with approximate member counts (requires privileged intent? usually works for bot in guild)
        // If fails, we can try without with_counts=true
        DISCORD_GUILD_ID 
          ? fetchDiscordAPI(`/guilds/${DISCORD_GUILD_ID}?with_counts=true`).catch(() => null)
          : Promise.resolve(null)
      ]);

      return {
        statusCode: 200,
        body: JSON.stringify({ 
          messages, 
          memberCount: guildInfo?.approximate_member_count || 0,
          presenceCount: guildInfo?.approximate_presence_count || 0
        }),
      };
    } else if (event.httpMethod === 'POST') {
      // Send message
      if (!event.body) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing body' }) };
      }
      
      const { content, username, avatar_url } = JSON.parse(event.body);
      
      if (!content) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing content' }) };
      }

      // We can use a webhook if we want to impersonate users better, but using the bot to send messages is standard.
      // If we want to show who sent it, we can prepend the username to the message or use an embed.
      // However, the prompt says "the bot will send the message".
      
      // If we want to simulate the user speaking, we can try to use a webhook if available, 
      // but without a webhook URL configured, we will just have the bot send it.
      // For a better experience, we can include the sender's name in the message content or an embed.
      // Let's keep it simple: Bot sends the message.
      
      // Optionally we could use a webhook to set username/avatar if we had one.
      // Since we don't have a webhook URL in env vars (checked bot-lp.ts), we'll stick to bot messages.
      // We will append the username to the message if it's not the bot itself.

      let messageContent = content;
      if (username) {
        messageContent = `**${username}**: ${content}`;
      }

      const result = await fetchDiscordAPI(`/channels/${STUDIO_CHAT_CHANNEL_ID}/messages`, 'POST', {
        content: messageContent,
        // allowed_mentions: { parse: [] } // Prevent mass pings if desired
      });

      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    } else {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
  } catch (error: any) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message }),
    };
  }
};
