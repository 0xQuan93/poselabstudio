# API Key Security Guide

> [!NOTE]
> **Feature Status:** AI-driven features (AIAgent, AI Pose Generator) are currently disabled in the public UI. This documentation is preserved for internal scaffolding and future development.

PoseLab uses Google's Gemini API for AI features. This guide explains how to securely configure your API key.

## Security Options (Best to Worst)

### 🟢 Option 1: Server-Side Proxy (Recommended)

Your API key stays on the server and is **never exposed** to users.

#### Deploy to Netlify (Recommended)

1. **Push your code to GitHub** (if not already)

2. **Import to Netlify**
   - Go to [netlify.com](https://netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Connect your GitHub repo

3. **Set Environment Variable**
   - Go to: Site settings → Environment variables
   - Click "Add a variable"
   - Key: `GEMINI_API_KEY`
   - Value: `[REQUIRED]` (starts with `AIza...`)

4. **Deploy**
   - Netlify automatically deploys the function at `/.netlify/functions/gemini`
   - Your frontend calls this endpoint instead of Gemini directly
   - **Your API key never reaches the browser!**

5. **Test It**
   - After deploy, visit: `https://your-site.netlify.app/.netlify/functions/gemini`
   - You should see "Method not allowed" (that's correct - it only accepts POST)

#### Deploy to Vercel

1. **Push your code to GitHub** (if not already)

2. **Import to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project" → Import your GitHub repo

3. **Set Environment Variable**
   - In Vercel dashboard → Settings → Environment Variables
   - Add: `GEMINI_API_KEY` = `[REQUIRED]`

4. **Deploy**
   - Vercel automatically deploys the `/api/gemini.ts` serverless function
   - Your frontend calls `/api/gemini` instead of Gemini directly

5. **Configure Frontend**
   - Set the proxy URL in Netlify environment variables:
   ```
   VITE_GEMINI_PROXY_URL=/api/gemini
   ```

#### Deploy to Cloudflare Workers

```javascript
// worker.js
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    const { action, prompt, history, systemPrompt } = await request.json();
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [...(history || []), { role: 'user', parts: [{ text: prompt }] }],
          ...(systemPrompt && { systemInstruction: { parts: [{ text: systemPrompt }] } })
        })
      }
    );
    
    return response;
  }
};
```

Set `GEMINI_API_KEY` in Cloudflare Workers secrets.

---

### 🟡 Option 2: Environment Variable (Development Only)

For local development, you can use an environment variable:

1. Create `.env.local` in project root:
   ```
   VITE_GEMINI_API_KEY=[REQUIRED]
   ```

2. The key is embedded in the build - **DO NOT use this in production!**

⚠️ **Warning**: This exposes your key in the browser bundle. Anyone can extract it.

---

### 🟠 Option 3: User-Provided Keys (Demo/Personal Use)

For demos or personal use, users can enter their own API keys:

1. User enters key in the AI Agent widget
2. Key is stored in sessionStorage (cleared when tab closes)
3. Optional: User can check "Remember" to persist (less secure)

**Security features:**
- Keys are obfuscated before storage
- Session storage clears on tab close by default
- Clear button to remove stored keys
- Auto-migration from old insecure storage

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Security Flow                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Option 1: Server Proxy                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │ Browser  │───▶│  Server  │───▶│  Gemini  │                  │
│  │          │    │ (has key)│    │   API    │                  │
│  └──────────┘    └──────────┘    └──────────┘                  │
│       ✅ Key never reaches browser                              │
│                                                                  │
│  Option 2/3: Direct API                                         │
│  ┌──────────┐                    ┌──────────┐                  │
│  │ Browser  │───────────────────▶│  Gemini  │                  │
│  │ (has key)│                    │   API    │                  │
│  └──────────┘                    └──────────┘                  │
│       ⚠️ Key is in browser (extractable)                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Rate Limiting

The server proxy includes basic rate limiting:
- 30 requests per minute per IP
- Resets after 1 minute

For production, consider:
- Redis-based rate limiting
- User authentication
- Usage quotas

---

## Getting a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key (starts with `AIza...`)

**Free Tier Limits:**
- 60 requests per minute
- 1 million tokens per month
- No credit card required

---

## Troubleshooting

### "Rate limit exceeded"
- Wait 1 minute and try again
- If using proxy, check server logs

### "API key not valid"
- Verify key in [Google AI Studio](https://aistudio.google.com/app/apikey)
- Check for extra spaces/characters
- Ensure key has Gemini API access enabled

### "Proxy not responding"
- Check if serverless function is deployed
- Verify `GEMINI_API_KEY` environment variable is set
- Check Vercel/Cloudflare logs for errors

