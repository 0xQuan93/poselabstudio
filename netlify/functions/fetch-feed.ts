import type { Handler } from '@netlify/functions';

interface DiscordEmbedField {
  name: string;
  value: string;
}

interface DiscordFeedMessage {
  id: string;
  content?: string;
  timestamp: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    image?: { proxy_url?: string; url?: string };
    thumbnail?: { proxy_url?: string };
    author?: { name?: string; icon_url?: string };
    fields?: DiscordEmbedField[];
  }>;
  reactions?: Array<{ emoji: { name: string }; count: number }>;
}

export const handler: Handler = async (event) => {
  // Move env vars inside handler for better reliability
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.VITE_DISCORD_BOT_TOKEN;
  const DISCORD_POSE_CHANNEL_ID = process.env.DISCORD_POSE_CHANNEL_ID || process.env.VITE_DISCORD_POSE_CHANNEL_ID;

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!DISCORD_BOT_TOKEN || !DISCORD_POSE_CHANNEL_ID) {
    console.error('Discord bot credentials not configured.');
    const missing = [];
    if (!DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN');
    if (!DISCORD_POSE_CHANNEL_ID) missing.push('DISCORD_POSE_CHANNEL_ID');
    
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        error: 'Server configuration error', 
        details: `Missing variables: ${missing.join(', ')}` 
      }) 
    };
  }

  try {
    // Fetch the last 50 messages from the channel
    const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_POSE_CHANNEL_ID}/messages?limit=50`, {
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

    const messages = await response.json() as DiscordFeedMessage[];

    // Map Discord messages into a cleaner format for the frontend
    const feed = messages
      .filter((msg) => msg.embeds && msg.embeds.length > 0) // Only get messages with embeds (our posts)
      .map((msg) => {
        const embed = msg.embeds?.[0] ?? {};
        
        // Extract upvotes (fire emoji count)
        const fireReaction = msg.reactions?.find((r) => r.emoji.name === '🔥');
        const upvotes = fireReaction ? fireReaction.count : 0;

        // Parse fields
        const creatorField = embed.fields?.find((f) => f.name === 'Creator');
        const creatorIdField = embed.fields?.find((f) => f.name === 'Creator ID');
        const addressField = embed.fields?.find((f) => f.name === 'Solana Address');

        // Clean the backticks out of the address if present
        let address = addressField?.value || null;
        if (address && address !== 'Not provided') {
           address = address.replace(/`/g, '');
        }

        // Extract creator ID from the new layout (Discord mention in content)
        let parsedCreatorId = creatorIdField?.value || null;
        if (!parsedCreatorId && msg.content) {
          const mentionMatch = msg.content.match(/<@(\d+)>/);
          if (mentionMatch) {
            parsedCreatorId = mentionMatch[1];
          }
        }

        return {
          id: msg.id,
          title: embed.title,
          description: embed.description,
          imageUrl: embed.image?.proxy_url || embed.image?.url || embed.thumbnail?.proxy_url,
          creatorName: creatorField?.value || embed.author?.name || 'Anonymous',
          creatorAvatarUrl: embed.author?.icon_url || null,
          creatorId: parsedCreatorId,
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
