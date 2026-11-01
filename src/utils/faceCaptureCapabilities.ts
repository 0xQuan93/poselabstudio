/**
 * Honest Face / XR capability detection.
 *
 * Verified platform limits (do not contradict these in UI copy):
 * 1. Safari / iOS has NO WebXR `immersive-ar` and NO browser ARKit face blendshapes.
 * 2. Safari WebXR `immersive-vr` is visionOS-oriented, not iPhone TrueDepth.
 * 3. vrManager "Facial XR masks" hide avatar face meshes for headset cameras —
 *    they are not TrueDepth ARKit.
 */

export type FaceCaptureTier =
  | 'arkit-companion'
  | 'webxr-ar'
  | 'mediapipe-face'
  | 'unavailable';

export interface FaceCaptureCapabilities {
  isIOS: boolean;
  isIPadOS: boolean;
  isSafari: boolean;
  isVisionOS: boolean;
  isAndroid: boolean;
  isSecureContext: boolean;
  hasCamera: boolean;
  hasWebXR: boolean;
  webxrImmersiveAR: boolean;
  webxrImmersiveVR: boolean;
  companionFlagEnabled: boolean;
  recommendedTier: FaceCaptureTier;
  recommendedLabel: string;
  limitationNotes: string[];
}

function readUserAgent(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent || '';
}

export function detectClientPlatform(userAgent = readUserAgent()) {
  const ua = userAgent;
  const isIOS = /iPhone|iPod/.test(ua);
  const isIPadOS = /iPad/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isVisionOS = /AppleVision|Reality/.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|Android/i.test(ua);
  return { isIOS, isIPadOS, isVisionOS, isAndroid, isSafari };
}

export function isArkitFaceBridgeEnabled(): boolean {
  try {
    return import.meta.env.VITE_ENABLE_ARKIT_FACE_BRIDGE === 'true';
  } catch {
    return false;
  }
}

export async function detectFaceCaptureCapabilities(): Promise<FaceCaptureCapabilities> {
  const platform = detectClientPlatform();
  const isSecureContext = typeof window === 'undefined' ? false : window.isSecureContext || window.location.hostname === 'localhost';
  const hasCamera = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const xr = typeof navigator !== 'undefined' ? navigator.xr : undefined;
  const hasWebXR = Boolean(xr?.isSessionSupported);

  let webxrImmersiveAR = false;
  let webxrImmersiveVR = false;
  if (xr && isSecureContext) {
    try {
      webxrImmersiveAR = await xr.isSessionSupported('immersive-ar');
    } catch {
      webxrImmersiveAR = false;
    }
    try {
      webxrImmersiveVR = await xr.isSessionSupported('immersive-vr');
    } catch {
      webxrImmersiveVR = false;
    }
  }

  const companionFlagEnabled = isArkitFaceBridgeEnabled();
  const onAppleMobileBrowser = (platform.isIOS || platform.isIPadOS) && platform.isSafari;

  // iOS Safari never supports immersive-ar. Do not advertise it.
  if (onAppleMobileBrowser) {
    webxrImmersiveAR = false;
  }

  let recommendedTier: FaceCaptureTier = 'unavailable';
  if (companionFlagEnabled) {
    recommendedTier = 'arkit-companion';
  } else if (webxrImmersiveAR) {
    recommendedTier = 'webxr-ar';
  } else if (hasCamera) {
    recommendedTier = 'mediapipe-face';
  }

  const limitationNotes: string[] = [];
  if (onAppleMobileBrowser) {
    limitationNotes.push(
      'iPhone Safari cannot use WebXR immersive-ar or native ARKit TrueDepth blendshapes. PoseLab uses the front camera with MediaPipe Face Landmarker and maps those coefficients to ARKit-named VRM expressions.',
    );
    if (webxrImmersiveVR) {
      limitationNotes.push(
        'Safari WebXR immersive-vr is visionOS-oriented. It is not iPhone face tracking.',
      );
    }
  } else if (!webxrImmersiveAR) {
    limitationNotes.push(
      'WebXR immersive-ar is not available in this browser. Floor-tracked AR stays on Chrome Android / compatible headsets.',
    );
  }
  if (!hasCamera) {
    limitationNotes.push('This browser cannot open a camera. Facial tracking is unavailable.');
  }
  if (companionFlagEnabled) {
    limitationNotes.push(
      'Native ARKit companion is feature-flagged on. Connect the local iPhone FaceTracking app over LAN — blendshapes never leave your network.',
    );
  }

  const recommendedLabel = {
    'arkit-companion': 'Native ARKit companion (LAN)',
    'webxr-ar': 'WebXR immersive-AR',
    'mediapipe-face': 'Browser Face Landmarker',
    unavailable: 'No face capture path',
  }[recommendedTier];

  return {
    ...platform,
    isSecureContext,
    hasCamera,
    hasWebXR,
    webxrImmersiveAR,
    webxrImmersiveVR,
    companionFlagEnabled,
    recommendedTier,
    recommendedLabel,
    limitationNotes,
  };
}

export function describeCaptureTier(tier: FaceCaptureTier): { title: string; detail: string } {
  switch (tier) {
    case 'arkit-companion':
      return {
        title: 'Native ARKit (iPhone app)',
        detail: 'TrueDepth 52 blendshapes + head pose over a LAN-only WebSocket. Off by default; never uploaded.',
      };
    case 'webxr-ar':
      return {
        title: 'WebXR immersive-AR',
        detail: 'Browser ARCore / headset AR for floor tracking. Not available in iOS Safari.',
      };
    case 'mediapipe-face':
      return {
        title: 'Browser Face Landmarker',
        detail: 'Front camera + MediaPipe. Blendshapes use ARKit names, then map onto your VRM. This is the iPhone Safari path.',
      };
    default:
      return {
        title: 'Unavailable',
        detail: 'No camera or XR path detected.',
      };
  }
}
