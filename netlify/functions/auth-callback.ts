import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const code = event.queryStringParameters?.code;
  const error = event.queryStringParameters?.error;

  if (error || !code) {
    return {
      statusCode: 302,
      headers: { Location: '/?error=auth_failed' }
    };
  }

  // Support both standard and Vite-prefixed env vars
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID;
  const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
  
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    console.error('Missing Discord credentials in environment variables');
    return {
      statusCode: 302,
      headers: { Location: '/?error=server_config_missing' }
    };
  }
  
  // Base URL resolution
  const baseUrl = process.env.URL || 'http://localhost:8888';
  const REDIRECT_URI = `${baseUrl}/api/auth/callback`;

  try {
    // 1. Exchange the auth code for access tokens
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID || '',
        client_secret: DISCORD_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!tokenResponse.ok) {
       console.error('Failed to exchange token:', await tokenResponse.text());
       throw new Error('Failed to exchange token');
    }
    const tokenData = await tokenResponse.json();

    // 2. Fetch the user's profile
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    if (!userResponse.ok) throw new Error('Failed to fetch user data');
    const userData = await userResponse.json();
    
    // 3. Fetch the user's roles in our specific Guild (Phase 3: Deep Discord LP Engine)
    let roles: string[] = [];
    if (DISCORD_GUILD_ID) {
      const memberResponse = await fetch(`https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (memberResponse.ok) {
        const memberData = await memberResponse.json();
        roles = memberData.roles || [];
      } else {
        console.warn(`Could not fetch guild member data for ${userData.id} in guild ${DISCORD_GUILD_ID}`);
      }
    }

    const sessionData = {
      id: userData.id,
      discordId: userData.id,
      username: userData.username,
      avatarUrl: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : null,
      roles
    };
    
    // 4. Store session in a cookie (not HttpOnly so the React app can decode it on load)
    const sessionBase64 = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    
    return {
      statusCode: 302,
      headers: {
        Location: '/?login=success',
        // Max-Age 30 days. Secure is required for iframe/embedded contexts. SameSite=None allows cross-site usage.
        'Set-Cookie': `poselab_user=${sessionBase64}; Path=/; Secure; SameSite=None; Max-Age=2592000`
      }
    };
  } catch (err) {
    console.error('Auth Callback Error:', err);
    return {
      statusCode: 302,
      headers: { Location: '/?error=auth_failed' }
    };
  }
};
