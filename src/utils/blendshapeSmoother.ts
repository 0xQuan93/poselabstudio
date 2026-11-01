import { OneEuroFilter } from './OneEuroFilter';
import { ARKIT_BLENDSHAPE_NAMES, clamp01, type ArkitBlendshapeName, type ArkitCoefficientMap } from './arkitBlendshapes';

export interface BlendshapeSmootherOptions {
  /** Minimum cutoff (Hz). Lower = more smoothing when still. */
  minCutoff?: number;
  /** Speed coefficient. Higher = less lag when moving fast. */
  beta?: number;
  /** Eye/blink cutoff override. */
  eyeMinCutoff?: number;
}

const DEFAULTS: Required<BlendshapeSmootherOptions> = {
  minCutoff: 1.0,
  beta: 0.5,
  eyeMinCutoff: 2.0,
};

function isEyeShape(name: ArkitBlendshapeName): boolean {
  return name.startsWith('eye');
}

/**
 * Per-coefficient OneEuroFilter for ARKit blendshapes.
 * Use this for unit tests and for any path that needs smoothing before
 * MotionCaptureManager's existing expression filters.
 */
export class BlendshapeSmoother {
  private readonly filters = new Map<ArkitBlendshapeName, OneEuroFilter>();
  private readonly options: Required<BlendshapeSmootherOptions>;

  constructor(options: BlendshapeSmootherOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  reset() {
    this.filters.clear();
  }

  filter(coeffs: ArkitCoefficientMap, timestampSeconds: number): ArkitCoefficientMap {
    const smoothed: ArkitCoefficientMap = {};
    for (const name of ARKIT_BLENDSHAPE_NAMES) {
      const value = coeffs[name];
      if (value === undefined) continue;
      let filter = this.filters.get(name);
      if (!filter) {
        const minCutoff = isEyeShape(name) ? this.options.eyeMinCutoff : this.options.minCutoff;
        filter = new OneEuroFilter(minCutoff, this.options.beta);
        this.filters.set(name, filter);
      }
      smoothed[name] = clamp01(filter.filter(value, timestampSeconds));
    }
    return smoothed;
  }
}
