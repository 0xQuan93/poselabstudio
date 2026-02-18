import { Handler } from '@netlify/functions';
import { AccessToken } from 'livekit-server-sdk';

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { roomName, participantName } = JSON.parse(event.body || '{}');

    if (!roomName || !participantName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing roomName or participantName' }),
      };
    }

    // Get credentials from environment variables
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server misconfigured: Missing LiveKit credentials' }),
      };
    }

    // Create access token
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
      name: participantName,
    });

    // Add permissions
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      // Allow data transfer for poses
      canPublishData: true, 
    });

    const token = await at.toJwt();

    return {
      statusCode: 200,
      body: JSON.stringify({ token }),
    };
  } catch (error) {
    console.error('Error generating token:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate token' }),
    };
  }
};

export { handler };
