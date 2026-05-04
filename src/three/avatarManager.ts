import * as THREE from 'three';
import { GLTFLoader as ThreeGLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { VRMPose } from '@pixiv/three-vrm';
import type { ExpressionId, PoseId, AnimationMode } from '../types/reactions';
import { sceneManager } from './sceneManager';
import { animationManager } from './animationManager';
import { getPoseDefinition, getPoseDefinitionWithAnimation, type PoseDefinition } from '../poses';
import { poseToAnimationClip } from '../poses/poseToAnimation';
import { getAnimatedPose } from '../poses/animatedPoses';
import { materialManager } from './materialManager';
import { BlinkManager } from './blinkManager';
import { RootMotionManager } from './rootMotionManager';

// Import type only to avoid circular dependency at runtime
// The actual store access happens after all modules are initialized
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';

type ExpressionMutator = (vrm: VRM) => void;

const expressionMutators: Record<ExpressionId, ExpressionMutator> = {
  calm: (vrm) => {
    vrm.expressionManager?.setValue('Joy', 0);
    vrm.expressionManager?.setValue('Surprised', 0);
    vrm.expressionManager?.setValue('Angry', 0);
  },
  joy: (vrm) => {
    vrm.expressionManager?.setValue('Joy', 0.8);
    vrm.expressionManager?.setValue('Surprised', 0);
    vrm.expressionManager?.setValue('Angry', 0);
  },
  surprise: (vrm) => {
    vrm.expressionManager?.setValue('Joy', 0);
    vrm.expressionManager?.setValue('Surprised', 0.9);
    vrm.expressionManager?.setValue('Angry', 0);
  },
};

interface RawPoseData {
  vrmPose?: VRMPose;
  tracks?: THREE.KeyframeTrack[];
  sceneRotation?: { x: number; y: number; z: number };
  scenePosition?: { x: number; y: number; z: number };
  expressions?: Record<string, number>;
  name?: string;
  duration?: number;
}

// Type for VRM expression with name property
interface VRMExpressionWithName {
  expressionName?: string;
}

// Extended expression manager with expressions array
interface ExtendedExpressionManager {
  expressionMap?: Record<string, unknown>;
  expressions?: VRMExpressionWithName[];
}

class AvatarManager {
  private loader = new ThreeGLTFLoader();
  private vrm?: VRM;
  private currentUrl?: string;
  private tickDispose?: () => void;
  private isAnimated = false;
  private isRootMotionEnabled = false;
  private _isInteracting = false; 
  private isManualPosing = false;
  private defaultHipsPosition: THREE.Vector3 = new THREE.Vector3(0, 1.0, 0);
  
  // Pending state for project restore
  private pendingProjectPose: VRMPose | null = null;
  private pendingProjectExpressions: Record<string, number> | null = null;
  private pendingProjectTransform: { position: { x: number, y: number, z: number }, rotation: { x: number, y: number, z: number } } | null = null;
  private blinkManager: BlinkManager;
  private rootMotionManager: RootMotionManager;
  
  // Locked Hips rotation - enforced every frame when rotation is locked
  private lockedHipsRotation: THREE.Quaternion | null = null;
  
    constructor(){
  
      this.loader.register((parser) => new VRMLoaderPlugin(parser));
  
      this.blinkManager = new BlinkManager();
  
      this.rootMotionManager = new RootMotionManager();
  
    }
  
  
  
    isManualPosingEnabled(): boolean { return this.isManualPosing; }
    isInteracting(): boolean { return this._isInteracting; }
  getCurrentUrl(): string | undefined { return this.currentUrl; }
  setManualPosing(enabled: boolean) { 
    this.isManualPosing = enabled;
    // When disabling manual posing, save the current Hips rotation
    // so it can be enforced while rotation is locked
    if (!enabled) {
      this.saveLockedHipsRotation();
    }
  }
  setInteraction(interacting: boolean) { this._isInteracting = interacting; }

  /**
   * Save the current Hips rotation to be enforced while rotation is locked.
   * Called when manual posing is disabled or when user explicitly wants to lock rotation.
   */
  saveLockedHipsRotation(): void {
    const hipsNode = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (!hipsNode) return;
    this.lockedHipsRotation = hipsNode.quaternion.clone();
    console.log('[AvatarManager] Saved locked Hips rotation:', this.lockedHipsRotation.toArray());
  }

  /**
   * Clear the locked Hips rotation (called when rotation is unlocked)
   */
  clearLockedHipsRotation(): void {
    this.lockedHipsRotation = null;
    console.log('[AvatarManager] Cleared locked Hips rotation');
  }

  /**
   * Capture current Hips rotation quaternion
   * Used to preserve avatar orientation when rotation is locked
   */
  private captureHipsRotation(): THREE.Quaternion | null {
    const hipsNode = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (!hipsNode) return null;
    return hipsNode.quaternion.clone();
  }

  /**
   * Modify a VRMPose to preserve the current Hips rotation
   * This keeps the avatar facing the direction the user set it to
   */
  private preserveHipsRotationInPose(targetPose: VRMPose): VRMPose {
    const currentHipsRotation = this.captureHipsRotation();
    if (!currentHipsRotation) return targetPose;
    
    // Clone the pose and override the hips rotation
    const modifiedPose: VRMPose = { ...targetPose };
    modifiedPose[VRMHumanBoneName.Hips] = {
      ...targetPose[VRMHumanBoneName.Hips],
      rotation: [currentHipsRotation.x, currentHipsRotation.y, currentHipsRotation.z, currentHipsRotation.w]
    };
    
    console.log('[AvatarManager] Preserving Hips rotation for locked orientation');
    return modifiedPose;
  }

  /**
   * Enforce the locked Hips Y-axis rotation (facing direction) if rotation is locked.
   * Called every frame in the tick loop.
   * Only locks the Y-axis (yaw/facing direction), allowing X and Z to animate naturally.
   * Does NOT enforce while user is actively manipulating bones with the gizmo.
   */
  private enforceLockedHipsRotation(rotationLocked: boolean): void {
    if (!this.lockedHipsRotation) return;
    
    // Don't enforce while user is actively dragging with gizmo
    // This allows the user to rotate freely, then we save the new rotation when they release
    if (this._isInteracting || this.isManualPosing) return;
    
    if (!rotationLocked) return;
    
    const hipsNode = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (!hipsNode) return;
    
    // Extract Y-axis rotation from saved quaternion (the facing direction we want to preserve)
    const savedEuler = new THREE.Euler().setFromQuaternion(this.lockedHipsRotation, 'YXZ');
    const savedY = savedEuler.y;
    
    // Get current animation rotation (has the natural hip motion we want to keep)
    const currentEuler = new THREE.Euler().setFromQuaternion(hipsNode.quaternion, 'YXZ');
    
    // Combine: locked Y-rotation + animated X and Z rotation
    currentEuler.y = savedY;
    
    // Apply the combined rotation
    hipsNode.quaternion.setFromEuler(currentEuler);
  }

  private startTickLoop() {
    this.tickDispose?.();
    
    const disposers: (() => void)[] = [];

    // 1. Animation Phase (Priority 50)
    disposers.push(sceneManager.registerTick((delta) => {
      if (this.vrm && this.isAnimated && !this._isInteracting) {
        animationManager.update(delta);
      }
    }, 50));

    // 2. Procedural Phase (Priority 40)
    disposers.push(sceneManager.registerTick((delta) => {
      if (this.vrm) {
        this.blinkManager.update(delta);
        
        if (this.isAnimated && this.isRootMotionEnabled && !this._isInteracting) {
          this.rootMotionManager.captureHipsPosition();
        }
      }
    }, 40));

    // 3. Finalization Phase (Priority -100)
    // Runs after Mocap (priority 30) has applied its bone transforms
    disposers.push(sceneManager.registerTick((delta) => {
      if (this.vrm) {
        // Final VRM update applies humanoid bone transforms to the scene 
        // and calculates secondary motion (spring bones/physics)
        this.vrm.update(delta);
        
        if (this.isAnimated && this.isRootMotionEnabled && !this._isInteracting) {
          this.rootMotionManager.update(delta);
        } else if (!this._isInteracting) {
          this.rootMotionManager.updateGrounding(delta);
        }
        
        const rotationLocked = useSceneSettingsStore.getState().rotationLocked;
        this.enforceLockedHipsRotation(rotationLocked);
      }
    }, -100));

    this.tickDispose = () => disposers.forEach(d => d());
  }

  rebindToScene() {
    const scene = sceneManager.getScene();
    if (this.vrm && scene) {
        this.vrm.scene.removeFromParent();
        scene.add(this.vrm.scene);
        this.startTickLoop();
    }
  }

  async load(url: string, setRotationLocked: (locked: boolean) => void) {
    if (this.currentUrl === url && this.vrm) {
        // Even if already loaded, we might need to ensure the tick loop is active 
        // if this load is called after a scene reset (though rebindToScene usually handles it).
        // But rebindToScene handles the scene transfer. 
        // If load is called, we assume the caller wants to ensure availability.
        return this.vrm;
    }
    const scene = sceneManager.getScene();
    if (!scene) throw new Error('Scene not initialized');

    const gltf = await this.loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error('Invalid VRM file');
    
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    // Combine skeletons for better performance (replaces deprecated removeUnnecessaryJoints)
    VRMUtils.combineSkeletons(vrm.scene);

    if (this.vrm) {
      scene.remove(this.vrm.scene);
      this.tickDispose?.();
    }
    this.vrm = vrm;
    this.currentUrl = url;

    vrm.scene.position.set(0, 0, 0);
    // Most VRMs are exported facing +Z but poses were authored with avatar at 180°.
    // Start at 180° rotation so avatar faces camera, poses will maintain this.
    vrm.scene.rotation.set(0, Math.PI, 0);
    
    // Tag the scene object so SceneManager can find it reliably
    vrm.scene.userData.vrm = vrm;
    
    console.log('[AvatarManager] VRM loaded at 180° Y rotation');
    
    scene.add(vrm.scene);
    animationManager.initialize(vrm);
    sceneManager.frameObject(vrm.scene);

    // Capture the default hips position (usually around Y=0.8-1.0)
    // This serves as the anchor point for all transitions to prevent drift
    const hipsNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hipsNode) {
      this.defaultHipsPosition.copy(hipsNode.position);
      console.log('[AvatarManager] Captured default hips position:', this.defaultHipsPosition);
    }

    this.startTickLoop();
    
    // Initialize next blink time
    this.blinkManager.setVRM(vrm);
    this.rootMotionManager.setVRM(vrm);
    console.log('[AvatarManager] Blink initialized. First blink scheduled.');

    // Apply material settings to the newly loaded VRM
    materialManager.onVRMLoaded();
    
    // Reset rotation lock when loading a new avatar so the first pose applies correctly
    // The user can re-lock rotation after using the gizmo
    setRotationLocked(false);

    // Apply pending project state if present
    this.applyPendingProjectState();

    return vrm;
  }

  setPendingProjectState(
    pose: VRMPose | undefined, 
    expressions: Record<string, number> | undefined, 
    transform: { position: { x: number, y: number, z: number }, rotation: { x: number, y: number, z: number } } | undefined
  ) {
    this.pendingProjectPose = pose || null;
    this.pendingProjectExpressions = expressions || null;
    this.pendingProjectTransform = transform || null;
    
    // If VRM already loaded, apply immediately
    if (this.vrm) {
        this.applyPendingProjectState();
    }
  }

  private applyPendingProjectState() {
    if (!this.vrm) return;

    if (this.pendingProjectTransform) {
      const { position, rotation } = this.pendingProjectTransform;
      this.vrm.scene.position.set(position.x, position.y, position.z);
      this.vrm.scene.rotation.set(
        THREE.MathUtils.degToRad(rotation.x),
        THREE.MathUtils.degToRad(rotation.y),
        THREE.MathUtils.degToRad(rotation.z)
      );
      this.pendingProjectTransform = null;
    }

    if (this.pendingProjectPose || this.pendingProjectExpressions) {
      // Small delay to ensure any T-pose initialization finishes
      const pose = this.pendingProjectPose;
      const expressions = this.pendingProjectExpressions;
      
      setTimeout(() => {
        this.applyRawPose({
          vrmPose: pose || undefined,
          expressions: expressions || undefined
        }, false, 'static', false); // rotationLocked: false, animationMode: 'static', smoothTransition: false
      }, 100);
      
      this.pendingProjectPose = null;
      this.pendingProjectExpressions = null;
    }
  }

  async applyRawPose(poseData: RawPoseData, rotationLocked: boolean, animationMode: AnimationMode = 'static', smoothTransition = true) {
    if (!this.vrm) {
      console.warn('[AvatarManager] applyRawPose called but no VRM loaded');
      return;
    }
    
    // BLOCK pose application entirely when manual posing is active
    // This preserves all manual bone adjustments made with the gizmo
    if (this.isManualPosing) {
      console.log('[AvatarManager] applyRawPose BLOCKED - manual posing is active');
      return;
    }
    
    this._isInteracting = false;

    // Only apply scene rotation if not locked AND not in manual posing mode
    // Manual posing mode should always preserve the current rotation
    const shouldPreserveRotation = rotationLocked || this.isManualPosing;
    
    if (poseData.sceneRotation && !shouldPreserveRotation) {
      this.vrm.scene.rotation.set(
        THREE.MathUtils.degToRad(poseData.sceneRotation.x ?? 0),
        THREE.MathUtils.degToRad(poseData.sceneRotation.y ?? 0),
        THREE.MathUtils.degToRad(poseData.sceneRotation.z ?? 0),
      );
    } else if (poseData.sceneRotation && shouldPreserveRotation) {
      console.log('[AvatarManager] Scene rotation preserved (locked or manual posing active)');
    }

    if (poseData.scenePosition && !shouldPreserveRotation) {
      this.vrm.scene.position.set(
        poseData.scenePosition.x ?? 0,
        poseData.scenePosition.y ?? 0,
        poseData.scenePosition.z ?? 0
      );
    }

    if (animationMode !== 'static' && poseData.tracks) {
      const { deserializeAnimationClip } = await import('../poses/animationClipSerializer');
      // Cast through unknown to handle the structural mismatch between RawPoseData and SerializedAnimationClip
      this.playAnimationClip(deserializeAnimationClip(poseData as unknown as Parameters<typeof deserializeAnimationClip>[0]), animationMode === 'loop');
    } else if (poseData.vrmPose) {
      // Validate and log the pose data
      const boneCount = Object.keys(poseData.vrmPose).length;
      console.log(`[AvatarManager] Applying raw pose with ${boneCount} bones, smooth=${smoothTransition}`);
      
      if (boneCount === 0) {
        console.warn('[AvatarManager] Empty vrmPose received - skipping');
        return;
      }
      
      // Apply expressions if provided
      if (poseData.expressions && this.vrm.expressionManager) {
        Object.entries(poseData.expressions).forEach(([name, value]) => {
          const standardMap: Record<string, string> = { 'joy': 'Joy', 'happy': 'Joy', 'angry': 'Angry', 'sad': 'Sorrow', 'fun': 'Fun', 'surprised': 'Surprised', 'blink': 'Blink' };
          this.vrm!.expressionManager!.setValue(standardMap[name.toLowerCase()] || name, value as number);
        });
      }
      
      // Preserve Hips rotation when rotation is locked
      const poseToApply = rotationLocked ? this.preserveHipsRotationInPose(poseData.vrmPose) : poseData.vrmPose;
      
      // Use smooth transition for preset-style changes, immediate for mocap/real-time
      if (smoothTransition) {
        this.transitionToPose(poseToApply, rotationLocked, 0.4);
      } else {
        // Immediate application (for mocap, real-time updates)
        this.stopAnimation(true);
        this.vrm.humanoid?.resetNormalizedPose();
        this.vrm.update(0);
        this.vrm.humanoid?.setNormalizedPose(poseToApply);
        
        // Explicitly set hips to default position if not specified in poseData
        const hipsNode = this.vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
        if (hipsNode && !poseToApply[VRMHumanBoneName.Hips]?.position) {
          hipsNode.position.copy(this.defaultHipsPosition);
        }
        
        this.vrm.humanoid?.update();
        this.vrm.update(0);
        console.log('[AvatarManager] ✅ Raw pose applied immediately');
      }
    } else {
      console.warn('[AvatarManager] applyRawPose called with no vrmPose or tracks');
    }
  }

  async applyPose(pose: PoseId, rotationLocked: boolean, animated = false, animationMode: AnimationMode = 'static', rootMotion = false, transitionDuration = 0.4) {
    const effectiveAnimationMode = animated && animationMode === 'static' ? 'loop' : animationMode;
    const shouldAnimate = animated || effectiveAnimationMode !== 'static';
    const shouldLoop = effectiveAnimationMode === 'loop';
    
    console.log(`[AvatarManager] applyPose: ${pose}, animated=${animated}, mode=${effectiveAnimationMode}, loop=${shouldLoop}, rootMotion=${rootMotion}, transition=${transitionDuration}s`);
    
    this.isRootMotionEnabled = rootMotion;

    // Set camera to follow for root motion, but NOT if a follow mode (like selfie) is already active
    if (rootMotion && this.vrm && !sceneManager.isFollowing()) {
      sceneManager.setFollowTarget(this.vrm.scene, 'third-person');
    }

    // Pass VRM to getPoseDefinitionWithAnimation so it can retarget the animation tracks
    const def = shouldAnimate ? await getPoseDefinitionWithAnimation(pose, this.vrm) : getPoseDefinition(pose);
    if (!def) {
      return;
    }

    // Only apply scene rotation if not locked AND not in manual posing mode
    // Manual posing mode should always preserve the current rotation
    const shouldPreserveRotation = rotationLocked || this.isManualPosing;
    
    if (!shouldPreserveRotation && this.vrm) {
      this.vrm.scene.rotation.set(
        THREE.MathUtils.degToRad(def.sceneRotation?.x ?? 0), 
        THREE.MathUtils.degToRad(def.sceneRotation?.y ?? 180), // Default to 180 if not specified
        THREE.MathUtils.degToRad(def.sceneRotation?.z ?? 0)
      );
    } else {
      console.log('[AvatarManager] Scene rotation preserved (locked or manual posing active)');
    }

    if (shouldAnimate && def.animationClip) {
      console.log(`[AvatarManager] Playing animation clip for: ${pose}`);
      
      // Ensure the clip is using actual scene paths (Armature/Hips...) 
      // instead of bone names (hips...) before playing
      const { retargetAnimationClip } = await import('../poses/animationClipSerializer');
      
      // Determine if the clip needs retargeting to scene paths.
      // 1. Clips with no slashes at all definitely need retargeting (e.g. "hips.quaternion")
      // 2. Clips with "VRMHumanoidRig/" paths need retargeting
      // 3. Clips that are already scene-path-based are kept as-is
      const needsRetargeting = def.animationClip.tracks.some(t => 
        !t.name.includes('/') || t.name.startsWith('VRMHumanoidRig/') || t.name.startsWith('mixamorig')
      );

      if (!this.vrm) return;

      const playableClip = needsRetargeting
        ? retargetAnimationClip(def.animationClip, this.vrm, { stripHipsPosition: !rootMotion })
        : def.animationClip;

      this.playAnimationClip(playableClip, rotationLocked, shouldLoop, transitionDuration);
    } else if (shouldAnimate) {
      console.log(`[AvatarManager] Generating animation from pose: ${pose}`);
      if (!this.vrm) return;
      const vrmPose = buildVRMPose(def);
      const clip = getAnimatedPose(pose, vrmPose, this.vrm) || poseToAnimationClip(vrmPose, this.vrm, 0.5, pose);
      this.playAnimationClip(clip, rotationLocked, shouldLoop, transitionDuration);
    } else {
      console.log(`[AvatarManager] Applying static pose with transition: ${pose}`);
      // Clear follow target when applying a static pose
      sceneManager.setFollowTarget(null, null);
      
      const vrmPose = buildVRMPose(def);
      
      // Use smooth transition instead of immediate snap
      this.transitionToPose(vrmPose, rotationLocked, transitionDuration);
    }
  }

  playAnimationClip(clip: THREE.AnimationClip, rotationLocked: boolean, loop = true, fade = 0.3) {
    if (!this.vrm) {
      console.warn('[AvatarManager] playAnimationClip called but no VRM loaded');
      return;
    }
    
    // BLOCK animation playback when manual posing is active
    if (this.isManualPosing) {
      console.log('[AvatarManager] playAnimationClip BLOCKED - manual posing is active');
      return;
    }
    
    // When rotation is locked, remove or replace the Hips rotation track
    // to preserve the user's manual Hips adjustment
    let clipToPlay = clip;
    if (rotationLocked) {
      // Find the Hips bone node name
      const hipsNode = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
      if (hipsNode) {
        const hipsTrackName = `${hipsNode.name}.quaternion`;
        
        // Create a new clip without the Hips rotation track
        const filteredTracks = clip.tracks.filter(track => track.name !== hipsTrackName);
        
        if (filteredTracks.length !== clip.tracks.length) {
          console.log(`[AvatarManager] Removing Hips rotation track to preserve locked orientation`);
          clipToPlay = new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
        }
      }
    }
    
    console.log(`[AvatarManager] playAnimationClip: ${clipToPlay.name}, loop=${loop}, tracks=${clipToPlay.tracks.length}`);
    this._isInteracting = false;
    this.isAnimated = true;
    animationManager.playAnimation(clipToPlay, loop, fade);
  }

  stopAnimation(immediate = false) {
    this.isAnimated = false;
    animationManager.stopAnimation(immediate);
  }

  /**
   * Capture the current pose from all bones as a VRMPose
   */
  captureCurrentPose(): VRMPose {
    const pose: VRMPose = {};
    if (!this.vrm?.humanoid) return pose;

    const boneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneName[];
    boneNames.forEach(name => {
      const node = this.vrm!.humanoid!.getNormalizedBoneNode(name);
      if (node) {
        pose[name] = {
          rotation: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w]
        };
        // Include position for hips
        if (name === VRMHumanBoneName.Hips) {
          pose[name]!.position = [node.position.x, node.position.y, node.position.z];
        }
      }
    });
    return pose;
  }

  /**
   * Create a transition animation clip from current pose to target pose
   * Maintains consistent hips positioning to prevent avatar from moving off-screen
   */
  createTransitionClip(targetPose: VRMPose, duration = 0.4): THREE.AnimationClip {
    const tracks: THREE.KeyframeTrack[] = [];
    const currentPose = this.captureCurrentPose();
    const times = [0, duration];

    const boneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneName[];
    boneNames.forEach(boneName => {
      const node = this.vrm?.humanoid?.getNormalizedBoneNode(boneName);
      if (!node) return;

      const trackName = `${node.name}.quaternion`;
      
      // Get current rotation (or identity if not set)
      const currentRot = currentPose[boneName]?.rotation || [0, 0, 0, 1];
      // Get target rotation (or current if target doesn't specify this bone)
      const targetRot = targetPose[boneName]?.rotation || currentRot;

      // Only create track if there's a meaningful difference
      const qCurrent = new THREE.Quaternion(currentRot[0], currentRot[1], currentRot[2], currentRot[3]);
      const qTarget = new THREE.Quaternion(targetRot[0], targetRot[1], targetRot[2], targetRot[3]);
      
      if (qCurrent.angleTo(qTarget) > 0.001) {
        tracks.push(new THREE.QuaternionKeyframeTrack(
          trackName,
          times,
          [...currentRot, ...targetRot]
        ));
      }
    });

    // Always maintain hips position - keep avatar grounded
    // This prevents the avatar from floating or sinking during transitions
    const hipsNode = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hipsNode) {
      const currentPos = currentPose[VRMHumanBoneName.Hips]?.position || [0, hipsNode.position.y, 0];
      // If target has position, use it; otherwise return to default position
      const targetPos = targetPose[VRMHumanBoneName.Hips]?.position || [
        this.defaultHipsPosition.x,
        this.defaultHipsPosition.y,
        this.defaultHipsPosition.z
      ];
      
      // Always animate position to ensure we return to center if we drifted
      tracks.push(new THREE.VectorKeyframeTrack(
        `${hipsNode.name}.position`,
        times,
        [...currentPos, ...targetPos]
      ));
    }

    return new THREE.AnimationClip('pose-transition', duration, tracks);
  }

  /**
   * Smoothly transition to a static pose with animation
   * Preserves hips position to keep avatar in viewport
   * Preserves hips rotation when rotation is locked
   */
  transitionToPose(targetPose: VRMPose, rotationLocked: boolean, duration = 0.4) {
    if (!this.vrm) return;
    
    if (this.isManualPosing) {
      console.log('[AvatarManager] transitionToPose BLOCKED - manual posing is active');
      return;
    }

    const poseToApply = rotationLocked ? this.preserveHipsRotationInPose(targetPose) : targetPose;
    const transitionClip = this.createTransitionClip(poseToApply, duration);
    
    this.isAnimated = true;
    animationManager.playAnimation(transitionClip, false, 0.2);
  }

  freezeCurrentPose() {
    if (!this.vrm || !this.vrm.humanoid) return;
    console.log('[AvatarManager] Freezing pose via direct node capture');

    // 1. Capture direct transforms from the nodes
    const poseData = new Map<VRMHumanBoneName, { q: THREE.Quaternion, p: THREE.Vector3 }>();
    const boneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneName[];
    
    boneNames.forEach(name => {
      const node = this.vrm!.humanoid!.getNormalizedBoneNode(name);
      if (node) {
        poseData.set(name, { q: node.quaternion.clone(), p: node.position.clone() });
      }
    });

    // 2. Stop mixer (resets nodes)
    this.isAnimated = false;
    animationManager.stopAnimation(true);
    
    // 3. Re-apply direct transforms to nodes
    poseData.forEach((data, name) => {
      const node = this.vrm!.humanoid!.getNormalizedBoneNode(name);
      if (node) {
        node.quaternion.copy(data.q);
        if (name === VRMHumanBoneName.Hips) {
            node.position.copy(data.p);
        }
      }
    });
    
    // 4. Update VRM to lock in the direct changes
    this.vrm.humanoid.update();
    this.vrm.update(0);
  }

  pauseAnimation() { if (this.isAnimated) animationManager.pause(); }
  resumeAnimation() { if (this.isAnimated) animationManager.resume(); }
  resetPose() { if (!this.vrm) return; this.stopAnimation(); this.vrm.humanoid?.resetNormalizedPose(); this.vrm.update(0); }
  setAnimationLoop(loop: boolean) { if (this.isAnimated) animationManager.setLoop(loop); }
  setAnimationSpeed(speed: number) { if (this.isAnimated) animationManager.setSpeed(speed); }
  seekAnimation(time: number): void { if (this.isAnimated) animationManager.seek(time); }
  isAnimationPlaying(): boolean { return this.isAnimated && animationManager.isPlaying(); }
  getCurrentAnimationAction(): THREE.AnimationAction | undefined { return animationManager.getCurrentAction(); }
    getVRM(): VRM | undefined { return this.vrm; }

  setVisibility(visible: boolean) {
    if (this.vrm) {
      this.vrm.scene.visible = visible;
    }
  }
  clear() {
    const scene = sceneManager.getScene();
    if (this.vrm && scene) {
      scene.remove(this.vrm.scene);
    }
    this.tickDispose?.();
    this.tickDispose = undefined;
    this.vrm = undefined;
    this.currentUrl = undefined;
    this.isAnimated = false;
    animationManager.stopAnimation(true);
  }
  
  applyExpression(expression: ExpressionId) {
    if (!this.vrm) return;
    expressionMutators[expression]?.(this.vrm);
    this.vrm.expressionManager?.update();
  }

  getAvailableExpressions(): string[] {
    if (!this.vrm?.expressionManager) return [];
    const names: string[] = [];
    const manager = this.vrm.expressionManager as unknown as ExtendedExpressionManager;
    if (manager.expressionMap) {
      Object.keys(manager.expressionMap).forEach(name => names.push(name));
    } else if (manager.expressions) {
      manager.expressions.forEach((expr) => { 
        if (expr.expressionName) names.push(expr.expressionName); 
      });
    }
    return names.sort();
  }

  getExpressionWeights(): Record<string, number> {
    if (!this.vrm?.expressionManager) return {};
    
    const weights: Record<string, number> = {};
    const available = this.getAvailableExpressions();
    
    available.forEach(name => {
      const value = this.vrm!.expressionManager!.getValue(name);
      if (value !== undefined && value !== null && value > 0) {
        weights[name] = value;
      }
    });
    
    return weights;
  }

  setExpressionWeight(name: string, weight: number) {
    if (!this.vrm?.expressionManager) return;
    this.vrm.expressionManager.setValue(name, weight);
    this.vrm.expressionManager.update();
  }
}

export function buildVRMPose(definition: PoseDefinition): VRMPose {
  if (definition.vrmPose) return JSON.parse(JSON.stringify(definition.vrmPose));
  const pose: VRMPose = {};
  if (!definition.boneRotations) return pose;
  Object.entries(definition.boneRotations).forEach(([boneName, rotation]) => {
    const euler = new THREE.Euler(THREE.MathUtils.degToRad(rotation.x ?? 0), THREE.MathUtils.degToRad(rotation.y ?? 0), THREE.MathUtils.degToRad(rotation.z ?? 0), 'XYZ');
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    pose[boneName as VRMHumanBoneName] = { rotation: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] };
  });
  return pose;
}

export const avatarManager = new AvatarManager();
