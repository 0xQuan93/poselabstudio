import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Support both standard and Vite-prefixed env vars
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID;
  const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    console.error('Missing Discord credentials in environment variables');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  try {
    const { code } = JSON.parse(event.body || '{}');

    if (!code) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Authorization code is required' }) };
    }

    // Prepare the payload for Discord's token endpoint
    // Following the official Discord Embedded App SDK documentation
    const data = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID!,
      client_secret: DISCORD_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code: code,
    });

    // Exchange the code for an access token
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: data,
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Discord API Error:', errorData);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Failed to exchange token with Discord' }),
      };
    }

    const { access_token } = await response.json();

    // Return only the access_token to the client.
    // Ensure we do not leak the refresh_token or client_secret!
    return {
      statusCode: 200,
      body: JSON.stringify({ access_token }),
    };

  } catch (error) {
    console.error('Token Exchange Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
