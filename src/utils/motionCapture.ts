// MediaPipe is loaded dynamically or via global to avoid Vite ESM issues.
type Results = any;

import * as Kalidokit from 'kalidokit';
import { VRM, VRMHumanBoneName, type VRMPose } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { motionEngine } from '../poses/motionEngine';
import { sceneManager } from '../three/sceneManager';
import { OneEuroFilter, OneEuroFilterQuat, OneEuroFilterVec3 } from './OneEuroFilter';
import { live2dManager } from '../live2d/live2dManager';
import { vmcFrameBuffer } from './vmcInput';
import { voiceLipSync } from './voiceLipSync';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';
import { getObjectBounds } from '../three/utils/boundsUtils';
import { FaceMaskCompositor, type FaceMaskDebugFrame } from './faceMaskCompositor';

// ======================
// Configuration Constants
// ======================

// MediaPipe Configuration
const HOLISTIC_CONFIG = {
  modelComplexity: 1 as const,
  smoothLandmarks: true,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
  refineFaceLandmarks: true,
};

// Helper to calculate smile (Moved from worker)
function calculateSmile(landmarks: any[]): number {
    if (!landmarks || landmarks.length < 300) return 0;
    const y10 = landmarks[10].y;
    const y152 = landmarks[152].y;
    const faceHeight = Math.abs(y152 - y10);
    if (faceHeight === 0) return 0;
    const leftCornerY = landmarks[61].y;
    const rightCornerY = landmarks[291].y;
    const avgCornerY = (leftCornerY + rightCornerY) / 2;
    const upperLipY = landmarks[0].y; 
    const lowerLipY = landmarks[17].y; 
    const centerMouthY = (upperLipY + lowerLipY) / 2;
    const delta = centerMouthY - avgCornerY;
    const ratio = delta / faceHeight;
    const minRatio = 0.02; 
    const maxRatio = 0.08;
    // Clamp 0-1
    return Math.max(0, Math.min(1, (ratio - minRatio) / (maxRatio - minRatio)));
}

/** Smoothing configuration for motion capture */
const SMOOTHING = {
  // OneEuroFilter parameters
  MIN_CUTOFF: 1.0,  // Hz. Lower = more smoothing when slow.
  BETA: 0.5,        // Speed coefficient. Higher = less lag when moving fast.
  D_CUTOFF: 1.0,    // Derivative cutoff.
  
  // Specific overrides
  EYE_MIN_CUTOFF: 2.0, // Eyes move faster
  HEAD_MIN_CUTOFF: 0.5, // Head is heavier
};

/** VMC-specific smoothing configuration - tuned for external motion capture */
const VMC_SMOOTHING = {
  // Very low minCutoff = very aggressive smoothing when slow/stationary (kills micro-jitter)
  MIN_CUTOFF: 0.25,
  // Very low beta = prioritize smoothness over responsiveness
  BETA: 0.12,
  // Head needs extra smoothing as it's most visible
  HEAD_MIN_CUTOFF: 0.2,
  HEAD_BETA: 0.08,
  // Hands can be slightly snappier but still smooth
  HAND_MIN_CUTOFF: 0.4,
  HAND_BETA: 0.2,
  // Root position needs very strong smoothing to prevent body wobble
  ROOT_MIN_CUTOFF: 0.2,
  ROOT_BETA: 0.1,
  // Expression smoothing (non-mouth expressions)
  EXPRESSION_MIN_CUTOFF: 0.6,
  EXPRESSION_BETA: 0.2,
  // Velocity deadzone - ignore rotational changes below this threshold (radians)
  // Increased for more aggressive jitter rejection
  ROTATION_DEADZONE: 0.003,
  // Position deadzone - ignore positional changes below this threshold (units)
  POSITION_DEADZONE: 0.002,
  // Additional exponential smoothing factor (0-1, lower = more smoothing)
  EXPONENTIAL_FACTOR: 0.2,
};

/** Gaze sensitivity multiplier for eye tracking */
const GAZE_SENSITIVITY = 1.5;

/** Deadzone for eye tracking to reduce micro-jitter */
const GAZE_DEADZONE = 0.04;

/** Head dampening factor (0.4 = 40% dampening, retain 60% of movement) */
const HEAD_DAMPENING = 0.4;

/** Upper body follow configuration - how much the torso follows head rotation */
const UPPER_BODY_FOLLOW = {
  /** How much spine follows head (0 = none, 1 = full) */
  SPINE: 0.15,
  /** How much chest follows head */
  CHEST: 0.25,
  /** How much upper chest follows head */
  UPPER_CHEST: 0.35,
  /** How much neck follows head (neck naturally follows more) */
  NECK: 0.5,
};

/** Hand joint constraints for stability (radians) */
const HAND_CONSTRAINTS = {
  WRIST: {
    x: [-1.6, 1.6],
    y: [-1.6, 1.6],
    z: [-1.6, 1.6],
  },
  FINGER: {
    x: [-0.5, 0.5],
    y: [-0.5, 0.5],
    z: [-1.9, 0.3],
  },
  THUMB: {
    x: [-0.8, 0.8],
    y: [-0.8, 0.8],
    z: [-1.6, 0.5],
  },
};

/** Camera capture configuration */
const CAMERA_CONFIG = {
  WIDTH: 640,
  HEIGHT: 480,
  /** Use front-facing camera on mobile devices */
  FACING_MODE: 'user' as const,
};

interface RecordedFrame {
    time: number;
    bones: Record<string, { rotation: THREE.Quaternion, position?: THREE.Vector3 }>;
}

interface FaceMaskVisibilityRecord {
    object: THREE.Object3D;
    visible: boolean;
}

interface FaceMaskMaterialRecord {
    material: THREE.Material;
    clippingPlanes: THREE.Plane[] | null;
    clipIntersection: boolean;
    clipShadows: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandLandmarks2D = any; 

export interface MotionCaptureStatus {
  isTracking: boolean;
  isFaceMaskMode: boolean;
  mode: 'full' | 'face';
  isHolisticReady: boolean;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  lastFrameAt: number | null;
  lastPoseAt: number | null;
  lastFaceAt: number | null;
  lastLeftHandAt: number | null;
  lastRightHandAt: number | null;
  lastFaceMaskAt: number | null;
  activeSources: Array<'camera' | 'vmc'>;
}

export interface FaceMaskAdjustments {
  offsetX: number;
  offsetY: number;
  lift: number;
  scale: number;
  depth: number;
  backset: number;
  crop: number;
}

const DEFAULT_FACE_MASK_ADJUSTMENTS: FaceMaskAdjustments = {
  offsetX: 0,
  offsetY: 0,
  lift: 0,
  scale: 1,
  depth: 0,
  backset: 0,
  crop: 0,
};

const FACE_MASK_NECK_CROP = {
  MIN_CLEARANCE: 0.025,
  MAX_CLEARANCE_RATIO: 0.045,
  NECK_SPAN_CLEARANCE: 0.32,
  FALLBACK_HEAD_DROP_RATIO: 0.14,
};

export class MotionCaptureManager {
  private holistic: any = null; // Main thread holistic instance
  private vrm?: VRM;
  private videoElement: HTMLVideoElement;
  private isTracking = false;
  private updateSources: Set<'camera' | 'vmc'> = new Set();
  
  // Track available blendshapes on the current avatar for fuzzy matching
  private availableBlendshapes: Set<string> = new Set();
  
  // Tracking Mode
  private mode: 'full' | 'face' = 'full';
  private faceMaskModeBeforeIsolation: 'full' | 'face' | null = null;

  // Smoothing State
  private targetFaceValues: Map<string, number> = new Map();
  private currentFaceValues: Map<string, number> = new Map();
  private targetBoneRotations: Map<string, THREE.Quaternion> = new Map();
  
  // OneEuroFilter Instances
  private boneFilters: Map<string, OneEuroFilterQuat> = new Map();
  private faceFilters: Map<string, OneEuroFilter> = new Map();
  private rootPositionFilter: OneEuroFilterVec3 = new OneEuroFilterVec3(SMOOTHING.MIN_CUTOFF, SMOOTHING.BETA);
  
  private targetRootPosition: THREE.Vector3 | null = null;
  private currentRootPosition: THREE.Vector3 = new THREE.Vector3();
  private tickDispose?: () => void; // Replaces updateLoopId
  private baseHipsPosition: THREE.Vector3 = new THREE.Vector3(0, 1.0, 0);

  // Custom Loop State for Camera
  private cameraLoopId?: number;
  private lastFrameAt: number | null = null;
  private lastPoseAt: number | null = null;
  private lastFaceAt: number | null = null;
  private lastLeftHandAt: number | null = null;
  private lastRightHandAt: number | null = null;
  private measuredFps = 0;
  private fpsFrameCount = 0;
  private fpsWindowStartedAt = 0;

  // Webcam XR face mask state
  private faceMaskMode = false;
  private faceMaskPoseSnapshot: VRMPose | null = null;
  private faceMaskSavedBaseHipsPosition = new THREE.Vector3(0, 1.0, 0);
  private faceMaskSavedCurrentRootPosition = new THREE.Vector3(0, 1.0, 0);
  private faceMaskSavedTargetRootPosition: THREE.Vector3 | null = null;
  private hasFaceMaskRootSnapshot = false;
  private faceMaskDepth = 1.25;
  private faceMaskBaseAvatarHeight = 1.65;
  private faceMaskHeadCenterOffset = 0.17;
  private hasFaceMaskOriginalTransform = false;
  private faceMaskOriginalScale = new THREE.Vector3(1, 1, 1);
  private faceMaskOriginalPosition = new THREE.Vector3();
  private faceMaskOriginalQuaternion = new THREE.Quaternion();
  private faceMaskNeutralHeadLocal = new THREE.Vector3();
  private faceMaskNeutralNeckLocal = new THREE.Vector3();
  private hasFaceMaskNeutralHead = false;
  private hasFaceMaskNeutralNeck = false;
  private faceMaskHeadRotation = new THREE.Quaternion();
  private currentFaceMaskHeadRotation = new THREE.Quaternion();
  private faceMaskHasHeadRotation = false;
  private faceMaskHasCurrentHeadRotation = false;
  private faceMaskTargetHeadWorld = new THREE.Vector3();
  private currentFaceMaskHeadWorld = new THREE.Vector3();
  private faceMaskTargetDepth = 1.25;
  private currentFaceMaskDepth = 1.25;
  private faceMaskReferenceFaceWidth = 0;
  private faceMaskLastFaceWidth = 0;
  private faceMaskTargetScale = 1;
  private currentFaceMaskScale = 1;
  private hasFaceMaskTarget = false;
  private lastFaceMaskAt: number | null = null;
  private faceMaskVisibilityRecords: FaceMaskVisibilityRecord[] = [];
  private faceMaskMaterialRecords: FaceMaskMaterialRecord[] = [];
  private faceMaskClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private originalRendererLocalClippingEnabled: boolean | null = null;
  private faceMaskAdjustments: FaceMaskAdjustments = { ...DEFAULT_FACE_MASK_ADJUSTMENTS };
  private faceMaskDebugEnabled = false;
  private faceMaskDebugFrame: FaceMaskDebugFrame | null = null;
  private faceMaskCompositor: FaceMaskCompositor;

