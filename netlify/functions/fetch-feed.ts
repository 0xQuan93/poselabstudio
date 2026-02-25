import { Handler } from '@netlify/functions';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_STUDIO_CHANNEL_ID = process.env.DISCORD_STUDIO_CHANNEL_ID;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!DISCORD_BOT_TOKEN || !DISCORD_STUDIO_CHANNEL_ID) {
    console.error('Discord bot credentials not configured.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    // Fetch the last 50 messages from the channel
    const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages?limit=50`, {
      method: 'GET',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Discord API Error:', errorText);
      return { statusCode: response.status, body: JSON.stringify({ error: 'Failed to fetch feed from Discord' }) };
    }

    const messages = await response.json();

    // Map Discord messages into a cleaner format for the frontend
    const feed = messages
      .filter((msg: any) => msg.embeds && msg.embeds.length > 0) // Only get messages with embeds (our posts)
      .map((msg: any) => {
        const embed = msg.embeds[0];
        
        // Extract upvotes (fire emoji count)
        const fireReaction = msg.reactions?.find((r: any) => r.emoji.name === '🔥');
        const upvotes = fireReaction ? fireReaction.count : 0;

        // Parse fields
        const creatorField = embed.fields?.find((f: any) => f.name === 'Creator');
        const addressField = embed.fields?.find((f: any) => f.name === 'Solana Address');

        // Clean the backticks out of the address if present
        let address = addressField?.value || null;
        if (address && address !== 'Not provided') {
           address = address.replace(/`/g, '');
        }

        return {
          id: msg.id,
          title: embed.title,
          description: embed.description,
          imageUrl: embed.image?.url || embed.thumbnail?.proxy_url,
          creatorName: creatorField?.value || 'Anonymous',
          creatorAddress: address,
          upvotes: upvotes,
          timestamp: msg.timestamp
        };
      });

    return {
      statusCode: 200,
      body: JSON.stringify({ feed })
    };

  } catch (error) {
    console.error('Fetch Feed Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
