import {
  ARKIT_BLENDSHAPE_NAMES,
  ARKIT_TO_VRM_ALIASES,
  VRM_PRESET_ALIASES,
  clamp01,
  deriveVrmPresets,
  emptyArkitCoefficients,
  isArkitBlendshapeName,
  type ArkitBlendshapeName,
  type ArkitCoefficientMap,
} from './arkitBlendshapes';

export interface BlendshapeTarget {
  name: string;
  value: number;
}

export interface MappedBlendshapeSet {
  /** Values keyed by the avatar's actual expression names. */
  targets: Record<string, number>;
  /** How many of the 52 ARKit shapes the avatar exposes directly. */
  directArkitHits: number;
  /** How many VRM preset aliases were applied as a fallback. */
  presetHits: number;
}

export interface NeutralCalibration {
  rest: ArkitCoefficientMap;
}

/**
 * Normalize a raw tracker label (MediaPipe, ARKit, VMC) to an ARKit name.
 */
export function normalizeBlendshapeLabel(label: string): ArkitBlendshapeName | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (isArkitBlendshapeName(trimmed)) return trimmed;

  const camel = trimmed.replace(/^_+/, '');
  if (isArkitBlendshapeName(camel)) return camel;

  const lower = trimmed.toLowerCase();
  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

/**
 * Convert a MediaPipe Face Landmarker category list into an ARKit map.
 */
export function categoriesToArkitCoefficients(
  categories: Array<{ categoryName?: string; score?: number }>,
): ArkitCoefficientMap {
  const coeffs: ArkitCoefficientMap = {};
  for (const category of categories) {
    const name = normalizeBlendshapeLabel(category.categoryName ?? '');
    if (!name) continue;
    coeffs[name] = clamp01(category.score ?? 0);
  }
  return coeffs;
}

/**
 * Subtract a captured rest pose so a neutral face reads as zeros.
 */
export function applyNeutralCalibration(
  coeffs: ArkitCoefficientMap,
  rest: ArkitCoefficientMap | undefined,
): ArkitCoefficientMap {
  if (!rest) return { ...coeffs };
  const calibrated: ArkitCoefficientMap = {};
  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    const raw = coeffs[name] ?? 0;
    const restValue = rest[name] ?? 0;
    calibrated[name] = clamp01(raw - restValue);
  }
  return calibrated;
}

/**
 * Map ARKit coefficients onto the expression names a VRM actually has.
 *
 * Direct ARKit names win. VRM 1.0 presets are filled in only when the avatar
 * does not already expose that shape from the 52-coefficient table.
 */
export function mapArkitToVrm(
  coeffs: ArkitCoefficientMap,
  availableNames: Iterable<string>,
): MappedBlendshapeSet {
  const available = new Set(availableNames);
  const targets: Record<string, number> = {};
  let directArkitHits = 0;
  let presetHits = 0;

  const assign = (candidates: readonly string[], value: number) => {
    const clamped = clamp01(value);
    for (const candidate of candidates) {
      if (!available.has(candidate)) continue;
      const previous = targets[candidate];
      targets[candidate] = previous === undefined ? clamped : Math.max(previous, clamped);
      return true;
    }
    return false;
  };

  for (const name of ARKIT_BLENDSHAPE_NAMES) {
    const value = coeffs[name];
    if (value === undefined) continue;
    if (assign(ARKIT_TO_VRM_ALIASES[name], value)) {
      if (available.has(name)) directArkitHits += 1;
    }
  }

  const presets = deriveVrmPresets(coeffs);
  (Object.keys(presets) as Array<keyof typeof presets>).forEach((preset) => {
    const aliases = VRM_PRESET_ALIASES[preset];
    const alreadyBound = aliases.some((alias) => alias in targets);
    if (alreadyBound) return;
    if (assign(aliases, presets[preset])) {
      presetHits += 1;
    }
  });

  return { targets, directArkitHits, presetHits };
}

export interface KalidokitFaceLike {
  eye?: { l?: number; r?: number };
  pupil?: { x?: number; y?: number };
  brow?: number;
  mouth?: {
    open?: number;
    shape?: { A?: number; E?: number; I?: number; O?: number; U?: number };
  };
  smile?: number;
}

/**
 * Approximate ARKit coefficients from Kalidokit Face.solve() so the Holistic
 * fallback shares the same VRM mapping path as Face Landmarker / native ARKit.
 */
export function kalidokitFaceToArkit(rig: KalidokitFaceLike): ArkitCoefficientMap {
  const coeffs = emptyArkitCoefficients();
  const blinkL = clamp01(1 - (rig.eye?.l ?? 1));
  const blinkR = clamp01(1 - (rig.eye?.r ?? 1));
  coeffs.eyeBlinkLeft = blinkL;
  coeffs.eyeBlinkRight = blinkR;

  const pupilX = rig.pupil?.x ?? 0;
  const pupilY = rig.pupil?.y ?? 0;
  if (pupilX > 0) {
    coeffs.eyeLookOutRight = clamp01(pupilX);
    coeffs.eyeLookInLeft = clamp01(pupilX);
  } else if (pupilX < 0) {
    coeffs.eyeLookOutLeft = clamp01(-pupilX);
    coeffs.eyeLookInRight = clamp01(-pupilX);
  }
  if (pupilY > 0) {
    coeffs.eyeLookDownLeft = clamp01(pupilY);
    coeffs.eyeLookDownRight = clamp01(pupilY);
  } else if (pupilY < 0) {
    coeffs.eyeLookUpLeft = clamp01(-pupilY);
    coeffs.eyeLookUpRight = clamp01(-pupilY);
  }

  const brow = clamp01(rig.brow ?? 0);
  coeffs.browInnerUp = brow;
  coeffs.browOuterUpLeft = brow * 0.6;
  coeffs.browOuterUpRight = brow * 0.6;

  const shape = rig.mouth?.shape;
  const open = clamp01(rig.mouth?.open ?? shape?.A ?? 0);
  coeffs.jawOpen = open;
  coeffs.mouthFunnel = clamp01(shape?.U ?? 0);
  coeffs.mouthPucker = clamp01(shape?.O ?? 0);
  coeffs.mouthStretchLeft = clamp01(shape?.I ?? 0);
  coeffs.mouthStretchRight = clamp01(shape?.I ?? 0);
  coeffs.mouthSmileLeft = clamp01(rig.smile ?? shape?.E ?? 0);
  coeffs.mouthSmileRight = clamp01(rig.smile ?? shape?.E ?? 0);

  return coeffs;
}

export function mergeArkitCoefficients(
  ...maps: Array<ArkitCoefficientMap | undefined>
): ArkitCoefficientMap {
  const merged: ArkitCoefficientMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const name of ARKIT_BLENDSHAPE_NAMES) {
      const value = map[name];
      if (value === undefined) continue;
      merged[name] = clamp01(Math.max(merged[name] ?? 0, value));
    }
  }
  return merged;
}
