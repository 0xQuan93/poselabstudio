import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  // Move env vars inside handler for better reliability
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.VITE_DISCORD_BOT_TOKEN;
  const DISCORD_STUDIO_CHANNEL_ID = process.env.DISCORD_STUDIO_CHANNEL_ID || process.env.VITE_DISCORD_STUDIO_CHANNEL_ID;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { image, creatorName, creatorId, creatorAddress, description, creatorAvatarUrl } = body;

    if (!image || !creatorName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    if (!DISCORD_BOT_TOKEN || !DISCORD_STUDIO_CHANNEL_ID) {
      console.error('Discord bot credentials not configured.');
      const missing = [];
      if (!DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN');
      if (!DISCORD_STUDIO_CHANNEL_ID) missing.push('DISCORD_STUDIO_CHANNEL_ID');
      
      return { 
        statusCode: 500, 
        body: JSON.stringify({ 
          error: 'Server configuration error', 
          details: `Missing variables: ${missing.join(', ')}` 
        }) 
      };
    }

    // Extract base64 data
    const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid image format. Expected base64 data URI.' }) };
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Determine extension
    const extension = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1] || 'png';
    const filename = `pose-${Date.now()}.${extension}`;

    // Discord API requires multipart/form-data for file uploads
    // In Node 18+, FormData and Blob are available globally
    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('files[0]', blob, filename);

    // Only mention if it looks like a Discord User ID (snowflake)
    // Privy DIDs (e.g. did:privy:...) should be displayed as names
    const isDiscordId = creatorId && /^\d+$/.test(creatorId);
    const mentionText = isDiscordId ? `<@${creatorId}>` : creatorName;

    const payload_json = {
      content: `**New Pose Published by ${mentionText}**!`,
      embeds: [
        {
          title: "Creator Studio Post",
          description: description || "Check out this new pose!",
          color: 0x676FFF, // Privy's purple/blue
          image: {
            url: `attachment://${filename}`
          },
          author: {
            name: creatorName,
            icon_url: creatorAvatarUrl || undefined
          },
          fields: [
            {
              name: "Creator",
              value: creatorName,
              inline: true
            },
            {
              name: "Solana Address",
              value: creatorAddress ? `${creatorAddress}` : "Not provided",
              inline: true
            }
          ],
          footer: {
            text: "React with 🔥 to upvote!"
          }
        }
      ]
    };

    formData.append('payload_json', JSON.stringify(payload_json));

    const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Discord API Error:', errorText);
      return { statusCode: response.status, body: JSON.stringify({ error: 'Failed to post to Discord' }) };
    }

    const discordMessage = await response.json();

    // Automatically add the initial fire reaction for upvoting
    const messageId = discordMessage.id;
    // Encode the emoji (🔥 is %F0%9F%94%A5)
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_STUDIO_CHANNEL_ID}/messages/${messageId}/reactions/%F0%9F%94%A5/@me`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, messageId })
    };

  } catch (error) {
    console.error('Publish Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
