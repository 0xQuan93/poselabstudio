import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const vars = {
    DISCORD_CLIENT_ID: !!(process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID),
    DISCORD_CLIENT_SECRET: !!process.env.DISCORD_CLIENT_SECRET,
    DISCORD_BOT_TOKEN: !!(process.env.DISCORD_BOT_TOKEN || process.env.VITE_DISCORD_BOT_TOKEN),
    DISCORD_GUILD_ID: !!(process.env.DISCORD_GUILD_ID || process.env.VITE_DISCORD_GUILD_ID),
    DISCORD_STUDIO_CHANNEL_ID: !!(process.env.DISCORD_STUDIO_CHANNEL_ID || process.env.VITE_DISCORD_STUDIO_CHANNEL_ID),
    GEMINI_API_KEY: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
    LIVEKIT_API_KEY: !!(process.env.LIVEKIT_API_KEY || process.env.VITE_LIVEKIT_API_KEY),
    LIVEKIT_API_SECRET: !!(process.env.LIVEKIT_API_SECRET || process.env.VITE_LIVEKIT_API_SECRET),
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vars, null, 2),
  };
};
