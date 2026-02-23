import { useEffect, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { useUserStore } from '../state/useUserStore';

// Determine if we are running inside an iframe (Discord Activity)
export const isEmbeddedApp = window.top !== window.self;

// Read the Client ID from environment variables
const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

// Initialize the SDK outside of the hook so it's a singleton
let discordSdk: DiscordSDK | null = null;
if (isEmbeddedApp && DISCORD_CLIENT_ID) {
  discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
}

interface AuthResponse {
  access_token: string;
  user: {
    username: string;
    discriminator: string;
    id: string;
    public_flags: number;
    avatar?: string | null | undefined;
    global_name?: string | null | undefined;
  };
}

export const useDiscordActivity = () => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { setUser } = useUserStore();

  useEffect(() => {
    if (!isEmbeddedApp) {
      // Not running in Discord, so we are "ready" for normal web fallback
      setIsReady(true);
      return;
    }

    if (!discordSdk) {
      setError(new Error("Discord SDK is not initialized. Check VITE_DISCORD_CLIENT_ID."));
      return;
    }

    const setupDiscordSDK = async () => {
      try {
        await discordSdk!.ready();
        
        // 1. Authorize with Discord Client
        const { code } = await discordSdk!.commands.authorize({
          client_id: DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds'],
        });
        
        // 2. Exchange code for access_token securely via our serverless function
        // Note: For local dev, Vite proxy must route /api to Netlify dev server
        const response = await fetch('/api/discord-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
           throw new Error(`Token exchange failed: ${response.statusText}`);
        }

        const { access_token } = await response.json();

        // 3. Authenticate with the Discord Client using the access_token
        const auth: AuthResponse = await discordSdk!.commands.authenticate({
          access_token,
        });

        if (!auth.user) {
          throw new Error('Authenticate command did not return a user');
        }

        // 4. Update the global user state with Discord profile data
        setUser({
           id: auth.user.id,
           username: auth.user.username,
           avatarUrl: auth.user.avatar 
            ? `https://cdn.discordapp.com/avatars/${auth.user.id}/${auth.user.avatar}.png` 
            : null,
           credits: 0, // Placeholder until Solana RPC fetch is implemented
        });

        setIsReady(true);
      } catch (err) {
        console.error("Failed to initialize Discord SDK:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    setupDiscordSDK();
  }, [setUser]);

  return { isReady, error, discordSdk };
};