  // Hand Tracking State
  private lastLeftHandLandmarks2D: HandLandmarks2D = null;
  private lastRightHandLandmarks2D: HandLandmarks2D = null;
  
  // Recording State
  private isRecording = false;
  private recordedFrames: RecordedFrame[] = [];
  private recordingStartTime = 0;

  // Calibration State
  private calibrationOffsets: Record<string, THREE.Quaternion> = {};
  private eyeCalibrationOffset = { x: 0, y: 0 };
  private hipsRefPosition: THREE.Vector3 | null = null;
  
  private shouldCalibrateBody = false;
  private shouldCalibrateFace = false;
  private shouldCalibrateVMC = true;
  private calibrationOffset: THREE.Vector3 = new THREE.Vector3();

  constructor(videoElement: HTMLVideoElement) {
    this.videoElement = videoElement;
    this.faceMaskCompositor = new FaceMaskCompositor(videoElement);
    this.initHolistic();
  }

  private initHolistic() {
      // Main Thread Initialization
      const Holistic = (window as any).Holistic;
      if (!Holistic) {
          console.error('[MotionCaptureManager] Holistic not found on window. Ensure the CDN script is loaded in index.html.');
          return;
      }
      this.holistic = new Holistic({
          locateFile: (file: string) => {
              return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629/${file}`;
          }
      });

      this.holistic.setOptions(HOLISTIC_CONFIG);
      this.holistic.onResults(this.handleHolisticResults.bind(this));
      console.log('[MotionCaptureManager] Holistic initialized on main thread');
  }

  private handleHolisticResults(results: Results) {
      const rigs: any = {};
      const width = this.videoElement.videoWidth;
      const height = this.videoElement.videoHeight;
      const now = performance.now();
      this.recordTrackingFrame(now);

      // 1. Pose
      const poseWorldLandmarks = (results as any).poseWorldLandmarks || (results as any).ea;
      if (results.poseLandmarks && poseWorldLandmarks) {
        this.lastPoseAt = now;
        rigs.pose = Kalidokit.Pose.solve(results.poseLandmarks, poseWorldLandmarks, {
          runtime: 'mediapipe',
          imageSize: { width, height }
        });
      }

      // 2. Face
      if (results.faceLandmarks) {
        this.lastFaceAt = now;
        this.updateFaceMaskTarget(results.faceLandmarks, now);
        rigs.face = Kalidokit.Face.solve(results.faceLandmarks, {
          runtime: 'mediapipe',
          imageSize: { width, height },
          smoothBlink: true,
          blinkSettings: [0.25, 0.75],
        });
        
        if (rigs.face) {
            rigs.face.smile = calculateSmile(results.faceLandmarks);
            if (rigs.face.eye && rigs.face.head) {
                rigs.face.eye = Kalidokit.Face.stabilizeBlink(rigs.face.eye, rigs.face.head.y, {
                    enableWink: false,
                    maxRot: 0.5,
                });
            }
        }
      }

      // 3. Hands
      if (results.rightHandLandmarks) {
        this.lastRightHandAt = now;
        rigs.rightHand = Kalidokit.Hand.solve(results.rightHandLandmarks, 'Right');
      }
      if (results.leftHandLandmarks) {
        this.lastLeftHandAt = now;
        rigs.leftHand = Kalidokit.Hand.solve(results.leftHandLandmarks, 'Left');
      }

      if (results.leftHandLandmarks || results.rightHandLandmarks) {
          this.lastLeftHandLandmarks2D = results.leftHandLandmarks;
          this.lastRightHandLandmarks2D = results.rightHandLandmarks;
      }
      
      // XR Face Mask is a head-only compositor. Keep expressions/head pose, but
      // do not let body, hand, or root tracking bend the mask's neutral base.
      if (!this.faceMaskMode && rigs.pose) this.applyPoseRig(rigs.pose);
      if (rigs.face) this.applyFaceRig(rigs.face);
      if (!this.faceMaskMode && rigs.rightHand) this.applyHandRig(rigs.rightHand, 'Right');
      if (!this.faceMaskMode && rigs.leftHand) this.applyHandRig(rigs.leftHand, 'Left');
  }

  setVRM(vrm: VRM | null) {
    const nextVrm = vrm ?? undefined;
    if (this.faceMaskMode && this.vrm && this.vrm !== nextVrm) {
      this.restoreFaceMaskBaseline();
      this.restoreFaceMaskVisibility();
      this.exitFaceMaskPoseIsolation();
    }

    this.vrm = vrm ?? undefined;
    this.targetRootPosition = null;
    this.calibrationOffset.set(0, 0, 0);
    this.shouldCalibrateVMC = true;

    if (!vrm) {
      this.baseHipsPosition.set(0, 1.0, 0);
      this.currentRootPosition.copy(this.baseHipsPosition);
      this.faceMaskPoseSnapshot = null;
      this.faceMaskModeBeforeIsolation = null;
      this.hasFaceMaskRootSnapshot = false;
      this.faceMaskSavedTargetRootPosition = null;
      this.updateAvailableBlendshapes();
      return;
    }

    const hipsNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hipsNode) {
      this.baseHipsPosition.copy(hipsNode.position);
    } else {
      this.baseHipsPosition.set(0, 1.0, 0);
    }
    this.currentRootPosition.copy(this.baseHipsPosition);
    this.updateAvailableBlendshapes();
    if (this.faceMaskMode) {
      this.enterFaceMaskPoseIsolation();
      this.captureFaceMaskBaseline();
      this.ensureFaceMaskVideoBackdrop();
      this.applyFaceMaskVisibility();
      if (this.faceMaskDebugEnabled) {
          this.ensureFaceMaskDebugOverlay();
      }
    }
  }

  setMode(mode: 'full' | 'face') {
      this.mode = mode;
      console.log('[MotionCaptureManager] Set mode:', mode);
  }

  private captureFaceMaskOriginalTransform() {
      if (!this.vrm || this.hasFaceMaskOriginalTransform) return;
      this.faceMaskOriginalScale.copy(this.vrm.scene.scale);
      this.faceMaskOriginalPosition.copy(this.vrm.scene.position);
      this.faceMaskOriginalQuaternion.copy(this.vrm.scene.quaternion);
      this.hasFaceMaskOriginalTransform = true;
  }

  private enterFaceMaskPoseIsolation() {
      if (!this.vrm?.humanoid || this.faceMaskPoseSnapshot) return;

      this.faceMaskPoseSnapshot = this.vrm.humanoid.getNormalizedPose();
      this.faceMaskModeBeforeIsolation = this.mode;
      this.faceMaskSavedBaseHipsPosition.copy(this.baseHipsPosition);
      this.faceMaskSavedCurrentRootPosition.copy(this.currentRootPosition);
      this.faceMaskSavedTargetRootPosition = this.targetRootPosition?.clone() ?? null;
      this.hasFaceMaskRootSnapshot = true;
      this.mode = 'face';

      this.captureFaceMaskOriginalTransform();

      this.targetBoneRotations.clear();
      this.boneFilters.clear();
      this.targetRootPosition = null;
      this.rootPositionFilter = new OneEuroFilterVec3(SMOOTHING.MIN_CUTOFF, SMOOTHING.BETA);
      this.faceMaskHeadRotation.identity();
      this.currentFaceMaskHeadRotation.identity();
      this.faceMaskHasHeadRotation = false;
      this.faceMaskHasCurrentHeadRotation = false;
      this.faceMaskReferenceFaceWidth = 0;
      this.faceMaskLastFaceWidth = 0;
      this.faceMaskTargetDepth = this.faceMaskDepth;
      this.currentFaceMaskDepth = this.faceMaskDepth;

      const neutralRootEuler = new THREE.Euler().setFromQuaternion(this.vrm.scene.quaternion, 'YXZ');
      neutralRootEuler.x = 0;
      neutralRootEuler.z = 0;
      this.vrm.scene.quaternion.setFromEuler(neutralRootEuler);
      this.vrm.humanoid.resetNormalizedPose();
      const hips = this.vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
      if (hips) {
          this.baseHipsPosition.copy(hips.position);
          this.currentRootPosition.copy(hips.position);
      } else {
          this.baseHipsPosition.set(0, 1.0, 0);
          this.currentRootPosition.copy(this.baseHipsPosition);
      }

      this.vrm.humanoid.update();
      this.vrm.update(0);
      this.vrm.scene.updateMatrixWorld(true);
      this.captureFaceMaskNeutralAnchors();
  }

  private exitFaceMaskPoseIsolation() {
      if (this.hasFaceMaskRootSnapshot) {
          this.baseHipsPosition.copy(this.faceMaskSavedBaseHipsPosition);
          this.currentRootPosition.copy(this.faceMaskSavedCurrentRootPosition);
          this.targetRootPosition = this.faceMaskSavedTargetRootPosition?.clone() ?? null;
          this.faceMaskSavedTargetRootPosition = null;
          this.hasFaceMaskRootSnapshot = false;
      }

      if (!this.vrm?.humanoid || !this.faceMaskPoseSnapshot) {
          this.faceMaskPoseSnapshot = null;
          this.faceMaskModeBeforeIsolation = null;
          return;
      }

      this.targetBoneRotations.clear();
      this.boneFilters.clear();
      this.vrm.humanoid.resetNormalizedPose();
      this.vrm.humanoid.setNormalizedPose(this.faceMaskPoseSnapshot);
      this.vrm.humanoid.update();
      this.vrm.update(0);
      this.vrm.scene.updateMatrixWorld(true);
      this.hasFaceMaskNeutralHead = false;
      this.hasFaceMaskNeutralNeck = false;
      this.faceMaskHeadRotation.identity();
      this.currentFaceMaskHeadRotation.identity();
      this.faceMaskHasHeadRotation = false;
      this.faceMaskHasCurrentHeadRotation = false;
      this.faceMaskReferenceFaceWidth = 0;
      this.faceMaskLastFaceWidth = 0;
      if (this.faceMaskModeBeforeIsolation) {
          this.mode = this.faceMaskModeBeforeIsolation;
      }
      this.faceMaskPoseSnapshot = null;
      this.faceMaskModeBeforeIsolation = null;
  }

  setFaceMaskMode(enabled: boolean) {
      if (enabled === this.faceMaskMode && enabled) {
          return;
      }

      this.faceMaskMode = enabled;
      this.hasFaceMaskTarget = false;
      this.lastFaceMaskAt = null;
      this.faceMaskDebugFrame = null;
      this.currentFaceMaskHeadWorld.set(0, 0, 0);
      this.faceMaskTargetDepth = this.faceMaskDepth;
      this.currentFaceMaskDepth = this.faceMaskDepth;

      if (!enabled) {
          this.restoreFaceMaskBaseline();
          this.restoreFaceMaskVisibility();
          this.disposeFaceMaskVideoBackdrop();
          this.disposeFaceMaskDebugOverlay();
          this.exitFaceMaskPoseIsolation();
          return;
      }

      if (!this.vrm) return;

      this.enterFaceMaskPoseIsolation();
      this.captureFaceMaskBaseline();
      this.ensureFaceMaskVideoBackdrop();
      this.applyFaceMaskVisibility();
      if (this.faceMaskDebugEnabled) {
          this.ensureFaceMaskDebugOverlay();
      }
  }

  setFaceMaskDebug(enabled: boolean) {
      this.faceMaskDebugEnabled = enabled;
      if (!enabled) {
          this.disposeFaceMaskDebugOverlay();
          return;
      }
      if (this.faceMaskMode) {
          this.ensureFaceMaskDebugOverlay();
      }
  }

  setFaceMaskAdjustments(adjustments: Partial<FaceMaskAdjustments>) {
      this.faceMaskAdjustments = {
          ...this.faceMaskAdjustments,
          ...adjustments,
      };
      this.faceMaskAdjustments.offsetX = THREE.MathUtils.clamp(this.faceMaskAdjustments.offsetX, -0.9, 0.9);
      this.faceMaskAdjustments.offsetY = THREE.MathUtils.clamp(this.faceMaskAdjustments.offsetY, -0.9, 1.4);
      this.faceMaskAdjustments.lift = THREE.MathUtils.clamp(this.faceMaskAdjustments.lift, -0.6, 1.2);
      this.faceMaskAdjustments.scale = THREE.MathUtils.clamp(this.faceMaskAdjustments.scale, 0.25, 3.4);
      this.faceMaskAdjustments.depth = THREE.MathUtils.clamp(this.faceMaskAdjustments.depth, -1.4, 2.2);
      this.faceMaskAdjustments.backset = THREE.MathUtils.clamp(this.faceMaskAdjustments.backset, -0.8, 4.0);
      this.faceMaskAdjustments.crop = THREE.MathUtils.clamp(this.faceMaskAdjustments.crop, -0.4, 0.9);
  }

  getFaceMaskAdjustments(): FaceMaskAdjustments {
      return { ...this.faceMaskAdjustments };
  }

  calibrateFaceMaskNeutral(): FaceMaskAdjustments | null {
      if (!this.faceMaskMode || !this.hasFaceMaskTarget) return null;

      this.calibrateFace();
      if (this.faceMaskLastFaceWidth > 0) {
          this.faceMaskReferenceFaceWidth = this.faceMaskLastFaceWidth;
      }
      this.currentFaceMaskHeadWorld.copy(this.faceMaskTargetHeadWorld);
      this.currentFaceMaskScale = this.faceMaskTargetScale;
      this.currentFaceMaskDepth = this.faceMaskTargetDepth;

      return this.getFaceMaskAdjustments();
  }

  resetFaceMaskAdjustments() {
      this.faceMaskAdjustments = { ...DEFAULT_FACE_MASK_ADJUSTMENTS };
  }

  getStatus(): MotionCaptureStatus {
    return {
      isTracking: this.isTracking,
      isFaceMaskMode: this.faceMaskMode,
      mode: this.mode,
      isHolisticReady: Boolean(this.holistic),
      videoWidth: this.videoElement.videoWidth || 0,
      videoHeight: this.videoElement.videoHeight || 0,
      fps: this.measuredFps,
      lastFrameAt: this.lastFrameAt,
      lastPoseAt: this.lastPoseAt,
      lastFaceAt: this.lastFaceAt,
      lastLeftHandAt: this.lastLeftHandAt,
      lastRightHandAt: this.lastRightHandAt,
      lastFaceMaskAt: this.lastFaceMaskAt,
      activeSources: Array.from(this.updateSources),
    };
  }

  getHandLandmarks2D() {
    return {
      left: this.lastLeftHandLandmarks2D,
      right: this.lastRightHandLandmarks2D,
    };
  }

  private updateAvailableBlendshapes() {
    this.availableBlendshapes.clear();
    this.targetFaceValues.clear();
    this.currentFaceValues.clear();
    this.targetBoneRotations.clear();
    
    // Reset filters
    this.boneFilters.clear();
    this.faceFilters.clear();
    this.rootPositionFilter = new OneEuroFilterVec3(SMOOTHING.MIN_CUTOFF, SMOOTHING.BETA);
    
    if (!this.vrm?.expressionManager) return;
    
    // Extract available expression names from VRM
    const manager = this.vrm.expressionManager as any;
    
    if (manager.expressionMap) {
       Object.keys(manager.expressionMap).forEach(name => this.availableBlendshapes.add(name));
    } else if (manager.expressions) {
       // eslint-disable-next-line @typescript-eslint/no-explicit-any
       manager.expressions.forEach((expr: any) => {
          if (expr.expressionName) this.availableBlendshapes.add(expr.expressionName);
       });
    } else if (manager._expressionMap) {
       Object.keys(manager._expressionMap).forEach(name => this.availableBlendshapes.add(name));
    }
    
    console.log('[MotionCaptureManager] Available blendshapes:', Array.from(this.availableBlendshapes));
  }

  async start(deviceId?: string) {
    if (this.isTracking) return;
    
    try {
        this.resetTrackingStats();
        if (this.vrm?.lookAt) {
            this.vrm.lookAt.target = undefined; 
        }

        // Custom MediaStream management to support device selection
        // Use provided deviceId or fall back to FACING_MODE
        const constraints: MediaStreamConstraints = {
            video: deviceId 
                ? { deviceId: { exact: deviceId }, width: CAMERA_CONFIG.WIDTH, height: CAMERA_CONFIG.HEIGHT }
                : { facingMode: CAMERA_CONFIG.FACING_MODE, width: CAMERA_CONFIG.WIDTH, height: CAMERA_CONFIG.HEIGHT }
        };

        console.log('[MotionCaptureManager] Requesting camera with constraints:', constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.videoElement.srcObject = stream;
        
        // Wait for video to be ready
        await new Promise<void>((resolve) => {
            this.videoElement.onloadedmetadata = () => {
                this.videoElement.play();
                resolve();
            };
        });

        // Start processing loop
        this.isTracking = true;
        this.startCameraProcessingLoop();
        this.startUpdateLoop('camera');
        this.recordingStartTime = performance.now();
    } catch (e) {
        console.error('Failed to start camera:', e);
        throw e;
    }
  }

  private startCameraProcessingLoop() {
      const loop = async () => {
          if (!this.videoElement.paused && !this.videoElement.ended && this.holistic) {
              await this.holistic.send({ image: this.videoElement });
          }
          if (this.videoElement.srcObject) {
               // Use requestVideoFrameCallback if available for better performance/sync
               if ('requestVideoFrameCallback' in this.videoElement) {
                   this.videoElement.requestVideoFrameCallback(loop);
               } else {
                   this.cameraLoopId = requestAnimationFrame(loop);
               }
          }
      };
      loop();
  }

  stop() {
    if (this.faceMaskMode) {
        this.setFaceMaskMode(false);
    }
    // Stop the custom loop
    if (this.cameraLoopId) {
        cancelAnimationFrame(this.cameraLoopId);
        this.cameraLoopId = undefined;
    }

    if (this.videoElement.srcObject) {
        const stream = this.videoElement.srcObject as MediaStream;
        stream.getTracks().forEach(track => {
            track.stop();
            console.log('[MotionCaptureManager] Stopped camera track:', track.label);
        });
        this.videoElement.srcObject = null;
    }
    
    this.videoElement.pause();
    
    this.isTracking = false;
    this.measuredFps = 0;
    this.stopUpdateLoop('camera');
  }
  
  startExternalInput() {
      // Reinitialize filters with VMC-specific parameters for better jitter reduction
      this.boneFilters.clear();
      this.faceFilters.clear();
      this.rootPositionFilter = new OneEuroFilterVec3(VMC_SMOOTHING.ROOT_MIN_CUTOFF, VMC_SMOOTHING.ROOT_BETA);
      this.startUpdateLoop('vmc');
  }

  stopExternalInput() {
      this.stopUpdateLoop('vmc');
  }

  applyExternalBoneRotation(boneName: VRMHumanBoneName, rotation: THREE.Quaternion) {
      if (this.faceMaskMode) {
          if (boneName === VRMHumanBoneName.Head) {
              this.faceMaskHeadRotation.copy(rotation);
              this.faceMaskHasHeadRotation = true;
          }
          return;
      }
      this.targetBoneRotations.set(boneName, rotation);
  }

  applyExternalRootPosition(position: THREE.Vector3) {
      if (this.faceMaskMode) return;
      if (this.shouldCalibrateVMC) {
          this.calibrationOffset.copy(position).negate(); 
          console.log('[MotionCaptureManager] VMC Calibrated. Offset:', this.calibrationOffset);
          this.shouldCalibrateVMC = false;
      }
      
      const calibratedPos = position.clone().add(this.calibrationOffset);
      this.targetRootPosition = calibratedPos.add(this.baseHipsPosition);
  }

  recalibrateVMC() {
      this.shouldCalibrateVMC = true;
  }

  private resetTrackingStats() {
      this.lastFrameAt = null;
      this.lastPoseAt = null;
      this.lastFaceAt = null;
      this.lastLeftHandAt = null;
      this.lastRightHandAt = null;
      this.measuredFps = 0;
      this.fpsFrameCount = 0;
      this.fpsWindowStartedAt = performance.now();
  }

  private recordTrackingFrame(now: number) {
      this.lastFrameAt = now;
      if (!this.fpsWindowStartedAt) {
          this.fpsWindowStartedAt = now;
      }
      this.fpsFrameCount += 1;
      const elapsed = now - this.fpsWindowStartedAt;
      if (elapsed >= 500) {
          this.measuredFps = Math.round((this.fpsFrameCount * 1000) / elapsed);
          this.fpsFrameCount = 0;
          this.fpsWindowStartedAt = now;
      }
  }

  applyExternalExpression(name: string, value: number) {
      // Skip mouth expressions if voice lip sync is active (local mic takes priority)
      if (voiceLipSync.getIsActive() && voiceLipSync.isExpressionControlled(name)) {
          return;
      }
      
      // 1. Try exact match
      if (this.availableBlendshapes.size === 0 || this.availableBlendshapes.has(name)) {
          this.targetFaceValues.set(name, value);
          if (this.availableBlendshapes.has(name)) return;
      }
      
      // 2. Try common VMC/ARKit aliases
      const aliases: Record<string, string[]> = {
          'fun': ['Fun', 'joy', 'Joy', 'Happy', 'happy'],
          'joy': ['Joy', 'joy', 'Happy', 'happy', 'Fun', 'fun'],
          'angry': ['Angry', 'angry', 'Anger', 'anger'],
          'sorrow': ['Sorrow', 'sorrow', 'Sad', 'sad'],
          'surprised': ['Surprised', 'surprised', 'Surprise', 'surprise'],
          'blink': ['Blink', 'blink'],
          'blink_l': ['BlinkLeft', 'blink_l', 'eyeBlinkLeft', 'LeftEyeBlink', 'blinkLeft'],
          'blink_r': ['BlinkRight', 'blink_r', 'eyeBlinkRight', 'RightEyeBlink', 'blinkRight'],
          'a': ['Aa', 'aa', 'mouthOpen'],
          'i': ['Ih', 'ih'],
          'u': ['Ou', 'ou'],
          'e': ['Ee', 'ee'],
          'o': ['Oh', 'oh', 'mouthPucker'],
          'lookleft': ['LookLeft', 'lookLeft', 'eyeLookInRight', 'eyeLookOutLeft'],
          'lookright': ['LookRight', 'lookRight', 'eyeLookInLeft', 'eyeLookOutRight'],
          'lookup': ['LookUp', 'lookUp', 'eyeLookUpLeft', 'eyeLookUpRight'],
          'lookdown': ['LookDown', 'lookDown', 'eyeLookDownLeft', 'eyLookDownRight'],
          'neutral': ['Neutral', 'neutral'],
          'relaxed': ['Relaxed', 'relaxed', 'Fun'],
      };
      
      const lowerName = name.toLowerCase();
      const candidates = aliases[lowerName];
      
      if (candidates) {
          for (const candidate of candidates) {
              if (this.availableBlendshapes.size === 0 || this.availableBlendshapes.has(candidate)) {
                  this.targetFaceValues.set(candidate, value);
                  return;
              }
          }
      }
  }

  private startUpdateLoop(source: 'camera' | 'vmc') {
      this.updateSources.add(source);
      if (this.tickDispose) {
          return;
      }
      this.tickDispose = sceneManager.registerTick((delta) => {
          this.updateFrame(delta);
      }, 30);
  }
  
  private stopUpdateLoop(source: 'camera' | 'vmc') {
      this.updateSources.delete(source);
      if (this.tickDispose && this.updateSources.size === 0) {
          this.tickDispose();
          this.tickDispose = undefined;
      }
  }

  private updateFrame(_delta: number) {
      if (!this.vrm || !this.vrm.humanoid) return;
      
      const timestamp = performance.now() / 1000;

      // Capture frame for recording if active (captures smoothed state)
      if (this.isRecording) {
          this.captureFrame();
      }
      
      // 1. Smooth Facial Expressions
      const isVMC = this.updateSources.has('vmc');
      const renderTimeMs = performance.now();

      if (this.vrm.expressionManager) {
          this.targetFaceValues.forEach((targetVal, name) => {
              // Skip mouth expressions if voice lip sync is active (local mic has priority)
              if (voiceLipSync.getIsActive() && voiceLipSync.isExpressionControlled(name)) {
                  return;
              }

              let filter = this.faceFilters.get(name);
              if (!filter) {
                  const lowerName = name.toLowerCase();
                  const isEyeRelated = lowerName.includes('eye') || lowerName.includes('blink') || lowerName.includes('look');

                  let minCutoff: number;
                  let beta: number;

                  if (isVMC) {
                      // VMC expressions - use tuned parameters
                      minCutoff = isEyeRelated ? SMOOTHING.EYE_MIN_CUTOFF : VMC_SMOOTHING.EXPRESSION_MIN_CUTOFF;
                      beta = VMC_SMOOTHING.EXPRESSION_BETA;
                  } else {
                      // Webcam - original parameters
                      minCutoff = isEyeRelated ? SMOOTHING.EYE_MIN_CUTOFF : SMOOTHING.MIN_CUTOFF;
                      beta = SMOOTHING.BETA;
                  }

                  filter = new OneEuroFilter(minCutoff, beta);
                  this.faceFilters.set(name, filter);
              }

              // For VMC: Use interpolated value from buffer for timing jitter reduction
              let valueToFilter = targetVal;
              if (isVMC) {
                  const interpolatedVal = vmcFrameBuffer.getInterpolatedExpression(name, renderTimeMs);
                  if (interpolatedVal !== null) {
                      valueToFilter = interpolatedVal;
                  }
              }

              const newVal = filter.filter(valueToFilter, timestamp);
              this.currentFaceValues.set(name, newVal);

              this.vrm!.expressionManager!.setValue(name, newVal);
          });
          this.vrm.expressionManager.update();
      }

      // 2. Smooth Bone Rotations
      if (this.faceMaskMode) {
          this.targetBoneRotations.clear();
      } else {
          this.targetBoneRotations.forEach((targetQ, boneName) => {
              if (this.mode === 'face' && !isVMC) {
                  const allowedBones = [
                      'head', 'neck',
                      'chest', 'upperchest', 'spine', // Hips removed to prevent full body rotation
                      'shoulder', 'arm', // Covers upperArm, lowerArm
                      'hand', 'thumb', 'index', 'middle', 'ring', 'little'
                  ];
                  if (!allowedBones.some(b => boneName.toLowerCase().includes(b))) return;
              }

              // @ts-expect-error - fix type error
              const node = this.vrm!.humanoid!.getNormalizedBoneNode(boneName);
              if (node) {
                  let filter = this.boneFilters.get(boneName);
                  if (!filter) {
                      const lowerBoneName = boneName.toLowerCase();

                      let minCutoff: number;
                      let beta: number;

                      if (isVMC) {
                          // VMC-specific tuned parameters based on bone type
                          if (lowerBoneName.includes('head')) {
                              minCutoff = VMC_SMOOTHING.HEAD_MIN_CUTOFF;
                              beta = VMC_SMOOTHING.HEAD_BETA;
                          } else if (lowerBoneName.includes('hand') || lowerBoneName.includes('thumb') ||
                              lowerBoneName.includes('index') || lowerBoneName.includes('middle') ||
                              lowerBoneName.includes('ring') || lowerBoneName.includes('little')) {
                              minCutoff = VMC_SMOOTHING.HAND_MIN_CUTOFF;
                              beta = VMC_SMOOTHING.HAND_BETA;
                          } else {
                              minCutoff = VMC_SMOOTHING.MIN_CUTOFF;
                              beta = VMC_SMOOTHING.BETA;
                          }
                      } else {
                          // Webcam mocap parameters
                          minCutoff = lowerBoneName.includes('head') ? SMOOTHING.HEAD_MIN_CUTOFF : SMOOTHING.MIN_CUTOFF;
                          beta = SMOOTHING.BETA;
                      }

                      filter = new OneEuroFilterQuat(minCutoff, beta);
                      this.boneFilters.set(boneName, filter);
                  }

                  // For VMC: Use SLERP-interpolated quaternion from buffer for timing jitter reduction
                  let quatToFilter = targetQ;
                  if (isVMC) {
                      const interpolatedQuat = vmcFrameBuffer.getInterpolatedBoneRotation(boneName, renderTimeMs);
                      if (interpolatedQuat) {
                          quatToFilter = interpolatedQuat;
                      }
                  }

                  const smoothed = filter.filter(quatToFilter.x, quatToFilter.y, quatToFilter.z, quatToFilter.w, timestamp);

                  // For VMC: Apply velocity deadzone to ignore micro-movements
                  if (isVMC) {
                      // Calculate angular difference from current pose
                      const currentQ = node.quaternion;
                      const dot = Math.abs(currentQ.x * smoothed.x + currentQ.y * smoothed.y +
                          currentQ.z * smoothed.z + currentQ.w * smoothed.w);
                      const angularDiff = 2 * Math.acos(Math.min(1, dot));

                      // Only apply if change is above deadzone threshold
                      if (angularDiff > VMC_SMOOTHING.ROTATION_DEADZONE) {
                          node.quaternion.set(smoothed.x, smoothed.y, smoothed.z, smoothed.w);
                      }
                      // If below threshold, keep current quaternion (no update = no jitter)
                  } else {
                      node.quaternion.set(smoothed.x, smoothed.y, smoothed.z, smoothed.w);
                  }
              }
          });
      }

      // 3. Smooth Root Position
      if (!this.faceMaskMode && ((this.mode === 'full' && this.targetRootPosition) || (isVMC && this.targetRootPosition))) {
          const hips = this.vrm.humanoid.getNormalizedBoneNode('hips');
          if (hips) {
             // For VMC: Use interpolated position from buffer for timing jitter reduction
             let posToFilter = this.targetRootPosition;
             if (isVMC && vmcFrameBuffer.hasRootPosition()) {
                 const interpolatedPos = vmcFrameBuffer.getInterpolatedRootPosition(renderTimeMs);
                 if (interpolatedPos) {
                     // Apply calibration offset to interpolated position (clone to avoid mutation)
                     posToFilter = interpolatedPos.clone().add(this.calibrationOffset).add(this.baseHipsPosition);
                 }
             }
             
             const smoothedPos = this.rootPositionFilter.filter(
                 posToFilter.x,
                 posToFilter.y,
                 posToFilter.z,
                 timestamp
             );
             
             // For VMC: Apply position deadzone to ignore micro-movements
             if (isVMC) {
                 const dx = smoothedPos.x - this.currentRootPosition.x;
                 const dy = smoothedPos.y - this.currentRootPosition.y;
                 const dz = smoothedPos.z - this.currentRootPosition.z;
                 const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                 
                 // Only update if movement is above threshold
                 if (distance > VMC_SMOOTHING.POSITION_DEADZONE) {
                     this.currentRootPosition.set(smoothedPos.x, smoothedPos.y, smoothedPos.z);
                     hips.position.copy(this.currentRootPosition);
                 }
                 // If below threshold, keep current position (no update = no jitter)
             } else {
                 this.currentRootPosition.set(smoothedPos.x, smoothedPos.y, smoothedPos.z);
                 hips.position.copy(this.currentRootPosition);
             }
          }
      }
      
      if (this.faceMaskMode) {
          this.applyFaceMaskFrame(_delta);
      } else {
          this.vrm.humanoid.update();
      }
  }

  private captureFrame() {
      if (!this.vrm?.humanoid) return;

      const time = (performance.now() - this.recordingStartTime) / 1000;
      const bones: Record<string, { rotation: THREE.Quaternion, position?: THREE.Vector3 }> = {};
      
      const boneNames = Object.values(VRMHumanBoneName);
      
      boneNames.forEach((boneName) => {
          const node = this.vrm!.humanoid!.getNormalizedBoneNode(boneName);
          if (node) {
              bones[boneName] = {
                  rotation: node.quaternion.clone()
              };
              if (boneName === 'hips') {
                  bones[boneName].position = node.position.clone();
              }
          }
      });

      this.recordedFrames.push({ time, bones });
  }

  private captureFaceMaskNeutralAnchors() {
      if (!this.vrm?.humanoid) return;
      const head = this.vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
      const neck = this.vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck);
      const world = new THREE.Vector3();

      this.vrm.scene.updateWorldMatrix(true, true);
      this.hasFaceMaskNeutralHead = false;
      this.hasFaceMaskNeutralNeck = false;

      if (head) {
          head.getWorldPosition(world);
          this.faceMaskNeutralHeadLocal.copy(this.vrm.scene.worldToLocal(world.clone()));
          this.hasFaceMaskNeutralHead = true;
      }

      if (neck) {
          neck.getWorldPosition(world);
          this.faceMaskNeutralNeckLocal.copy(this.vrm.scene.worldToLocal(world.clone()));
          this.hasFaceMaskNeutralNeck = true;
      }
  }

  private applyFaceMaskNeutralPose(applyHeadRotation = true) {
      if (!this.vrm?.humanoid) return;
      this.vrm.humanoid.resetNormalizedPose();
      const head = this.vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
      if (applyHeadRotation && head && this.faceMaskHasCurrentHeadRotation) {
          head.quaternion.copy(this.currentFaceMaskHeadRotation);
      }
      this.vrm.humanoid.update();
  }

  private getFaceMaskNeutralWorld(localPoint: THREE.Vector3, target: THREE.Vector3) {
      if (!this.vrm) return target.set(0, 0, 0);
      target.copy(localPoint);
      this.vrm.scene.localToWorld(target);
      return target;
  }

  private captureFaceMaskBaseline() {
      if (!this.vrm) return;
      this.captureFaceMaskOriginalTransform();
      this.hasFaceMaskTarget = false;
      this.currentFaceMaskScale = 1;
      this.faceMaskTargetScale = 1;

      this.applyFaceMaskNeutralPose(false);
      this.captureFaceMaskNeutralAnchors();
      this.vrm.scene.updateWorldMatrix(true, true);
      const bounds = getObjectBounds(this.vrm.scene);
      const height = bounds.max.y - bounds.min.y;
      this.faceMaskBaseAvatarHeight = Number.isFinite(height) && height > 0.1 ? height : 1.65;
      this.faceMaskHeadCenterOffset = this.faceMaskBaseAvatarHeight * 0.105;

      const camera = sceneManager.getCamera();
      if (camera && this.hasFaceMaskNeutralHead) {
          const headWorld = this.getFaceMaskNeutralWorld(this.faceMaskNeutralHeadLocal, new THREE.Vector3());
          this.faceMaskDepth = THREE.MathUtils.clamp(camera.position.distanceTo(headWorld), 0.65, 2.4);
      }
      this.faceMaskTargetDepth = this.faceMaskDepth;
      this.currentFaceMaskDepth = this.faceMaskDepth;
      this.faceMaskReferenceFaceWidth = 0;
      this.faceMaskLastFaceWidth = 0;
  }

  private restoreFaceMaskBaseline() {
      if (!this.vrm || !this.hasFaceMaskOriginalTransform) return;
      this.vrm.scene.scale.copy(this.faceMaskOriginalScale);
      this.vrm.scene.position.copy(this.faceMaskOriginalPosition);
      this.vrm.scene.quaternion.copy(this.faceMaskOriginalQuaternion);
      this.vrm.scene.updateMatrixWorld(true);
      this.hasFaceMaskOriginalTransform = false;
      this.hasFaceMaskTarget = false;
      this.hasFaceMaskNeutralHead = false;
      this.hasFaceMaskNeutralNeck = false;
  }

  private applyFaceMaskVisibility() {
      if (!this.vrm) return;
      this.restoreFaceMaskVisibility();
      this.restoreFaceMaskClipping();

      const renderer = sceneManager.getRenderer();
      if (renderer) {
          this.originalRendererLocalClippingEnabled = renderer.localClippingEnabled;
          renderer.localClippingEnabled = true;
      }

      const faceTokens = ['head', 'face', 'hair', 'eye', 'iris', 'lash', 'brow', 'mouth', 'teeth', 'tongue', 'ear', 'nose', 'cheek', 'neck'];
      const clipTokens = ['head', 'neck'];
      const detailFaceTokens = ['hair', 'eye', 'iris', 'lash', 'brow', 'mouth', 'teeth', 'tongue', 'ear', 'nose', 'cheek'];
      const bodyTokens = ['body', 'torso', 'chest', 'spine', 'hips', 'pelvis', 'waist', 'arm', 'hand', 'finger', 'leg', 'foot', 'feet', 'shoe', 'boot', 'sock', 'skirt', 'dress', 'pants', 'short', 'shirt', 'jacket', 'coat', 'sleeve', 'glove'];
      const faceMeshes: THREE.Mesh[] = [];
      const bodyMeshes: THREE.Mesh[] = [];
      const meshInfos: Array<{
          mesh: THREE.Mesh;
          hasBodyToken: boolean;
          hasClipToken: boolean;
          hasDetailFaceToken: boolean;
          hasFaceToken: boolean;
      }> = [];

      this.vrm.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materialNames = Array.isArray(object.material)
              ? object.material.map((material) => material.name).join(' ')
              : object.material?.name ?? '';
          const label = `${object.name} ${materialNames}`.toLowerCase();
          const hasFaceToken = faceTokens.some((token) => label.includes(token));
          const hasBodyToken = bodyTokens.some((token) => label.includes(token));
          const hasClipToken = clipTokens.some((token) => label.includes(token));
          const hasDetailFaceToken = detailFaceTokens.some((token) => label.includes(token));

          meshInfos.push({
              mesh: object,
              hasBodyToken,
              hasClipToken,
              hasDetailFaceToken,
              hasFaceToken,
          });
      });

      const hasExplicitHeadOrNeckMesh = meshInfos.some((info) => info.hasClipToken);

      meshInfos.forEach((info) => {
          const shouldClipNeck = info.hasClipToken
              || (!hasExplicitHeadOrNeckMesh && info.hasFaceToken && !info.hasDetailFaceToken);
          if (shouldClipNeck) {
              const materials = Array.isArray(info.mesh.material) ? info.mesh.material : [info.mesh.material];
              materials.forEach((material) => {
                  if (!material || this.faceMaskMaterialRecords.some((record) => record.material === material)) return;
                  this.faceMaskMaterialRecords.push({
                      material,
                      clippingPlanes: material.clippingPlanes ? [...material.clippingPlanes] : null,
                      clipIntersection: material.clipIntersection,
                      clipShadows: material.clipShadows,
                  });
                  material.clippingPlanes = [this.faceMaskClipPlane];
                  material.clipIntersection = false;
                  material.clipShadows = true;
                  material.needsUpdate = true;
              });
          }

          if (info.hasFaceToken) faceMeshes.push(info.mesh);
          if (info.hasBodyToken && !info.hasFaceToken) bodyMeshes.push(info.mesh);
      });

      if (faceMeshes.length === 0 || bodyMeshes.length === 0) return;

      bodyMeshes.forEach((mesh) => {
          this.faceMaskVisibilityRecords.push({ object: mesh, visible: mesh.visible });
          mesh.visible = false;
      });
  }

  private restoreFaceMaskVisibility() {
      this.faceMaskVisibilityRecords.forEach((record) => {
          record.object.visible = record.visible;
      });
      this.faceMaskVisibilityRecords = [];
      this.restoreFaceMaskClipping();
  }

  private restoreFaceMaskClipping() {
      this.faceMaskMaterialRecords.forEach((record) => {
          record.material.clippingPlanes = record.clippingPlanes;
          record.material.clipIntersection = record.clipIntersection;
          record.material.clipShadows = record.clipShadows;
          record.material.needsUpdate = true;
      });
      this.faceMaskMaterialRecords = [];

      const renderer = sceneManager.getRenderer();
      if (renderer && this.originalRendererLocalClippingEnabled !== null) {
          renderer.localClippingEnabled = this.originalRendererLocalClippingEnabled;
      }
      this.originalRendererLocalClippingEnabled = null;
  }

  private ensureFaceMaskVideoBackdrop() {
      this.faceMaskCompositor.ensureBackdrop();
      this.updateFaceMaskVideoBackdrop();
  }

  private disposeFaceMaskVideoBackdrop() {
      this.faceMaskCompositor.disposeBackdrop();
  }

  private mapFaceMaskVideoPoint(x: number, y: number, planeAspect: number) {
      return this.faceMaskCompositor.mapVideoPoint(x, y, planeAspect);
  }

  private updateFaceMaskVideoBackdrop() {
      const maskDepth = this.hasFaceMaskTarget ? this.currentFaceMaskDepth : this.faceMaskDepth + this.faceMaskAdjustments.depth;
      this.faceMaskCompositor.updateBackdrop(maskDepth, this.faceMaskAdjustments.backset);
  }

  private ensureFaceMaskDebugOverlay() {
      this.faceMaskCompositor.ensureDebugOverlay();
  }

  private disposeFaceMaskDebugOverlay() {
      this.faceMaskCompositor.disposeDebugOverlay();
  }

  private updateFaceMaskDebugOverlay() {
      if (!this.faceMaskDebugEnabled || !this.faceMaskDebugFrame) return;
      this.faceMaskCompositor.updateDebugOverlay(
          this.faceMaskDebugFrame,
          this.faceMaskTargetHeadWorld,
          this.currentFaceMaskHeadWorld,
          this.faceMaskClipPlane,
      );
  }

  private updateFaceMaskClipPlane() {
      if (!this.faceMaskMode || !this.vrm?.humanoid) return;
      const reference = new THREE.Vector3();

      if (this.hasFaceMaskNeutralNeck) {
          const neckWorld = this.getFaceMaskNeutralWorld(this.faceMaskNeutralNeckLocal, reference);
          const headWorld = this.hasFaceMaskNeutralHead
              ? this.getFaceMaskNeutralWorld(this.faceMaskNeutralHeadLocal, new THREE.Vector3())
              : null;
          const headNeckSpan = headWorld ? Math.max(0, headWorld.y - neckWorld.y) : 0;
          const maxClearance = Math.max(
              FACE_MASK_NECK_CROP.MIN_CLEARANCE,
              this.faceMaskBaseAvatarHeight * FACE_MASK_NECK_CROP.MAX_CLEARANCE_RATIO,
          );
          const clearance = headNeckSpan > 0
              ? THREE.MathUtils.clamp(
                  headNeckSpan * FACE_MASK_NECK_CROP.NECK_SPAN_CLEARANCE,
                  FACE_MASK_NECK_CROP.MIN_CLEARANCE,
                  maxClearance,
              )
              : Math.min(maxClearance, this.faceMaskBaseAvatarHeight * 0.028);
          reference.copy(neckWorld);
          reference.y -= clearance;
      } else if (this.hasFaceMaskNeutralHead) {
          this.getFaceMaskNeutralWorld(this.faceMaskNeutralHeadLocal, reference);
          reference.y -= Math.max(0.16, this.faceMaskBaseAvatarHeight * FACE_MASK_NECK_CROP.FALLBACK_HEAD_DROP_RATIO);
      } else {
          return;
      }
      reference.y += this.faceMaskAdjustments.crop;

      this.faceMaskClipPlane.normal.set(0, 1, 0);
      this.faceMaskClipPlane.constant = -reference.y;
  }

  private updateFaceMaskTarget(landmarks: any[], now: number) {
      if (!this.faceMaskMode || !this.vrm?.humanoid || !landmarks || landmarks.length === 0) return;
      const camera = sceneManager.getCamera();
      if (!camera) return;

      const xs: number[] = [];
      const ys: number[] = [];
      landmarks.forEach((landmark) => {
          if (
              landmark &&
              Number.isFinite(landmark.x) &&
              Number.isFinite(landmark.y) &&
              landmark.x >= -0.25 &&
              landmark.x <= 1.25 &&
              landmark.y >= -0.25 &&
              landmark.y <= 1.25
          ) {
              xs.push(landmark.x);
              ys.push(landmark.y);
          }
      });
      if (xs.length < 8 || ys.length < 8) return;

      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      const pickQuantile = (values: number[], q: number) => values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * q)))] ?? 0;
      const minX = pickQuantile(xs, 0.02);
      const maxX = pickQuantile(xs, 0.98);
      const minY = pickQuantile(ys, 0.02);
      const maxY = pickQuantile(ys, 0.98);

      const fov = THREE.MathUtils.degToRad(camera.fov);
      const debugCorners = [
          this.mapFaceMaskVideoPoint(minX, minY, camera.aspect),
          this.mapFaceMaskVideoPoint(maxX, minY, camera.aspect),
          this.mapFaceMaskVideoPoint(maxX, maxY, camera.aspect),
          this.mapFaceMaskVideoPoint(minX, maxY, camera.aspect),
      ];
      const debugMinX = Math.min(...debugCorners.map((point) => point.x));
      const debugMaxX = Math.max(...debugCorners.map((point) => point.x));
      const debugMinY = Math.min(...debugCorners.map((point) => point.y));
      const debugMaxY = Math.max(...debugCorners.map((point) => point.y));
      const faceWidth = Math.max(0.04, debugMaxX - debugMinX);
      this.faceMaskLastFaceWidth = faceWidth;
      if (this.faceMaskReferenceFaceWidth <= 0) {
          this.faceMaskReferenceFaceWidth = faceWidth;
      }

      const relativeDepth = THREE.MathUtils.clamp(this.faceMaskReferenceFaceWidth / faceWidth, 0.58, 1.85);
      const trackedDepth = THREE.MathUtils.clamp((this.faceMaskDepth * relativeDepth) + this.faceMaskAdjustments.depth, 0.45, 4.2);
      this.faceMaskTargetDepth = trackedDepth;

      const frustumHeight = 2 * Math.tan(fov / 2) * trackedDepth;
      const frustumWidth = frustumHeight * camera.aspect;
      const nose = landmarks[1] ?? landmarks[4] ?? landmarks[Math.floor(landmarks.length / 2)];
      const leftEyeOuter = landmarks[33] ?? landmarks[130];
      const rightEyeOuter = landmarks[263] ?? landmarks[359];
      const eyeCenterX = leftEyeOuter && rightEyeOuter ? (leftEyeOuter.x + rightEyeOuter.x) * 0.5 : (minX + maxX) * 0.5;
      const eyeCenterY = leftEyeOuter && rightEyeOuter ? (leftEyeOuter.y + rightEyeOuter.y) * 0.5 : minY + ((maxY - minY) * 0.38);
      const bboxCenterX = (minX + maxX) * 0.5;
      const bboxCenterY = ((minY + maxY) * 0.5) - ((maxY - minY) * 0.04);
      const centerX = (bboxCenterX * 0.3) + (eyeCenterX * 0.35) + ((nose?.x ?? bboxCenterX) * 0.35);
      const centerY = (bboxCenterY * 0.58) + (eyeCenterY * 0.22) + ((nose?.y ?? bboxCenterY) * 0.2);
      const anchor = this.mapFaceMaskVideoPoint(centerX, centerY, camera.aspect);
      const ndcX = (anchor.x * 2) - 1;
      const ndcY = 1 - (anchor.y * 2);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

      this.faceMaskTargetHeadWorld
          .copy(camera.position)
          .addScaledVector(forward, trackedDepth)
          .addScaledVector(right, (ndcX * frustumWidth * 0.5) + this.faceMaskAdjustments.offsetX)
          .addScaledVector(up, (ndcY * frustumHeight * 0.5) + this.faceMaskAdjustments.offsetY)
          .addScaledVector(forward, this.faceMaskAdjustments.backset);

      const faceWorldWidth = faceWidth * frustumWidth;
      const approximateHeadWidth = Math.max(0.08, this.faceMaskBaseAvatarHeight * 0.16);
      this.faceMaskTargetScale = THREE.MathUtils.clamp(((faceWorldWidth * 1.28) / approximateHeadWidth) * this.faceMaskAdjustments.scale, 0.18, 4.2);
      this.faceMaskDebugFrame = {
          minX: debugMinX,
          maxX: debugMaxX,
          minY: debugMinY,
          maxY: debugMaxY,
          depth: trackedDepth,
          frustumWidth,
          frustumHeight,
      };
      this.hasFaceMaskTarget = true;
      this.lastFaceMaskAt = now;

      if (!this.hasFaceMaskOriginalTransform) {
          this.captureFaceMaskBaseline();
      }
      if (this.currentFaceMaskHeadWorld.lengthSq() === 0) {
          this.currentFaceMaskHeadWorld.copy(this.faceMaskTargetHeadWorld);
      }
  }

  private applyFaceMaskFrame(delta: number) {
      if (!this.faceMaskMode || !this.vrm?.humanoid || !this.hasFaceMaskTarget) return;
      if (!this.hasFaceMaskNeutralHead) {
          this.applyFaceMaskNeutralPose(false);
          this.captureFaceMaskNeutralAnchors();
      }
      if (!this.hasFaceMaskNeutralHead) return;

      const clampedDelta = Math.min(0.05, Math.max(0.001, delta));
      const targetDistance = this.currentFaceMaskHeadWorld.distanceTo(this.faceMaskTargetHeadWorld);
      const positionRate = targetDistance > 0.18 ? 24 : targetDistance > 0.045 ? 16 : 7;
      const scaleDelta = Math.abs(this.faceMaskTargetScale - this.currentFaceMaskScale);
      const scaleRate = scaleDelta > 0.18 ? 12 : 5;
      const depthRate = Math.abs(this.faceMaskTargetDepth - this.currentFaceMaskDepth) > 0.18 ? 12 : 5;
      const rotationRate = 14;
      const positionSmoothing = 1 - Math.exp(-positionRate * clampedDelta);
      const scaleSmoothing = 1 - Math.exp(-scaleRate * clampedDelta);
      const depthSmoothing = 1 - Math.exp(-depthRate * clampedDelta);
      const rotationSmoothing = 1 - Math.exp(-rotationRate * clampedDelta);

      if (this.faceMaskHasHeadRotation) {
          if (!this.faceMaskHasCurrentHeadRotation) {
              this.currentFaceMaskHeadRotation.copy(this.faceMaskHeadRotation);
              this.faceMaskHasCurrentHeadRotation = true;
          } else {
              this.currentFaceMaskHeadRotation.slerp(this.faceMaskHeadRotation, rotationSmoothing);
          }
      }

      this.currentFaceMaskDepth = THREE.MathUtils.lerp(this.currentFaceMaskDepth, this.faceMaskTargetDepth, depthSmoothing);
      this.currentFaceMaskScale = THREE.MathUtils.lerp(this.currentFaceMaskScale, this.faceMaskTargetScale, scaleSmoothing);
      this.currentFaceMaskHeadWorld.lerp(this.faceMaskTargetHeadWorld, positionSmoothing);
      this.updateFaceMaskVideoBackdrop();

      const targetScale = this.faceMaskOriginalScale.clone().multiplyScalar(this.currentFaceMaskScale);
      this.vrm.scene.scale.lerp(targetScale, scaleSmoothing);
      this.applyFaceMaskNeutralPose();
      this.vrm.scene.updateWorldMatrix(true, true);

      const neutralHeadWorld = this.getFaceMaskNeutralWorld(this.faceMaskNeutralHeadLocal, new THREE.Vector3());
      neutralHeadWorld.y += (this.faceMaskHeadCenterOffset + this.faceMaskAdjustments.lift) * this.currentFaceMaskScale;
      const offset = this.currentFaceMaskHeadWorld.clone().sub(neutralHeadWorld);
      this.vrm.scene.position.add(offset.multiplyScalar(positionSmoothing));
      this.applyFaceMaskNeutralPose();
      this.vrm.scene.updateMatrixWorld(true);
      this.updateFaceMaskClipPlane();
      this.updateFaceMaskDebugOverlay();
  }

  startRecording() {
    this.isRecording = true;
    this.recordedFrames = [];
    this.recordingStartTime = performance.now();
    console.log('[MotionCaptureManager] Started recording');
  }

  stopRecording(): THREE.AnimationClip | null {
    this.isRecording = false;
    console.log('[MotionCaptureManager] Stopped recording. Frames:', this.recordedFrames.length);
    if (this.recordedFrames.length === 0) return null;
    return this.createAnimationClip();
  }

  private createAnimationClip(): THREE.AnimationClip {
      const tracks: THREE.KeyframeTrack[] = [];
      const duration = this.recordedFrames[this.recordedFrames.length - 1].time;
      
      const boneTracks: Record<string, { times: number[], values: number[], type: 'quaternion' | 'vector' }> = {};

      this.recordedFrames.forEach(frame => {
          Object.entries(frame.bones).forEach(([boneName, data]) => {
             if (!boneTracks[`${boneName}.quaternion`]) {
                 boneTracks[`${boneName}.quaternion`] = { times: [], values: [], type: 'quaternion' };
             }
             boneTracks[`${boneName}.quaternion`].times.push(frame.time);
             boneTracks[`${boneName}.quaternion`].values.push(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w);

             if (data.position) {
                 if (!boneTracks[`${boneName}.position`]) {
                     boneTracks[`${boneName}.position`] = { times: [], values: [], type: 'vector' };
                 }
                 boneTracks[`${boneName}.position`].times.push(frame.time);
                 boneTracks[`${boneName}.position`].values.push(data.position.x, data.position.y, data.position.z);
             }
          });
      });

      Object.entries(boneTracks).forEach(([name, data]) => {
          if (data.type === 'quaternion') {
              tracks.push(new THREE.QuaternionKeyframeTrack(name, data.times, data.values));
          } else {
              tracks.push(new THREE.VectorKeyframeTrack(name, data.times, data.values));
          }
      });

      return new THREE.AnimationClip(`Mocap_Take_${Date.now()}`, duration, tracks);
  }

  calibrate() {
    this.calibrateBody();
    this.calibrateFace();
  }

  calibrateBody() {
    if (!this.vrm?.humanoid) return;
    console.log('[MotionCaptureManager] Calibrating Body Offsets...');
    this.calibrationOffsets = {};
    this.hipsRefPosition = null; 
    this.shouldCalibrateBody = true;
  }

  calibrateFace() {
    if (!this.vrm?.humanoid) return;
    console.log('[MotionCaptureManager] Calibrating Face/Eye Gaze Offsets...');
    this.eyeCalibrationOffset = { x: 0, y: 0 };
    this.shouldCalibrateFace = true;
  }

  /**
   * Captures a still frame from the webcam and uses AI to "Interpret" the pose.
   * This acts as an "Under the Hood" corrector/enhancer for the vision data.
   */
  async aiInterpret(prompt?: string) {
      if (!this.isTracking || !this.videoElement) {
          console.warn('[MotionCaptureManager] Cannot AI interpret: Tracking not active');
          return;
      }

      try {
          const frame = this.captureWebcamFrame();
          if (!frame) return;

          const { geminiService } = await import('../services/gemini');
          const result = await geminiService.interpretWebcam(frame, prompt);
          
          if (result && result.vrmPose) {
              console.log('[MotionCaptureManager] AI Interpretation applied');
              // Apply smoothly over 0.5s to avoid a "pop"
              const { avatarManager } = await import('../three/avatarManager');
              const rotationLocked = useSceneSettingsStore.getState().rotationLocked;
              await avatarManager.applyRawPose({
                  vrmPose: result.vrmPose,
                  expressions: result.expressions
              }, rotationLocked, 'static', true);
          }
      } catch (error) {
          console.error('[MotionCaptureManager] AI Interpretation failed:', error);
      }
  }

  private captureWebcamFrame(): string | null {
      if (!this.videoElement || this.videoElement.videoWidth === 0) return null;

      const canvas = document.createElement('canvas');
      canvas.width = this.videoElement.videoWidth;
      canvas.height = this.videoElement.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(this.videoElement, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.8);
  }

  private applyPoseRig(rig: any) {
    if (this.faceMaskMode) return;
    if (!this.vrm?.humanoid) return;
    const getVRMBoneName = (key: string): string => {
        if (key === 'Hips') return 'hips';
        return key.charAt(0).toLowerCase() + key.slice(1);
    };
    if (this.shouldCalibrateBody) {
        const rigKeys = Object.keys(rig);
        rigKeys.forEach(key => {
            const boneData = rig[key];
            if (boneData?.rotation) {
                const q = new THREE.Quaternion(boneData.rotation.x, boneData.rotation.y, boneData.rotation.z, boneData.rotation.w);
                this.calibrationOffsets[key] = q.clone();
            }
        });
        if (rig.Hips?.position) {
            this.hipsRefPosition = new THREE.Vector3(rig.Hips.position.x, rig.Hips.position.y, rig.Hips.position.z);
        }
        this.shouldCalibrateBody = false;
    }
    const setTargetRotation = (key: string, rotation: { x: number, y: number, z: number, w?: number }) => {
        const boneName = getVRMBoneName(key);
        if (rotation.w !== undefined) {
            const targetQ = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
            if (this.calibrationOffsets[key]) {
                const invCalibration = this.calibrationOffsets[key].clone().invert();
                targetQ.multiply(invCalibration);
            }
            const euler = new THREE.Euler().setFromQuaternion(targetQ, 'XYZ');
            const deg = {
                x: THREE.MathUtils.radToDeg(euler.x),
                y: THREE.MathUtils.radToDeg(euler.y),
                z: THREE.MathUtils.radToDeg(euler.z)
            };
            const constrained = motionEngine.constrainRotation(boneName, deg);
            targetQ.setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(constrained.x),
                THREE.MathUtils.degToRad(constrained.y),
                THREE.MathUtils.degToRad(constrained.z),
                'XYZ'
            ));
            this.targetBoneRotations.set(boneName, targetQ);
        }
    };
    const rigKeys = Object.keys(rig);
    rigKeys.forEach(key => {
        const boneData = rig[key];
        if (key === 'Hips') {
            setTargetRotation('Hips', boneData.rotation!);
            if (boneData.position) {
                const pos = boneData.position;
                let x = pos.x; let y = pos.y; let z = pos.z;
                if (this.hipsRefPosition) {
                    x -= this.hipsRefPosition.x;
                    y -= this.hipsRefPosition.y;
                    z -= this.hipsRefPosition.z;
                }
                const MOVE_SCALE = 1.5; 
                const restY = 1.0; 
                this.targetRootPosition = new THREE.Vector3(x * MOVE_SCALE, (y * MOVE_SCALE) + restY, z * MOVE_SCALE);
            }
        } else {
            if (boneData.rotation) setTargetRotation(key, boneData.rotation);
        }
    });
  }

  private applyFaceRig(rig: any) {
      const live2dData = { head: { x: 0, y: 0, z: 0 }, eye: { l: 1, r: 1 }, pupil: { x: 0, y: 0 }, mouth: { open: 0 } };
      if (this.shouldCalibrateFace) {
          if (rig.pupil) {
              this.eyeCalibrationOffset = { x: rig.pupil.x, y: rig.pupil.y };
              this.shouldCalibrateFace = false;
          }
      }
      const setExpressionTarget = (candidates: string[], value: number) => {
          candidates.forEach(name => { if (this.availableBlendshapes.has(name)) this.targetFaceValues.set(name, value); });
      };
      if (rig.head) {
             const headBone = this.vrm?.humanoid?.getNormalizedBoneNode('head');
             if (headBone) {
                const q = rig.head;
                const headQ = new THREE.Quaternion(q.x, q.y, q.z, q.w);
                const identityQ = new THREE.Quaternion();
                headQ.slerp(identityQ, HEAD_DAMPENING);
                if (this.faceMaskMode) {
                    this.faceMaskHeadRotation.copy(headQ);
                    this.faceMaskHasHeadRotation = true;
                } else {
                    this.targetBoneRotations.set('head', headQ);
                }
                const euler = new THREE.Euler().setFromQuaternion(headQ, 'YXZ');
                live2dData.head = { x: THREE.MathUtils.radToDeg(euler.x), y: THREE.MathUtils.radToDeg(euler.y), z: THREE.MathUtils.radToDeg(euler.z) };
                
                // Upper body follow - make torso subtly follow head rotation for natural movement
                // Only apply in face/upper body mode (not full body where pose rig handles torso)
                // We only apply this if these bones weren't already set by the pose rig, 
                // or if we want to prioritize head-driven torso motion (smoother for seated mocap)
                if (this.mode === 'face' && !this.faceMaskMode) {
                    const identity = new THREE.Quaternion();
                    
                    // Neck follows head most closely
                    const neckQ = headQ.clone().slerp(identity, 1 - UPPER_BODY_FOLLOW.NECK);
                    if (!this.targetBoneRotations.has('neck')) {
                        this.targetBoneRotations.set('neck', neckQ);
                    }
                    
                    // Upper chest follows less
                    const upperChestQ = headQ.clone().slerp(identity, 1 - UPPER_BODY_FOLLOW.UPPER_CHEST);
                    if (!this.targetBoneRotations.has('upperChest')) {
                        this.targetBoneRotations.set('upperChest', upperChestQ);
                    }
                    
                    // Chest follows even less
                    const chestQ = headQ.clone().slerp(identity, 1 - UPPER_BODY_FOLLOW.CHEST);
                    if (!this.targetBoneRotations.has('chest')) {
                        this.targetBoneRotations.set('chest', chestQ);
                    }
                    
                    // Spine follows least - just a subtle hint
                    const spineQ = headQ.clone().slerp(identity, 1 - UPPER_BODY_FOLLOW.SPINE);
                    if (!this.targetBoneRotations.has('spine')) {
                        this.targetBoneRotations.set('spine', spineQ);
                    }
                }
             }
      }
      if (rig.eye) {
          const blinkL = 1 - rig.eye.l; const blinkR = 1 - rig.eye.r;
          setExpressionTarget(['BlinkLeft', 'blink_l', 'eyeBlinkLeft', 'LeftEyeBlink'], blinkL);
          setExpressionTarget(['BlinkRight', 'blink_r', 'eyeBlinkRight', 'RightEyeBlink'], blinkR);
          const blinkMax = Math.max(blinkL, blinkR);
          setExpressionTarget(['Blink', 'blink', 'eyeBlink'], blinkMax);
          live2dData.eye = { l: rig.eye.l, r: rig.eye.r };
      }
      if (rig.pupil) {
          const x = THREE.MathUtils.clamp((rig.pupil.x - this.eyeCalibrationOffset.x) * GAZE_SENSITIVITY, -1, 1);
          const y = THREE.MathUtils.clamp(-(rig.pupil.y - this.eyeCalibrationOffset.y) * GAZE_SENSITIVITY, -1, 1);
          live2dData.pupil = { x, y };
          const stabilizedX = Math.abs(x) < GAZE_DEADZONE ? 0 : x;
          const stabilizedY = Math.abs(y) < GAZE_DEADZONE ? 0 : y;
          const setARKitGaze = (xVal: number, yVal: number) => {
             if (xVal > 0) { 
                 setExpressionTarget(['eyeLookOutRight', 'LookRight'], xVal); setExpressionTarget(['eyeLookInLeft', 'LookLeft'], xVal);
                 setExpressionTarget(['eyeLookInRight', 'LookLeft'], 0); setExpressionTarget(['eyeLookOutLeft', 'LookRight'], 0);
             } else { 
                 setExpressionTarget(['eyeLookInRight', 'LookLeft'], -xVal); setExpressionTarget(['eyeLookOutLeft', 'LookRight'], -xVal);
                 setExpressionTarget(['eyeLookOutRight', 'LookRight'], 0); setExpressionTarget(['eyeLookInLeft', 'LookLeft'], 0);
             }
             if (yVal > 0) { 
                 setExpressionTarget(['eyeLookDownRight', 'LookDown'], yVal); setExpressionTarget(['eyeLookDownLeft', 'LookDown'], yVal);
                 setExpressionTarget(['eyeLookUpRight', 'LookUp'], 0); setExpressionTarget(['eyeLookUpLeft', 'LookUp'], 0);
             } else { 
                 setExpressionTarget(['eyeLookUpRight', 'LookUp'], -yVal); setExpressionTarget(['eyeLookUpLeft', 'LookUp'], -yVal);
                 setExpressionTarget(['eyeLookDownRight', 'LookDown'], 0); setExpressionTarget(['eyeLookDownLeft', 'LookDown'], 0);
             }
          };
          setARKitGaze(stabilizedX, stabilizedY);
      }
      if (rig.mouth) {
          const shape = rig.mouth.shape;
          setExpressionTarget(['Aa', 'a', 'mouthOpen'], shape.A); setExpressionTarget(['Ee', 'e'], shape.E); setExpressionTarget(['Ih', 'i'], shape.I);
          setExpressionTarget(['Oh', 'o', 'mouthPucker'], shape.O); setExpressionTarget(['Ou', 'u', 'mouthFunnel'], shape.U);
          if (rig.mouth.open !== undefined) { setExpressionTarget(['jawOpen', 'mouthOpen', 'A'], rig.mouth.open); live2dData.mouth.open = rig.mouth.open; }
      }
      if (rig.smile !== undefined) {
          const smile = rig.smile;
          setExpressionTarget(['Joy', 'joy', 'Happy', 'happy', 'Fun', 'fun'], smile);
          setExpressionTarget(['mouthSmileLeft', 'mouthSmileRight'], smile); setExpressionTarget(['mouthSmile'], smile);
      }
      if (rig.brow) {
          setExpressionTarget(['browInnerUp', 'BrowsUp', 'browOuterUpLeft', 'browOuterUpRight', 'Surprised', 'surprise'], rig.brow);
      }
      live2dManager.updateFaceModel(live2dData);
  }

  private applyHandRig(rig: Record<string, { x: number, y: number, z: number }>, side: 'Left' | 'Right') {
      if (this.faceMaskMode) return;
      if (!this.vrm?.humanoid) return;
      const isLeft = side === 'Left';
      const boneMap: Record<string, VRMHumanBoneName> = {
          [`${side}Wrist`]: isLeft ? 'leftHand' : 'rightHand',
          [`${side}ThumbProximal`]: isLeft ? 'leftThumbMetacarpal' : 'rightThumbMetacarpal', [`${side}ThumbIntermediate`]: isLeft ? 'leftThumbProximal' : 'rightThumbProximal', [`${side}ThumbDistal`]: isLeft ? 'leftThumbDistal' : 'rightThumbDistal',
          [`${side}IndexProximal`]: isLeft ? 'leftIndexProximal' : 'rightIndexProximal', [`${side}IndexIntermediate`]: isLeft ? 'leftIndexIntermediate' : 'rightIndexIntermediate', [`${side}IndexDistal`]: isLeft ? 'leftIndexDistal' : 'rightIndexDistal',
          [`${side}MiddleProximal`]: isLeft ? 'leftMiddleProximal' : 'rightMiddleProximal', [`${side}MiddleIntermediate`]: isLeft ? 'leftMiddleIntermediate' : 'rightMiddleIntermediate', [`${side}MiddleDistal`]: isLeft ? 'leftMiddleDistal' : 'rightMiddleDistal',
          [`${side}RingProximal`]: isLeft ? 'leftRingProximal' : 'rightRingProximal', [`${side}RingIntermediate`]: isLeft ? 'leftRingIntermediate' : 'rightRingIntermediate', [`${side}RingDistal`]: isLeft ? 'leftRingDistal' : 'rightRingDistal',
          [`${side}LittleProximal`]: isLeft ? 'leftLittleProximal' : 'rightLittleProximal', [`${side}LittleIntermediate`]: isLeft ? 'leftLittleIntermediate' : 'rightLittleIntermediate', [`${side}LittleDistal`]: isLeft ? 'leftLittleDistal' : 'rightLittleDistal',
      };
      const clampRotation = (boneName: string, rotation: { x: number, y: number, z: number }) => {
          const isThumb = boneName.toLowerCase().includes('thumb'); const isWrist = boneName.toLowerCase().includes('hand');
          const range = isWrist ? HAND_CONSTRAINTS.WRIST : isThumb ? HAND_CONSTRAINTS.THUMB : HAND_CONSTRAINTS.FINGER;
          return { x: THREE.MathUtils.clamp(rotation.x, range.x[0], range.x[1]), y: THREE.MathUtils.clamp(rotation.y, range.y[0], range.y[1]), z: THREE.MathUtils.clamp(rotation.z, range.z[0], range.z[1]) };
      };
      Object.entries(rig).forEach(([key, rotation]) => {
          const boneName = boneMap[key];
          if (!boneName || !rotation) return;
          const constrained = clampRotation(boneName, rotation);
          const targetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(constrained.x, constrained.y, constrained.z, 'XYZ'));
          this.targetBoneRotations.set(boneName, targetQ);
      });
  }
}
