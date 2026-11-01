/**
 * ARKit 52 blendshape names and VRCFaceTracking-aligned VRM mapping.
 *
 * Safari does not expose ARKit / TrueDepth blendshapes to the web. These names
 * are the contract used by:
 * - MediaPipe Face Landmarker (browser, ARKit-named coefficients)
 * - The optional local iOS companion (native ARKit FaceTracking)
 * - VRCFaceTracking's ARKit configuration table
 *
 * @see https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation
 * @see https://docs.vrcft.io/docs/tutorial-avatars/tutorial-avatars-extras/compatibility/arkit
 */

export const ARKIT_BLENDSHAPE_NAMES = [
  'eyeBlinkLeft',
  'eyeLookDownLeft',
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeSquintLeft',
  'eyeWideLeft',
  'eyeBlinkRight',
  'eyeLookDownRight',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeSquintRight',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawRight',
  'jawOpen',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
] as const;

export type ArkitBlendshapeName = (typeof ARKIT_BLENDSHAPE_NAMES)[number];

export type ArkitCoefficientMap = Partial<Record<ArkitBlendshapeName, number>>;

const ARKIT_NAME_SET = new Set<string>(ARKIT_BLENDSHAPE_NAMES);

export function isArkitBlendshapeName(name: string): name is ArkitBlendshapeName {
  return ARKIT_NAME_SET.has(name);
}

export function emptyArkitCoefficients(): Record<ArkitBlendshapeName, number> {
  const result = {} as Record<ArkitBlendshapeName, number>;
  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    result[name] = 0;
  }
  return result;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Alternate names a VRM may use for an ARKit coefficient.
 * Includes VRM 1.0 presets, VRoid, UniVRM, and VMC aliases.
 */
export const ARKIT_TO_VRM_ALIASES: Record<ArkitBlendshapeName, readonly string[]> = {
  eyeBlinkLeft: ['eyeBlinkLeft', 'BlinkLeft', 'blinkLeft', 'blink_l', 'Blink_L'],
  eyeLookDownLeft: ['eyeLookDownLeft', 'LookDown'],
  eyeLookInLeft: ['eyeLookInLeft', 'LookRight'],
  eyeLookOutLeft: ['eyeLookOutLeft', 'LookLeft'],
  eyeLookUpLeft: ['eyeLookUpLeft', 'LookUp'],
  eyeSquintLeft: ['eyeSquintLeft'],
  eyeWideLeft: ['eyeWideLeft'],
  eyeBlinkRight: ['eyeBlinkRight', 'BlinkRight', 'blinkRight', 'blink_r', 'Blink_R'],
  eyeLookDownRight: ['eyeLookDownRight', 'LookDown'],
  eyeLookInRight: ['eyeLookInRight', 'LookLeft'],
  eyeLookOutRight: ['eyeLookOutRight', 'LookRight'],
  eyeLookUpRight: ['eyeLookUpRight', 'LookUp'],
  eyeSquintRight: ['eyeSquintRight'],
  eyeWideRight: ['eyeWideRight'],
  jawForward: ['jawForward'],
  jawLeft: ['jawLeft'],
  jawRight: ['jawRight'],
  jawOpen: ['jawOpen', 'mouthOpen', 'A', 'Aa', 'aa', 'a'],
  mouthClose: ['mouthClose'],
  mouthFunnel: ['mouthFunnel', 'U', 'Ou', 'ou', 'u'],
  mouthPucker: ['mouthPucker', 'O', 'Oh', 'oh', 'o'],
  mouthLeft: ['mouthLeft'],
  mouthRight: ['mouthRight'],
  mouthSmileLeft: ['mouthSmileLeft', 'mouthSmile'],
  mouthSmileRight: ['mouthSmileRight', 'mouthSmile'],
  mouthFrownLeft: ['mouthFrownLeft'],
  mouthFrownRight: ['mouthFrownRight'],
  mouthDimpleLeft: ['mouthDimpleLeft'],
  mouthDimpleRight: ['mouthDimpleRight'],
  mouthStretchLeft: ['mouthStretchLeft'],
  mouthStretchRight: ['mouthStretchRight'],
  mouthRollLower: ['mouthRollLower'],
  mouthRollUpper: ['mouthRollUpper'],
  mouthShrugLower: ['mouthShrugLower'],
  mouthShrugUpper: ['mouthShrugUpper'],
  mouthPressLeft: ['mouthPressLeft'],
  mouthPressRight: ['mouthPressRight'],
  mouthLowerDownLeft: ['mouthLowerDownLeft'],
  mouthLowerDownRight: ['mouthLowerDownRight'],
  mouthUpperUpLeft: ['mouthUpperUpLeft'],
  mouthUpperUpRight: ['mouthUpperUpRight'],
  browDownLeft: ['browDownLeft', 'BrowsDown'],
  browDownRight: ['browDownRight', 'BrowsDown'],
  browInnerUp: ['browInnerUp', 'BrowsUp', 'Surprised', 'surprised', 'surprise'],
  browOuterUpLeft: ['browOuterUpLeft', 'BrowsUp'],
  browOuterUpRight: ['browOuterUpRight', 'BrowsUp'],
  cheekPuff: ['cheekPuff'],
  cheekSquintLeft: ['cheekSquintLeft'],
  cheekSquintRight: ['cheekSquintRight'],
  noseSneerLeft: ['noseSneerLeft'],
  noseSneerRight: ['noseSneerRight'],
  tongueOut: ['tongueOut'],
};

