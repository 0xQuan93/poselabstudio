import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  // Fallback to localhost for local dev if URL is not provided by Netlify
  const REDIRECT_URI = process.env.URL ? `${process.env.URL}/api/auth/callback` : 'http://localhost:8888/api/auth/callback';
  
  // We request identify (profile), email, and guilds to read their server roles
  const scope = encodeURIComponent('identify email guilds guilds.members.read');
  const discordOauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}`;

  return {
    statusCode: 302,
    headers: {
      Location: discordOauthUrl,
    },
  };
};
