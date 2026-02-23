# Plan: Discord Activity Integration

## Objective
Transition "Project 89 Reaction Forge" from a standalone web application into a Discord Activity (Embedded App). This will allow users to launch the 3D Avatar/Pose engine directly within Discord Voice Channels, utilizing Discord for identity and networking, while using Solana for rewards and creator markets.

## Phase 1: SDK Integration & App Configuration
1.  **Install SDK:** Install `@discord/embedded-app-sdk`. *(Done)*
2.  **Discord Portal Setup:**
    *   Create application in Discord Developer Portal.
    *   Enable **User Install** and **Guild Install** in Installation Contexts.
    *   Setup **URL Mappings** in the Activities tab to point to a Cloudflare Tunnel (local dev) or Netlify Production URL.
3.  **Initialization Hook:** Create a React hook (`src/hooks/useDiscordActivity.ts`) to manage the Discord SDK lifecycle.
    *   Initialize the `DiscordSDK`.
    *   Request `authorize` with `['identify', 'guilds']` scopes.
    *   Exchange the resulting `code` for an `access_token` via a secure serverless backend.
    *   Call `authenticate` on the SDK to finalize the connection.

## Phase 2: Refactoring Auth (Serverless OAuth)
1.  **Token Exchange Function:** Create a Netlify Serverless Function (`netlify/functions/discord-token.ts`) to securely exchange the OAuth `code` for an `access_token` using the hidden `DISCORD_CLIENT_SECRET`. This keeps the secret out of the Vite frontend while avoiding a heavy Node/Postgres backend.
2.  **Replace Backend Profile Updates:** Remove the `POST /user/profile` endpoint call in `ProfileModal.tsx`. The profile will be populated directly from the SDK's `authenticate` response.
3.  **Privy Integration:** Configure Privy to accept the Discord authenticated session to seamlessly generate/link the user's Solana wallet behind the scenes.

## Phase 3: Adapting Multiplayer (LiveKit + Discord)
1.  **Voice Channel Synergy:** A Discord Activity runs inside a Voice Channel. The users can hear each other via Discord's native audio.
2.  **LiveKit Focus:** Repurpose LiveKit purely for the **data channel** (syncing 3D avatar positions, animations, and emotes via `MultiAvatarManager`) rather than for voice audio, since Discord handles the voice. This significantly reduces LiveKit bandwidth costs.

## Phase 4: Solana Rewards & Marketplace (Serverless)
1.  **Smart Contracts (Programs):** Create or integrate SPL token distribution mechanisms triggered by frontend actions.
2.  **Marketplace UI:** Build UI components to query Solana RPCs for NFT ownership (representing avatars/poses) and load assets directly from IPFS into the Three.js canvas.

## Immediate Next Steps
1. Create `src/hooks/useDiscordActivity.ts`.
2. Update `src/state/useUserStore.ts` to accommodate Discord profile data.
3. Wrap the main application entry point to require Discord SDK readiness.