/**
 * Netlify Serverless Function - Gemini API Proxy
 * 
 * This keeps your API key secure on the server side.
 * 
 * Setup:
 * 1. Add GEMINI_API_KEY to Netlify environment variables
 *    (Site settings → Environment variables)
 * 2. Deploy - function is automatically available at /.netlify/functions/gemini
 * 
 * Usage:
 * POST /.netlify/functions/gemini
 * Body: { action: "chat" | "generate", prompt: string, history?: [...] }
 */

import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: unknown;
}

// Rate limiting (simple in-memory, resets on cold start)
const rateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 30; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimits.get(ip);
  
  if (!limit || now > limit.resetTime) {
    rateLimits.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  
  if (limit.count >= RATE_LIMIT) {
    return false;
  }
  
  limit.count++;
  return true;
}

const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  // CORS headers - allow both www and non-www, plus localhost for testing
  const origin = event.headers.origin || '';
  const allowedOrigins = [
    'https://poselab.studio',
    'https://www.poselab.studio',
    'http://localhost:5173',
    'http://localhost:3000'
  ];
  
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://poselab.studio';
  
  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  console.log('[Gemini Function] Request received:', event.httpMethod, 'from:', origin);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Check API key is configured
  if (!GEMINI_API_KEY) {
    console.error('[Gemini Function] GEMINI_API_KEY not configured!');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error - API key not set. Please add GEMINI_API_KEY to Netlify environment variables.' })
    };
  }
  
  console.log('[Gemini Function] API key is configured (length:', GEMINI_API_KEY.length, ')');

  // Rate limiting
  const clientIP = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                   event.headers['client-ip'] || 
                   'unknown';
  
  if (!checkRateLimit(clientIP)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, prompt, history, systemPrompt } = body;

    if (!action || !prompt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing action or prompt' })
      };
    }

    let result;

    switch (action) {
      case 'chat':
        result = await handleChat(prompt, history, systemPrompt);
        break;
      case 'generate':
        result = await handleGenerate(prompt);
        break;
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action. Use "chat" or "generate"' })
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error: any) {
    console.error('Gemini API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process request',
        details: error.message 
      })
    };
  }
};

async function handleChat(
  prompt: string,
  history: Array<{ role: string; parts: Array<{ text: string }> }> = [],
  systemPrompt?: string
) {
  const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // Build contents array with history
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: prompt }] }
  ];

  const requestBody: any = { contents };

  // Add system instruction if provided
  if (systemPrompt) {
    requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as GeminiResponse;

  // Extract text from response
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return {
    text,
    usage: data.usageMetadata
  };
}

async function handleGenerate(prompt: string) {
  // For pose generation, use a specific system prompt
  const systemPrompt = `You are a VRM pose generator for 3D avatars. 
Generate ONLY valid JSON with bone rotations in degrees, expressions, background, and scene rotation. 

Output format:
{
  "vrmPose": {
    "boneName": { "rotation": [x, y, z], "position": [x, y, z] }
  },
  "expressions": { "joy": 0.5 },
  "background": "midnight-circuit",
  "sceneRotation": { "y": 180 }
}

Bone names: hips, spine, chest, neck, head, leftUpperArm, leftLowerArm, leftHand, rightUpperArm, rightLowerArm, rightHand, etc.
Backgrounds: midnight-circuit, protocol-sunset, green-loom-matrix, neural-grid, cyber-waves, signal-breach, quantum-field, protocol-dawn, green-screen.
`;

  return handleChat(prompt, [], systemPrompt);
}

export { handler };

