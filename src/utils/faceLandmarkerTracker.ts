import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { categoriesToArkitCoefficients } from './blendshapeMapper';
import type { ArkitCoefficientMap } from './arkitBlendshapes';

const TASKS_VISION_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const FACE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface FaceLandmarkerFrame {
  blendshapes: ArkitCoefficientMap;
  landmarks: Array<{ x: number; y: number; z?: number }>;
  transformationMatrix: number[] | null;
  timestampMs: number;
}

/**
 * MediaPipe Face Landmarker (tasks-vision) — the best in-browser path on
 * iPhone Safari. Outputs ARKit-named blendshapes. This is not TrueDepth.
 */
export class FaceLandmarkerTracker {
  private landmarker: FaceLandmarker | null = null;
  private initPromise: Promise<void> | null = null;
  private lastVideoTimestamp = -1;
  private failed = false;

  isReady() {
    return this.landmarker !== null;
  }

  hasFailed() {
    return this.failed;
  }

  async init() {
    if (this.landmarker || this.failed) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.createLandmarker();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async createLandmarker() {
    try {
      const fileset = await FilesetResolver.forVisionTasks(TASKS_VISION_WASM);
      const tryDelegate = async (delegate: 'GPU' | 'CPU') =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL,
            delegate,
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        });

      try {
        this.landmarker = await tryDelegate('GPU');
      } catch (gpuError) {
        console.warn('[FaceLandmarkerTracker] GPU delegate failed, trying CPU', gpuError);
        this.landmarker = await tryDelegate('CPU');
      }
      console.log('[FaceLandmarkerTracker] Ready');
    } catch (error) {
      this.failed = true;
      this.landmarker = null;
      console.warn('[FaceLandmarkerTracker] Failed to initialize; Holistic fallback remains available', error);
    }
  }

  detect(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerFrame | null {
    if (!this.landmarker) return null;
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    // detectForVideo requires strictly increasing timestamps.
    const ts = timestampMs <= this.lastVideoTimestamp ? this.lastVideoTimestamp + 1 : timestampMs;
    this.lastVideoTimestamp = ts;

    let result: FaceLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(video, ts);
    } catch (error) {
      console.warn('[FaceLandmarkerTracker] detectForVideo failed', error);
      return null;
    }

    const blendshapeCategories = result.faceBlendshapes?.[0]?.categories ?? [];
    const landmarks = result.faceLandmarks?.[0] ?? [];
    if (blendshapeCategories.length === 0 && landmarks.length === 0) return null;

    const matrixData = result.facialTransformationMatrixes?.[0];
    const transformationMatrix = matrixData
      ? Array.from((matrixData as { data?: ArrayLike<number> }).data ?? [])
      : null;

    return {
      blendshapes: categoriesToArkitCoefficients(blendshapeCategories),
      landmarks: landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
      transformationMatrix: transformationMatrix && transformationMatrix.length === 16
        ? transformationMatrix
        : null,
      timestampMs: ts,
    };
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastVideoTimestamp = -1;
  }
}

export const faceLandmarkerTracker = new FaceLandmarkerTracker();
