# Deployment Guide

This project has been updated to use **LiveKit** for scalable multiplayer (20+ users).

## 1. Local Development
For local testing, you must create a `.env` file in the project root:

```env
LIVEKIT_API_KEY=your_key_here
LIVEKIT_API_SECRET=your_secret_here
LIVEKIT_URL=wss://your-project.livekit.cloud
```

Then run:
```bash
npm run dev
```

## 2. Production (Netlify)
1.  Go to your **Netlify Dashboard** > **Site Configuration** > **Environment variables**.
2.  Add the same variables:
    *   `LIVEKIT_API_KEY`
    *   `LIVEKIT_API_SECRET`
    *   `LIVEKIT_URL`
3.  Deploy the site (push to main or manual deploy).

## Notes
- The multiplayer system now uses `src/multiplayer/livekitManager.ts`.
- The multiplayer system has been migrated from PeerJS to LiveKit.
- You can monitor room usage in your LiveKit Cloud dashboard.
