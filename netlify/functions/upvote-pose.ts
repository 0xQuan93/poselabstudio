import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  // Move env vars inside handler for better reliability
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  const DISCORD_STUDIO_CHANNEL_ID = process.env.DISCORD_STUDIO_CHANNEL_ID || process.env.VITE_DISCORD_STUDIO_CHANNEL_ID;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!DISCORD_BOT_TOKEN || !DISCORD_STUDIO_CHANNEL_ID) {
    console.error('Discord bot credentials not configured.');
    if (!DISCORD_BOT_TOKEN) console.error('Missing DISCORD_BOT_TOKEN');
    if (!DISCORD_STUDIO_CHANNEL_ID) console.error('Missing DISCORD_STUDIO_CHANNEL_ID');
    
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    const { messageId } = JSON.parse(event.body || '{}');

    if (!messageId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Message ID is required' }) };
    }

    // Add a fire reaction to the message
    // Emoji is URI encoded: 🔥 -> %F0%9F%94%A5
    const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages/${messageId}/reactions/%F0%9F%94%A5/@me`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
      }
    });

    if (!response.ok) {
      // 204 No Content is success, but Discord sometimes returns this if you've already reacted
      if (response.status !== 204) {
         const errorText = await response.text();
         console.error('Discord API Error (Upvote):', errorText);
         return { statusCode: response.status, body: JSON.stringify({ error: 'Failed to upvote' }) };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('Upvote Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
