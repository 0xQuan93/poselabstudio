import type { Handler } from '@netlify/functions';
import { clearSessionCookie } from './session';

export const handler: Handler = async (event) => {
  const baseUrl = process.env.URL || event.headers.origin || '';
  const isSecure = baseUrl.startsWith('https://');

  return {
    statusCode: 204,
    multiValueHeaders: {
      'Set-Cookie': [
        clearSessionCookie(isSecure),
        `poselab_user=; Path=/; ${isSecure ? 'Secure; SameSite=None' : 'SameSite=Lax'}; Max-Age=0`,
      ],
    },
  };
};
