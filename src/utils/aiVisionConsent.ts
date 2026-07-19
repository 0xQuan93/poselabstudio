/**
 * One-time authorization for sending a webcam frame to an AI provider.
 *
 * Authorization is intentionally not persisted: every capture requires a fresh,
 * user-visible confirmation. The opaque token is consumed by MotionCaptureManager
 * immediately before it reads the video element.
 */

export type AiVisionCaptureAuthorization = object;

const approvedAuthorizations = new WeakSet<object>();

export function requestAiVisionCaptureAuthorization(): AiVisionCaptureAuthorization | null {
  if (typeof window === 'undefined') return null;

  const approved = window.confirm(
    'Send one current camera frame to Google Gemini for AI interpretation?\n\n'
      + 'The image may contain your face and surroundings. It leaves this device for this one request. '
      + 'Choose Cancel to keep the frame on-device.',
  );

  if (!approved) return null;

  const authorization = Object.freeze({});
  approvedAuthorizations.add(authorization);
  return authorization;
}

/**
 * Consume a one-time authorization. Tokens cannot be reused after a request.
 */
export function consumeAiVisionCaptureAuthorization(
  authorization: AiVisionCaptureAuthorization | undefined,
): boolean {
  if (!authorization || !approvedAuthorizations.has(authorization)) return false;
  approvedAuthorizations.delete(authorization);
  return true;
}