/**
 * VRM 1.0 preset expressions derived from ARKit coefficients when the avatar
 * does not ship the 52 ARKit shapes. Weights follow VRCFaceTracking practice:
 * visemes from jaw/mouth, blinks from eyeBlink*, look from eyeLook*, emotion
 * from smile/frown/brow.
 */
export interface VrmPresetWeights {
  blink: number;
  blinkLeft: number;
  blinkRight: number;
  lookUp: number;
  lookDown: number;
  lookLeft: number;
  lookRight: number;
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
  happy: number;
  angry: number;
  sad: number;
  surprised: number;
  relaxed: number;
}

export const VRM_PRESET_ALIASES: Record<keyof VrmPresetWeights, readonly string[]> = {
  blink: ['blink', 'Blink', 'eyeBlink'],
  blinkLeft: ['blinkLeft', 'BlinkLeft', 'blink_l', 'Blink_L'],
  blinkRight: ['blinkRight', 'BlinkRight', 'blink_r', 'Blink_R'],
  lookUp: ['lookUp', 'LookUp'],
  lookDown: ['lookDown', 'LookDown'],
  lookLeft: ['lookLeft', 'LookLeft'],
  lookRight: ['lookRight', 'LookRight'],
  aa: ['aa', 'Aa', 'A', 'a'],
  ih: ['ih', 'Ih', 'I', 'i'],
  ou: ['ou', 'Ou', 'U', 'u'],
  ee: ['ee', 'Ee', 'E', 'e'],
  oh: ['oh', 'Oh', 'O', 'o'],
  happy: ['happy', 'Happy', 'Joy', 'joy', 'Fun', 'fun'],
  angry: ['angry', 'Angry', 'Anger', 'anger'],
  sad: ['sad', 'Sad', 'Sorrow', 'sorrow'],
  surprised: ['surprised', 'Surprised', 'Surprise', 'surprise'],
  relaxed: ['relaxed', 'Relaxed', 'neutral', 'Neutral'],
};

export function deriveVrmPresets(coeffs: ArkitCoefficientMap): VrmPresetWeights {
  const get = (name: ArkitBlendshapeName) => clamp01(coeffs[name] ?? 0);

  const blinkLeft = get('eyeBlinkLeft');
  const blinkRight = get('eyeBlinkRight');
  const lookUp = average([get('eyeLookUpLeft'), get('eyeLookUpRight')]);
  const lookDown = average([get('eyeLookDownLeft'), get('eyeLookDownRight')]);
  const lookLeft = average([get('eyeLookOutLeft'), get('eyeLookInRight')]);
  const lookRight = average([get('eyeLookOutRight'), get('eyeLookInLeft')]);
  const smile = average([get('mouthSmileLeft'), get('mouthSmileRight')]);
  const frown = average([get('mouthFrownLeft'), get('mouthFrownRight')]);
  const browUp = Math.max(get('browInnerUp'), get('browOuterUpLeft'), get('browOuterUpRight'));
  const browDown = average([get('browDownLeft'), get('browDownRight')]);
  const jaw = get('jawOpen');
  const funnel = get('mouthFunnel');
  const pucker = get('mouthPucker');
  const stretch = average([get('mouthStretchLeft'), get('mouthStretchRight')]);
  const sneer = average([get('noseSneerLeft'), get('noseSneerRight')]);

  return {
    blink: Math.max(blinkLeft, blinkRight),
    blinkLeft,
    blinkRight,
    lookUp,
    lookDown,
    lookLeft,
    lookRight,
    aa: jaw,
    ih: clamp01(stretch * 0.85),
    ou: funnel,
    ee: clamp01(smile * 0.35 + stretch * 0.5),
    oh: pucker,
    happy: smile,
    angry: clamp01(browDown * 0.7 + sneer * 0.5),
    sad: frown,
    surprised: clamp01(browUp * 0.8 + jaw * 0.25),
    relaxed: clamp01(1 - Math.max(smile, frown, browUp, jaw)),
  };
}
