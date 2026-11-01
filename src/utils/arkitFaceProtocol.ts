import { ARKIT_BLENDSHAPE_NAMES, clamp01, type ArkitCoefficientMap } from './arkitBlendshapes';

export const ARKIT_FACE_PROTOCOL_VERSION = 1;
export const ARKIT_FACE_DEFAULT_PORT = 49122;
export const ARKIT_FACE_DEFAULT_URL = `ws://127.0.0.1:${ARKIT_FACE_DEFAULT_PORT}`;

export interface ArkitHeadPose {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface ArkitFaceHelloMessage {
  type: 'hello';
  v: typeof ARKIT_FACE_PROTOCOL_VERSION;
  device: 'ios-arkit';
  shapes: 52;
}

export interface ArkitFaceFrameMessage {
  type: 'arkit-face-frame';
  v: typeof ARKIT_FACE_PROTOCOL_VERSION;
  t: number;
  blendshapes: ArkitCoefficientMap;
  head: ArkitHeadPose;
}

export type ArkitFaceMessage = ArkitFaceHelloMessage | ArkitFaceFrameMessage;

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function parseArkitFaceMessage(raw: string): ArkitFaceMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const message = parsed as Record<string, unknown>;
  if (message.v !== ARKIT_FACE_PROTOCOL_VERSION) return null;

  if (message.type === 'hello') {
    return {
      type: 'hello',
      v: ARKIT_FACE_PROTOCOL_VERSION,
      device: 'ios-arkit',
      shapes: 52,
    };
  }

  if (message.type !== 'arkit-face-frame') return null;
  const blendshapes: ArkitCoefficientMap = {};
  const incoming = (message.blendshapes && typeof message.blendshapes === 'object')
    ? message.blendshapes as Record<string, unknown>
    : {};
  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    if (name in incoming) {
      blendshapes[name] = clamp01(asNumber(incoming[name]));
    }
  }

  const headRaw = (message.head && typeof message.head === 'object')
    ? message.head as Record<string, unknown>
    : {};

  return {
    type: 'arkit-face-frame',
    v: ARKIT_FACE_PROTOCOL_VERSION,
    t: asNumber(message.t, Date.now()),
    blendshapes,
    head: {
      x: asNumber(headRaw.x),
      y: asNumber(headRaw.y),
      z: asNumber(headRaw.z),
      w: asNumber(headRaw.w, 1),
    },
  };
}

export function createArkitFaceFrame(
  blendshapes: ArkitCoefficientMap,
  head: ArkitHeadPose,
  timestamp = Date.now(),
): ArkitFaceFrameMessage {
  return {
    type: 'arkit-face-frame',
    v: ARKIT_FACE_PROTOCOL_VERSION,
    t: timestamp,
    blendshapes,
    head,
  };
}

export const ARKIT_SHAPE_COUNT: 52 = ARKIT_BLENDSHAPE_NAMES.length as 52;
void (ARKIT_SHAPE_COUNT satisfies 52);
