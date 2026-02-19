import * as THREE from 'three';
import { GLTFLoader as ThreeGLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { VRMPose } from '@pixiv/three-vrm';
import { sceneManager } from './sceneManager';
import { materialManager } from './materialManager';
import { avatarManager } from './avatarManager';
import type { PeerId, AvatarState } from '../types/multiplayer';
import { 
  GESTURE_LIBRARY, 
  EXPRESSION_PRESETS, 
  Easing, 
  type EmotionState 
} from '../data/gestures';
import { getPoseDefinitionWithAnimation, getPoseDefinition } from '../poses';
import { buildVRMPose } from './avatarManager';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';

/** Individual avatar instance data */
interface AvatarInstance {
  vrm: VRM;
  peerId: PeerId;
  isLocal: boolean;
  displayName: string;
  mixer: THREE.AnimationMixer;
  currentAction?: THREE.AnimationAction;
  isAnimated: boolean;
  lastUpdate: number;
  isDirty: boolean;
  /** Whether position was manually set by user (ignore auto-layout) */
  isManualPosition: boolean;
  /** The position assigned by auto-layout */
  assignedPosition: THREE.Vector3;
  /** Offset position in the scene */
  positionOffset: THREE.Vector3;
  
  // Interpolation state
  targetPose?: VRMPose;
  lastPose?: VRMPose;
  poseAlpha: number;
}

/**
 * MultiAvatarManager handles multiple VRM avatars in the scene.
 * Extends the original AvatarManager pattern to support multiplayer.
 */
class MultiAvatarManager {
  private loader = new ThreeGLTFLoader();
  private avatars = new Map<PeerId, AvatarInstance>();
  private localPeerId: PeerId | null = null;
  private tickDispose?: () => void;
  private isInteracting = false;
  private isManualPosing = false;
  private gestureAnimations = new Map<PeerId, { 
    gesture: string; 
    startTime: number; 
    duration: number;
    initialRotations: Map<string, THREE.Quaternion>;
  }>();

  constructor() {
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
  }

  // ==================
  // Local Avatar Management
  // ==================

  /** Set the local peer ID */
  setLocalPeerId(peerId: PeerId) {
    this.localPeerId = peerId;
  }

  /** Get the local avatar's VRM */
  getLocalVRM(): VRM | undefined {
    if (!this.localPeerId) return undefined;
    return this.avatars.get(this.localPeerId)?.vrm;
  }

  /** Get the local avatar instance */
  getLocalAvatar(): AvatarInstance | undefined {
    if (!this.localPeerId) return undefined;
    return this.avatars.get(this.localPeerId);
  }

  /** Check if manual posing is enabled */
  isManualPosingEnabled(): boolean {
    return this.isManualPosing;
  }

  /** Set manual posing mode */
  setManualPosing(enabled: boolean) {
    this.isManualPosing = enabled;
  }

  /** Set interaction state */
  setInteraction(interacting: boolean) {
    this.isInteracting = interacting;
  }

  // ==================
  // Avatar Loading
  // ==================

  /**
   * Load a VRM for a peer
   * @param peerId - The peer's unique ID
   * @param url - URL to the VRM file (blob: URL or remote)
   * @param isLocal - Whether this is the local user's avatar
   * @param displayName - Display name for the avatar
   */
  async loadAvatar(
    peerId: PeerId,
    url: string,
    isLocal: boolean,
    displayName: string
  ): Promise<VRM> {
    const scene = sceneManager.getScene();
    if (!scene) throw new Error('Scene not initialized');

    console.log(`[MultiAvatarManager] Loading avatar for peer: ${peerId} (${isLocal ? 'local' : 'remote'})`);

    // Check if this peer already has an avatar
    const existing = this.avatars.get(peerId);
    if (existing) {
      // Remove existing avatar
      this.removeAvatar(peerId);
    }

    // Load the VRM
    const gltf = await this.loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error('Invalid VRM file');

    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    // Combine skeletons for better performance (replaces deprecated removeUnnecessaryJoints)
    VRMUtils.combineSkeletons(vrm.scene);

    // Create avatar instance
    const instance: AvatarInstance = {
      vrm,
      peerId,
      isLocal,
      displayName,
      mixer: new THREE.AnimationMixer(vrm.scene),
      isAnimated: false,
      lastUpdate: Date.now(),
      positionOffset: new THREE.Vector3(0, 0, 0),
      assignedPosition: new THREE.Vector3(0, 0, 0),
      isManualPosition: false,
      isDirty: true,
      poseAlpha: 1,
    };

    // Position the avatar (initial placement at 0,0,0, layout engine will fix)
    vrm.scene.position.set(0, 0, 0);
    // Most VRMs are exported facing +Z but poses were authored with avatar at 180°.
    // Start at 180° rotation so avatar faces camera.
    vrm.scene.rotation.set(0, Math.PI, 0);

    // Add to scene
    scene.add(vrm.scene);

    // Store instance
    this.avatars.set(peerId, instance);

    // If local, set as local peer
    if (isLocal) {
      this.localPeerId = peerId;
    }

    // Update layout for all avatars
    this.recalculateLayout();

    // Frame camera on local avatar
    if (isLocal) {
      sceneManager.frameObject(vrm.scene);
    }

    // Start tick loop if not already running
    this.ensureTickLoop();

    // Apply material settings
    materialManager.onVRMLoaded();

    console.log(`[MultiAvatarManager] Avatar loaded: ${peerId}, total avatars: ${this.avatars.size}`);

    return vrm;
  }

  /**
   * Load a remote avatar from ArrayBuffer (received via WebRTC)
   */
  async loadRemoteAvatarFromBuffer(
    peerId: PeerId,
    buffer: ArrayBuffer,
    displayName: string
  ): Promise<VRM> {
    // Create a blob URL from the buffer
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    try {
      const vrm = await this.loadAvatar(peerId, url, false, displayName);
      return vrm;
    } finally {
      // Clean up blob URL after loading
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Register an existing VRM (already in scene) with the multiAvatarManager.
   * Used when migrating from single-player avatarManager to multiplayer.
   * Does NOT add to scene or load - just registers for tracking and sync.
   */
  registerExistingAvatar(
    peerId: PeerId,
    vrm: VRM,
    isLocal: boolean,
    displayName: string
  ) {
    console.log(`[MultiAvatarManager] Registering existing avatar for peer: ${peerId}`);

    // Check if this peer already has an avatar registered
    const existingInstance = this.avatars.get(peerId);
    if (existingInstance) {
      // If it's the same VRM object, skip (no change needed)
      if (existingInstance.vrm === vrm) {
        console.log(`[MultiAvatarManager] Peer ${peerId} already has this exact avatar, skipping`);
        return;
      }
      
      // Different VRM - this is an avatar replacement
      console.log(`[MultiAvatarManager] Peer ${peerId} is replacing their avatar`);
      
      // Stop any running animations on the old avatar
      existingInstance.mixer.stopAllAction();
      
      // Note: We don't remove the old VRM from scene here because avatarManager 
      // already handles that during load() - it removes the old scene object
      // before adding the new one
      
      // Remove old instance from our tracking
      this.avatars.delete(peerId);
    }

    // Create avatar instance without repositioning (it's already in scene)
    const instance: AvatarInstance = {
      vrm,
      peerId,
      isLocal,
      displayName,
      mixer: new THREE.AnimationMixer(vrm.scene),
      isAnimated: false,
      lastUpdate: Date.now(),
      positionOffset: new THREE.Vector3(0, 0, 0), // Keep current position
      assignedPosition: new THREE.Vector3(0, 0, 0),
      isManualPosition: false,
      isDirty: true,
      poseAlpha: 1,
    };

    // Store instance
    this.avatars.set(peerId, instance);

    // If local, set as local peer
    if (isLocal) {
      this.localPeerId = peerId;
    }

    // Update layout
    this.recalculateLayout();

    // Start tick loop if not already running
    this.ensureTickLoop();

    console.log(`[MultiAvatarManager] Registered existing avatar: ${peerId}, total avatars: ${this.avatars.size}`);
  }

  /**
   * Remove an avatar from the scene
   */
  removeAvatar(peerId: PeerId) {
    const instance = this.avatars.get(peerId);
    if (!instance) return;

    console.log(`[MultiAvatarManager] Removing avatar: ${peerId}`);

    const scene = sceneManager.getScene();
    if (scene) {
      scene.remove(instance.vrm.scene);
    }

    // Clean up mixer
    if (instance.currentAction) {
      instance.currentAction.stop();
    }
    instance.mixer.stopAllAction();

    // Remove from map
    this.avatars.delete(peerId);

    // Recalculate positions for remaining avatars
    this.recalculateLayout();

    // If no avatars left, stop tick loop
    if (this.avatars.size === 0) {
      this.tickDispose?.();
      this.tickDispose = undefined;
    }
  }

  /**
   * Remove all avatars
   */
  removeAllAvatars() {
    const peerIds = Array.from(this.avatars.keys());
    peerIds.forEach(peerId => this.removeAvatar(peerId));
    this.localPeerId = null;
  }

  /**
   * End session cleanup
   * Removes remote avatars but preserves local avatar in scene
   */
  endSession() {
    console.log('[MultiAvatarManager] Ending session, cleaning up avatars');
    const peerIds = Array.from(this.avatars.keys());
    
    peerIds.forEach(peerId => {
      const instance = this.avatars.get(peerId);
      if (instance?.isLocal) {
         console.log('[MultiAvatarManager] Preserving local avatar, resetting position');
         // Stop tracking in this manager but keep in scene
         this.avatars.delete(peerId);
         
         // Reset position to center (undo multiplayer layout offset)
         instance.vrm.scene.position.set(0, 0, 0);
         
         // Stop our mixer (AvatarManager's mixer will continue to handle it)
         instance.mixer.stopAllAction();
         
      } else {
         this.removeAvatar(peerId);
      }
    });
    
    this.localPeerId = null;
    this.gestureAnimations.clear();
    
    // Stop tick loop if empty
    if (this.avatars.size === 0) {
      this.tickDispose?.();
      this.tickDispose = undefined;
    }
  }

  // ==================
  // Pose Application
  // ==================

  /**
   * Apply a pose to an avatar
   * Note: For remote avatars only - local avatar is controlled by avatarManager
   */
  applyPose(peerId: PeerId, pose: VRMPose, forceLocal = false) {
    const instance = this.avatars.get(peerId);
    if (!instance || !instance.vrm.humanoid) return;

    // Safety check: don't apply external poses to local avatar unless forced
    if (instance.isLocal && !forceLocal) {
      console.warn(`[MultiAvatarManager] Ignoring external pose for local avatar`);
      return;
    }

    // Set up interpolation
    // Save the current state as the starting point (lastPose)
    // We can capture it from the VRM, or use the previous target if we want to be strict
    // Capturing from VRM ensures we interpolate from exactly where we are visually
    instance.lastPose = this.captureCurrentPose(instance);
    instance.targetPose = pose;
    instance.poseAlpha = 0;
    
    // We don't update immediately anymore, let the tick loop handle it
    // instance.vrm.humanoid.setNormalizedPose(pose);
    // instance.vrm.update(0);
    instance.lastUpdate = Date.now();
    instance.isDirty = true;
  }

  /**
   * Apply expressions to an avatar
   * Note: For remote avatars only - local avatar expressions are controlled by avatarManager
   */
  applyExpressions(peerId: PeerId, expressions: Record<string, number>, forceLocal = false) {
    const instance = this.avatars.get(peerId);
    if (!instance || !instance.vrm.expressionManager) return;

    // Safety check: don't apply external expressions to local avatar unless forced
    if (instance.isLocal && !forceLocal) {
      console.warn(`[MultiAvatarManager] Ignoring external expressions for local avatar`);
      return;
    }

    Object.entries(expressions).forEach(([name, value]) => {
      instance.vrm.expressionManager?.setValue(name, value);
    });
    instance.vrm.expressionManager.update();
    instance.lastUpdate = Date.now();
    instance.isDirty = true;
  }

  /**
   * Apply scene rotation to an avatar
   * Note: For remote avatars only - local avatar rotation is controlled directly
   */
  applySceneRotation(peerId: PeerId, rotation: { x: number; y: number; z: number }, forceLocal = false) {
    const instance = this.avatars.get(peerId);
    if (!instance) return;

    // Safety check: don't apply external rotation to local avatar unless forced
    if (instance.isLocal && !forceLocal) {
      console.warn(`[MultiAvatarManager] Ignoring external rotation for local avatar`);
      return;
    }

    instance.vrm.scene.rotation.set(
      THREE.MathUtils.degToRad(rotation.x),
      THREE.MathUtils.degToRad(rotation.y),
      THREE.MathUtils.degToRad(rotation.z)
    );
    instance.isDirty = true;
  }

  /**
   * Apply scene position to an avatar (user-controlled X-axis translation)
   * Note: For remote avatars only - local avatar position is controlled directly
   */
  applyScenePosition(peerId: PeerId, position: { x: number; y: number; z: number }, forceLocal = false) {
    const instance = this.avatars.get(peerId);
    if (!instance) return;

    // Safety check: don't apply external position to local avatar unless forced
    if (instance.isLocal && !forceLocal) {
      console.warn(`[MultiAvatarManager] Ignoring external position for local avatar`);
      return;
    }

    // Apply user-controlled position (from gizmo translation)
    instance.vrm.scene.position.set(position.x, position.y, position.z);
    
    // Update the stored offset and mark as manual
    instance.positionOffset.set(position.x, position.y, position.z);
    instance.isManualPosition = true;
    instance.isDirty = true;
  }

  /**
   * Apply full avatar state (pose + expressions + rotation)
   * Note: For remote avatars only - local avatar is controlled by avatarManager
   */
  applyAvatarState(peerId: PeerId, state: AvatarState, forceLocal = false) {
    const instance = this.avatars.get(peerId);
    if (!instance) return;

    // Safety check: don't apply external state to local avatar unless forced
    if (instance.isLocal && !forceLocal) {
      console.warn(`[MultiAvatarManager] Ignoring external state for local avatar`);
      return;
    }

    this.applyPose(peerId, state.pose, forceLocal);
    this.applyExpressions(peerId, state.expressions, forceLocal);
    this.applySceneRotation(peerId, state.sceneRotation, forceLocal);
    if (state.position) {
      this.applyScenePosition(peerId, state.position, forceLocal);
    }
  }

  /**
   * Get the current state of the local avatar
   */
  getLocalAvatarState(): AvatarState | null {
    const instance = this.getLocalAvatar();
    if (!instance || !instance.vrm.humanoid) return null;

    // Capture current pose
    const pose = this.captureCurrentPose(instance);

    // Capture expressions
    const expressions = this.captureExpressions(instance);

    // Get scene rotation
    const sceneRotation = {
      x: THREE.MathUtils.radToDeg(instance.vrm.scene.rotation.x),
      y: THREE.MathUtils.radToDeg(instance.vrm.scene.rotation.y),
      z: THREE.MathUtils.radToDeg(instance.vrm.scene.rotation.z),
    };

    // Get scene position (user-controlled via gizmo)
    const scenePosition = instance.vrm.scene.position;
    
    // Check if position deviates from assigned auto-layout position
    // If effectively same, don't broadcast position (let receiver auto-layout handle it)
    const dist = scenePosition.distanceTo(instance.assignedPosition);
    const isManual = dist > 0.01 || instance.isManualPosition;

    return {
      peerId: instance.peerId,
      displayName: instance.displayName,
      sceneRotation,
      pose,
      expressions,
      position: isManual ? {
        x: scenePosition.x,
        y: scenePosition.y,
        z: scenePosition.z,
      } : undefined,
      hasAvatar: true,
      timestamp: Date.now(),
    };
  }

  /**
   * Capture the current pose from a VRM
   */
  private captureCurrentPose(instance: AvatarInstance): VRMPose {
    const pose: VRMPose = {};
    const humanoid = instance.vrm.humanoid;
    if (!humanoid) return pose;

    const boneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneName[];
    boneNames.forEach(name => {
      const node = humanoid.getNormalizedBoneNode(name);
      if (node) {
        const q = node.quaternion;
        pose[name] = {
          rotation: [q.x, q.y, q.z, q.w],
        };
        // Don't sync hips position - different avatars have different proportions
        // and syncing position causes floating/sinking issues
      }
    });

    return pose;
  }

  /**
   * Capture current expressions from a VRM
   */
  private captureExpressions(instance: AvatarInstance): Record<string, number> {
    const expressions: Record<string, number> = {};
    const manager = instance.vrm.expressionManager;
    if (!manager) return expressions;

    // Get all expression names and their values
    const expressionNames = this.getAvailableExpressions(instance.peerId);
    expressionNames.forEach(name => {
      const value = manager.getValue(name);
      if (value !== undefined && value !== null && value > 0) {
        expressions[name] = value;
      }
    });

    return expressions;
  }

  // ==================
  // Animation
  // ==================

  /**
   * Play an animation clip on an avatar
   */
  playAnimationClip(peerId: PeerId, clip: THREE.AnimationClip, loop = true, fade = 0.3) {
    const instance = this.avatars.get(peerId);
    if (!instance) return;

    // Stop current animation with fade
    if (instance.currentAction) {
      instance.currentAction.fadeOut(fade);
    }

    // Create and play new action
    const action = instance.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.fadeIn(fade);
    action.play();

    instance.currentAction = action;
    instance.isAnimated = true;
  }

  /**
   * Apply a preset pose to an avatar
   */
  async applyPreset(peerId: PeerId, poseId: string, animated = true) {
    const instance = this.avatars.get(peerId);
    if (!instance) return;

    // For local avatar, delegate to avatarManager
    if (instance.isLocal) {
      const rotationLocked = useSceneSettingsStore.getState().rotationLocked;
      avatarManager.applyPose(poseId as any, rotationLocked, animated, animated ? 'once' : 'static');
      return;
    }

    try {
      const def = animated 
        ? await getPoseDefinitionWithAnimation(poseId as any, instance.vrm) 
        : getPoseDefinition(poseId as any);
        
      if (!def) return;

      if (animated && def.animationClip) {
        this.playAnimationClip(peerId, def.animationClip, false);
      } else {
        const vrmPose = buildVRMPose(def);
        this.applyPose(peerId, vrmPose);
      }
    } catch (e) {
      console.warn(`[MultiAvatarManager] Failed to apply preset ${poseId} to ${peerId}:`, e);
    }
  }

  /**
   * Perform a gesture on an avatar (procedural animation)
   */
  async performGesture(peerId: PeerId, gesture: string, _intensity = 1.0) {
    const instance = this.avatars.get(peerId);
    if (!instance || !instance.vrm.humanoid) return;

    const gestureData = GESTURE_LIBRARY[gesture];
    if (!gestureData) return;

    // Capture initial rotations for all bones in the gesture
    const initialRotations = new Map<string, THREE.Quaternion>();
    const boneNames = new Set<string>();
    gestureData.keyframes.forEach(kf => {
      Object.keys(kf.bones).forEach(b => boneNames.add(b));
    });

    boneNames.forEach(name => {
      const node = instance.vrm.humanoid!.getNormalizedBoneNode(name as any);
      if (node) initialRotations.set(name, node.quaternion.clone());
    });

    this.gestureAnimations.set(peerId, {
      gesture,
      startTime: performance.now(),
      duration: gestureData.duration * 1000,
      initialRotations
    });
    instance.isDirty = true;

    console.log(`[MultiAvatarManager] Started gesture ${gesture} for peer ${peerId}`);
  }

  /**
   * Set emotional expression on an avatar
   */
  setEmotion(peerId: PeerId, emotion: EmotionState) {
    const instance = this.avatars.get(peerId);
    if (!instance || !instance.vrm.expressionManager) return;

    const expressions = EXPRESSION_PRESETS[emotion];
    if (!expressions) return;

    Object.entries(expressions).forEach(([name, value]) => {
      instance.vrm.expressionManager!.setValue(name, value);
    });
    instance.vrm.expressionManager.update();
    instance.isDirty = true;
  }

  /**
   * Stop animation on an avatar
   */
  stopAnimation(peerId: PeerId, immediate = true) {
    const instance = this.avatars.get(peerId);
    if (!instance) return;

    if (instance.currentAction) {
      if (immediate) {
        instance.currentAction.stop();
        instance.currentAction.reset();
      } else {
        instance.currentAction.fadeOut(0.3);
      }
      instance.currentAction = undefined;
    }

    if (immediate) {
      instance.mixer.stopAllAction();
    }

    instance.isAnimated = false;
  }

  /**
   * Freeze current pose (for switching from animation to manual posing)
   */
  freezeCurrentPose(peerId: PeerId) {
    const instance = this.avatars.get(peerId);
    if (!instance || !instance.vrm.humanoid) return;

    // Capture current transforms
    const boneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneName[];
    const poseData = new Map<VRMHumanBoneName, { q: THREE.Quaternion; p: THREE.Vector3 }>();

    boneNames.forEach(name => {
      const node = instance.vrm.humanoid!.getNormalizedBoneNode(name);
      if (node) {
        poseData.set(name, { q: node.quaternion.clone(), p: node.position.clone() });
      }
    });

    // Stop animation
    this.stopAnimation(peerId, true);

    // Re-apply transforms
    poseData.forEach((data, name) => {
      const node = instance.vrm.humanoid!.getNormalizedBoneNode(name);
      if (node) {
        node.quaternion.copy(data.q);
        if (name === VRMHumanBoneName.Hips) {
          node.position.copy(data.p);
        }
      }
    });

    instance.vrm.humanoid.update();
    instance.vrm.update(0);
  }

  /**
   * Reset an avatar to T-pose
   */
  resetPose(peerId: PeerId) {
    const instance = this.avatars.get(peerId);
    if (!instance) return;

    this.stopAnimation(peerId);
    instance.vrm.humanoid?.resetNormalizedPose();
    instance.vrm.update(0);
  }

  // ==================
  // Utilities
  // ==================

  /**
   * Get available expressions for an avatar
   */
  getAvailableExpressions(peerId: PeerId): string[] {
    const instance = this.avatars.get(peerId);
    if (!instance?.vrm.expressionManager) return [];

    const names: string[] = [];
    const manager = instance.vrm.expressionManager as unknown as {
      expressionMap?: Record<string, unknown>;
      expressions?: { expressionName?: string }[];
    };

    if (manager.expressionMap) {
      Object.keys(manager.expressionMap).forEach(name => names.push(name));
    } else if (manager.expressions) {
      manager.expressions.forEach(expr => {
        if (expr.expressionName) names.push(expr.expressionName);
      });
    }

    return names.sort();
  }

  /**
   * Set expression weight for an avatar
   */
  setExpressionWeight(peerId: PeerId, name: string, weight: number) {
    const instance = this.avatars.get(peerId);
    if (!instance?.vrm.expressionManager) return;

    instance.vrm.expressionManager.setValue(name, weight);
    instance.vrm.expressionManager.update();
  }

  /**
   * Get all avatar instances
   */
  getAllAvatars(): Map<PeerId, AvatarInstance> {
    return this.avatars;
  }

  /**
   * Get avatar count
   */
  getAvatarCount(): number {
    return this.avatars.size;
  }

  /**
   * Check if a peer has an avatar
   */
  hasAvatar(peerId: PeerId): boolean {
    return this.avatars.has(peerId);
  }

  /**
   * Get VRM for a peer
   */
  getVRM(peerId: PeerId): VRM | undefined {
    return this.avatars.get(peerId)?.vrm;
  }

  // ==================
  // Internal
  // ==================

  /**
   * Interpolate between two VRMPoses
   */
  private interpolatePose(start: VRMPose, end: VRMPose, alpha: number): VRMPose {
    const result: VRMPose = {};
    const boneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneName[];

    boneNames.forEach(name => {
      const startBone = start[name];
      const endBone = end[name];

      if (startBone && endBone) {
        const interpolated: any = {};
        
        // Rotation
        if (startBone.rotation && endBone.rotation) {
          const q1 = new THREE.Quaternion().fromArray(startBone.rotation);
          const q2 = new THREE.Quaternion().fromArray(endBone.rotation);
          q1.slerp(q2, alpha);
          interpolated.rotation = q1.toArray();
        }

        // Position (optional)
        if (startBone.position && endBone.position) {
          const v1 = new THREE.Vector3().fromArray(startBone.position);
          const v2 = new THREE.Vector3().fromArray(endBone.position);
          v1.lerp(v2, alpha);
          interpolated.position = v1.toArray();
        }

        result[name] = interpolated;
      } else if (endBone) {
        // If only end exists, snap to it
        result[name] = endBone;
      } else if (startBone) {
        // If only start exists, keep it
        result[name] = startBone;
      }
    });

    return result;
  }

  /**
   * Recalculate and apply positions for all avatars (Grid Layout)
   * Arranges avatars in centered rows, skipping manually positioned ones.
   */
  private recalculateLayout() {
    const allAvatars = Array.from(this.avatars.values());
    
    // Filter avatars that should be part of the auto-layout
    // (Not manually positioned)
    const layoutAvatars = allAvatars.filter(a => !a.isManualPosition);
    
    if (layoutAvatars.length === 0) return;

    // Sort: Local avatar first (if present), then alphabetical by PeerID
    layoutAvatars.sort((a, b) => {
      if (a.isLocal) return -1;
      if (b.isLocal) return 1;
      return a.peerId.localeCompare(b.peerId);
    });

    // Grid configuration
    const SPACING_X = 1.5; // Meters
    const SPACING_Z = 1.5; // Meters
    const MAX_ROW_WIDTH = 6; // Avatars per row

    layoutAvatars.forEach((instance, index) => {
      const row = Math.floor(index / MAX_ROW_WIDTH);
      const col = index % MAX_ROW_WIDTH;
      
      // Calculate centering offset for this row
      const itemsInThisRow = Math.min(MAX_ROW_WIDTH, layoutAvatars.length - row * MAX_ROW_WIDTH);
      const rowWidth = (itemsInThisRow - 1) * SPACING_X;
      const xStart = -rowWidth / 2;

      const x = xStart + col * SPACING_X;
      // Z position: Row 0 is at Z=0, subsequent rows behind (positive Z?) or checkerboard?
      // Usually +Z is towards camera. So rows should be at 0, -1.5, -3.0 etc?
      // Or 0, 1.5, 3.0? If camera is at (0, 1.4, 1.5) looking at (0, 1.0, 0)
      // We want rows BEHIND the first row? No, that would be occluded.
      // We want a V-shape or grid where back rows are visible?
      // Simplest: Rows go back (-Z) or spread out.
      // Let's keep them on Z=0 line if possible, or slight arc.
      // But for 32 users, we need depth.
      // Let's use Z = -row * SPACING_Z (going backwards)
      // And maybe elevate back rows slightly? 
      // For now, flat grid.
      // Wait, standard VRM is at 0,0,0. Camera is at 0, 1.4, ~2.5.
      // If we put rows at -Z, they get further away.
      // If we stagger them?
      
      const z = -row * SPACING_Z; // Rows go back into the screen

      // Update assigned position (auto-layout target)
      instance.assignedPosition.set(x, 0, z);

      // Only apply if not manually positioned
      if (!instance.isManualPosition) {
        if (instance.positionOffset.x !== x || instance.positionOffset.z !== z) {
          instance.positionOffset.set(x, 0, z);
          instance.vrm.scene.position.copy(instance.positionOffset);
          // Ensure rotation is correct (facing camera/forward +Z)
          instance.vrm.scene.rotation.set(0, Math.PI, 0); 
        }
      }
    });
  }

  /**
   * Ensure the tick loop is running
   */
  private ensureTickLoop() {
    if (this.tickDispose) return;

    this.tickDispose = sceneManager.registerTick((delta) => {
      const now = performance.now();

      this.avatars.forEach(instance => {
        const peerId = instance.peerId;

        const gestureActive = this.gestureAnimations.has(peerId);

        // Skip updates if not animating and not dirty
        if (!instance.isAnimated && !instance.isDirty && !gestureActive) {
          return;
        }

        // Process procedural gestures
        const anim = this.gestureAnimations.get(peerId);
        if (anim) {
          const elapsed = now - anim.startTime;
          const normalizedTime = Math.min(elapsed / anim.duration, 1);
          const gestureData = GESTURE_LIBRARY[anim.gesture];

          if (gestureData) {
            const keyframes = gestureData.keyframes;
            let prevKf = keyframes[0];
            let nextKf = keyframes[keyframes.length - 1];

            for (let i = 0; i < keyframes.length - 1; i++) {
              if (normalizedTime >= keyframes[i].time && normalizedTime <= keyframes[i + 1].time) {
                prevKf = keyframes[i];
                nextKf = keyframes[i + 1];
                break;
              }
            }

            const kfDuration = nextKf.time - prevKf.time;
            const kfProgress = kfDuration > 0 ? (normalizedTime - prevKf.time) / kfDuration : 1;
            const easingFn = nextKf.easing ? Easing[nextKf.easing] : Easing.easeInOut;
            const easedProgress = easingFn(kfProgress);

            Object.keys(anim.initialRotations).forEach(boneName => {
              const node = instance.vrm.humanoid!.getNormalizedBoneNode(boneName as any);
              if (!node) return;

              const prevRot = (prevKf.bones as any)[boneName] || { x: 0, y: 0, z: 0 };
              const nextRot = (nextKf.bones as any)[boneName] || { x: 0, y: 0, z: 0 };

              const fromQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(prevRot.x),
                THREE.MathUtils.degToRad(prevRot.y),
                THREE.MathUtils.degToRad(prevRot.z),
                'XYZ'
              ));
              const toQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(nextRot.x),
                THREE.MathUtils.degToRad(nextRot.y),
                THREE.MathUtils.degToRad(nextRot.z),
                'XYZ'
              ));

              node.quaternion.slerpQuaternions(fromQuat, toQuat, easedProgress);
            });

            instance.vrm.humanoid!.update();
          }

          if (normalizedTime >= 1) {
            this.gestureAnimations.delete(peerId);
            console.log(`[MultiAvatarManager] Gesture ${anim.gesture} complete for ${peerId}`);
          }
        }

        // Update VRM
        // Handle Pose Interpolation
        if (instance.targetPose && instance.poseAlpha < 1) {
           // Interpolate 10x per second (assuming 30hz updates, 33ms)
           // We want to reach target in ~100ms for smoothness
           instance.poseAlpha += delta * 10; 
           if (instance.poseAlpha > 1) instance.poseAlpha = 1;
           
           if (instance.lastPose) {
               const interpolated = this.interpolatePose(instance.lastPose, instance.targetPose, instance.poseAlpha);
               instance.vrm.humanoid?.setNormalizedPose(interpolated);
           } else {
               instance.vrm.humanoid?.setNormalizedPose(instance.targetPose);
           }
        }

        instance.vrm.update(delta);

        // Update animation mixer if animated and not interacting
        if (instance.isAnimated && !(instance.isLocal && this.isInteracting)) {
          instance.mixer.update(delta);
        }
        
        // Reset dirty flag after update
        if (instance.isDirty) {
            instance.isDirty = false;
        }
      });
    });
  }

  /**
   * Rebind all avatars to scene (for scene reset)
   */
  rebindToScene() {
    const scene = sceneManager.getScene();
    if (!scene) return;

    this.avatars.forEach(instance => {
      instance.vrm.scene.removeFromParent();
      scene.add(instance.vrm.scene);
    });

    this.ensureTickLoop();
  }
}

export const multiAvatarManager = new MultiAvatarManager();


