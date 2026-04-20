/**
 * AI Avatar Controller
 * 
 * This module provides the AI with complete control over the VRM avatar,
 * including poses, expressions, animations, and procedural movements.
 * 
 * The AI is the "soul" of the avatar - it can make it move, emote, gesture,
 * and respond naturally to any situation.
 * 
 * Based on best practices from CharacterStudio (https://github.com/M3-org/CharacterStudio)
 * and VRM specification standards.
 */

import * as THREE from 'three';
import { avatarManager } from '../three/avatarManager';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { VRMPose } from '@pixiv/three-vrm';
import type { PoseId } from '../types/reactions';
import { 
  GESTURE_LIBRARY, 
  EXPRESSION_PRESETS, 
  Easing, 
  type EmotionState, 
  type GestureType
} from '../data/gestures';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';

/**
 * Helper to safely get a bone node from VRM humanoid
 * Following CharacterStudio's pattern of null-safe bone access
 */
function getBoneNode(vrm: any, boneName: VRMHumanBoneName): THREE.Object3D | null {
  if (!vrm?.humanoid) return null;
  return vrm.humanoid.getNormalizedBoneNode(boneName);
}

/**
 * Apply rotation to a bone using Euler angles (in degrees)
 * Converts to quaternion for smooth interpolation
 * Exported for use by other modules (e.g., MotionEngine)
 */
export function applyBoneRotation(
  bone: THREE.Object3D,
  rotation: { x: number; y: number; z: number },
  intensity = 1.0
): void {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotation.x * intensity),
    THREE.MathUtils.degToRad(rotation.y * intensity),
    THREE.MathUtils.degToRad(rotation.z * intensity),
    'XYZ'
  );
  bone.quaternion.setFromEuler(euler);
}

/**
 * Smoothly interpolate between two bone rotations using SLERP
 * This is the key to natural-looking animations
 */
function slerpBoneRotation(
  bone: THREE.Object3D,
  fromRot: { x: number; y: number; z: number },
  toRot: { x: number; y: number; z: number },
  t: number,
  intensity = 1.0
): void {
  const fromQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(fromRot.x * intensity),
      THREE.MathUtils.degToRad(fromRot.y * intensity),
      THREE.MathUtils.degToRad(fromRot.z * intensity),
      'XYZ'
    )
  );
  
  const toQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(toRot.x * intensity),
      THREE.MathUtils.degToRad(toRot.y * intensity),
      THREE.MathUtils.degToRad(toRot.z * intensity),
      'XYZ'
    )
  );
  
  bone.quaternion.slerpQuaternions(fromQuat, toQuat, t);
}

export type BodyLanguage = 
  | 'open' | 'closed' | 'confident' | 'shy' 
  | 'attentive' | 'relaxed' | 'tense' | 'curious';

export interface AvatarState {
  emotion: EmotionState;
  bodyLanguage: BodyLanguage;
  isAnimating: boolean;
  isSpeaking: boolean;
  currentGesture: GestureType | null;
  lookTarget: THREE.Vector3 | null;
}

export interface ActionCommand {
  type: 'gesture' | 'pose' | 'expression' | 'look' | 'speak' | 'idle';
  value: string;
  intensity?: number;  // 0-1
  duration?: number;   // seconds
  blend?: boolean;     // smooth transition
}

class AvatarController {
  private state: AvatarState = {
    emotion: 'neutral',
    bodyLanguage: 'relaxed',
    isAnimating: false,
    isSpeaking: false,
    currentGesture: null,
    lookTarget: null,
  };

  private idleAnimationId: number | null = null;
  private expressionTransitionId: number | null = null;
  private breathingEnabled = true;

  // -------------------------------------------------------------------------
  // STATE MANAGEMENT
  // -------------------------------------------------------------------------

  getState(): AvatarState {
    return { ...this.state };
  }

  // -------------------------------------------------------------------------
  // EMOTION CONTROL
  // -------------------------------------------------------------------------

  /**
   * Set the avatar's emotional state with smooth transition
   */
  async setEmotion(emotion: EmotionState, transitionDuration = 0.5): Promise<void> {
    const vrm = avatarManager.getVRM();
    if (!vrm?.expressionManager) return;

    this.state.emotion = emotion;
    const targetExpressions = EXPRESSION_PRESETS[emotion];

    // Animate expression transition
    const startExpressions: Record<string, number> = {};
    
    // Get current expression values
    Object.keys(targetExpressions).forEach(name => {
      const expr = vrm.expressionManager!.getExpression(name);
      startExpressions[name] = expr?.weight ?? 0;
    });

    const startTime = performance.now();
    
    return new Promise(resolve => {
      const animate = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        const t = Math.min(elapsed / transitionDuration, 1);
        const easedT = Easing.easeInOut(t);

        Object.entries(targetExpressions).forEach(([name, targetValue]) => {
          const startValue = startExpressions[name] || 0;
          const currentValue = startValue + (targetValue - startValue) * easedT;
          vrm.expressionManager!.setValue(name, currentValue);
        });

        vrm.expressionManager!.update();

        if (t < 1) {
          this.expressionTransitionId = requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      if (this.expressionTransitionId) {
        cancelAnimationFrame(this.expressionTransitionId);
      }
      animate();
    });
  }

  // -------------------------------------------------------------------------
  // GESTURE CONTROL
  // -------------------------------------------------------------------------

  /**
   * Perform a gesture animation
   * Uses keyframe interpolation with proper easing following CharacterStudio patterns
   */
  async performGesture(gesture: GestureType, intensity = 1.0): Promise<void> {
    const vrm = avatarManager.getVRM();
    if (!vrm?.humanoid) {
      console.warn(`[AvatarController] No VRM loaded, cannot perform gesture: ${gesture}`);
      return;
    }

    const gestureData = GESTURE_LIBRARY[gesture];
    if (!gestureData) {
      console.warn(`[AvatarController] Unknown gesture: ${gesture}`);
      return;
    }

    // Don't interrupt ongoing gestures
    if (this.state.isAnimating && this.state.currentGesture) {
      console.log(`[AvatarController] Gesture ${this.state.currentGesture} in progress, queuing ${gesture}`);
      // Wait for current gesture to finish
      await new Promise(resolve => setTimeout(resolve, 100));
      if (this.state.isAnimating) return;
    }

    this.state.isAnimating = true;
    this.state.currentGesture = gesture;
    console.log(`[AvatarController] Starting gesture: ${gesture} (intensity: ${intensity})`);

    const duration = gestureData.duration * 1000; // Convert to ms
    const startTime = performance.now();

    // Store initial bone states for blending
    const initialStates = new Map<string, THREE.Quaternion>();
    
    // Collect all bones used in this gesture
    const allBoneNames = new Set<string>();
    gestureData.keyframes.forEach(kf => {
      Object.keys(kf.bones || {}).forEach(b => allBoneNames.add(b));
    });

    // Capture initial states
    allBoneNames.forEach(boneName => {
      const boneNode = getBoneNode(vrm, boneName as VRMHumanBoneName);
      if (boneNode) {
        initialStates.set(boneName, boneNode.quaternion.clone());
      }
    });
    
    return new Promise(resolve => {
      const animate = () => {
        const elapsed = performance.now() - startTime;
        const normalizedTime = Math.min(elapsed / duration, 1);

        if (avatarManager.isInteracting() || avatarManager.isManualPosingEnabled()) {
           if (normalizedTime < 1) {
             requestAnimationFrame(animate);
           } else {
             this.state.isAnimating = false;
             this.state.currentGesture = null;
             resolve();
           }
           return;
        }

        // Find the two keyframes we're between
        const keyframes = gestureData.keyframes;
        let prevKeyframe = keyframes[0];
        let nextKeyframe = keyframes[keyframes.length - 1];
        
        for (let i = 0; i < keyframes.length - 1; i++) {
          if (normalizedTime >= keyframes[i].time && normalizedTime <= keyframes[i + 1].time) {
            prevKeyframe = keyframes[i];
            nextKeyframe = keyframes[i + 1];
            break;
          }
        }

        // Calculate interpolation factor between keyframes
        const keyframeDuration = nextKeyframe.time - prevKeyframe.time;
        const keyframeProgress = keyframeDuration > 0 
          ? (normalizedTime - prevKeyframe.time) / keyframeDuration 
          : 1;

        // Apply easing for natural motion
        const easingFn = nextKeyframe.easing ? Easing[nextKeyframe.easing] : Easing.easeInOut;
        const easedProgress = easingFn(keyframeProgress);

        // Apply bone rotations using SLERP interpolation
        allBoneNames.forEach(boneName => {
          const boneNode = getBoneNode(vrm, boneName as VRMHumanBoneName);
          if (!boneNode) return;

          const prevRot = prevKeyframe.bones?.[boneName as VRMHumanBoneName] || { x: 0, y: 0, z: 0 };
          const nextRot = nextKeyframe.bones?.[boneName as VRMHumanBoneName] || { x: 0, y: 0, z: 0 };

          // Use SLERP for smooth quaternion interpolation
          slerpBoneRotation(boneNode, prevRot, nextRot, easedProgress, intensity);
        });

        // Update VRM (following CharacterStudio pattern)
        vrm.humanoid!.update();
        vrm.update(0);

        if (normalizedTime < 1) {
          requestAnimationFrame(animate);
        } else {
          this.state.isAnimating = false;
          this.state.currentGesture = null;
          console.log(`[AvatarController] Gesture complete: ${gesture}`);
          
          // Naturally revert to neutral pose after gesture
          // Using smooth transition to 'idle-neutral'
          setTimeout(() => {
            if (!this.state.isAnimating && !this.state.isSpeaking) {
              console.log('[AvatarController] Reverting to neutral idle');
              this.applyPose('idle-neutral', true);
            }
          }, 500);
          
          resolve();
        }
      };

      animate();
    });
  }

  // -------------------------------------------------------------------------
  // POSE CONTROL
  // -------------------------------------------------------------------------

  /**
   * Apply a preset pose
   */
  async applyPose(poseId: PoseId, animated = true): Promise<void> {
    try {
      const rotationLocked = useSceneSettingsStore.getState().rotationLocked;
      await avatarManager.applyPose(poseId, rotationLocked, animated, animated ? 'loop' : 'static');
    } catch (e) {
      console.error(`[AvatarController] Failed to apply pose: ${poseId}`, e);
    }
  }

  /**
   * Apply a custom pose from bone rotations
   */
  async applyCustomPose(
    boneRotations: Partial<Record<VRMHumanBoneName, { x: number; y: number; z: number }>>,
    _transitionDuration = 0.5
  ): Promise<void> {
    const vrm = avatarManager.getVRM();
    if (!vrm?.humanoid) return;

    // Build VRMPose from bone rotations
    const pose: VRMPose = {};
    Object.entries(boneRotations).forEach(([boneName, rotation]) => {
      const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(rotation.x),
        THREE.MathUtils.degToRad(rotation.y),
        THREE.MathUtils.degToRad(rotation.z),
        'XYZ'
      );
      const quat = new THREE.Quaternion().setFromEuler(euler);
      pose[boneName as VRMHumanBoneName] = { rotation: [quat.x, quat.y, quat.z, quat.w] };
    });

    // Apply with smooth transition
    const rotationLocked = useSceneSettingsStore.getState().rotationLocked;
    await avatarManager.applyRawPose({ vrmPose: pose }, rotationLocked, 'static');
  }

  // -------------------------------------------------------------------------
  // IDLE ANIMATION
  // -------------------------------------------------------------------------

  /**
   * Start subtle idle animation (breathing, micro-movements)
   */
  startIdleAnimation(): void {
    if (this.idleAnimationId) return;

    const vrm = avatarManager.getVRM();
    if (!vrm?.humanoid) return;

    let time = 0;
    const breathFrequency = 0.15; // breaths per second
    const swayFrequency = 0.05;   // sway cycles per second

    const animate = () => {
      if (!this.breathingEnabled || this.state.isAnimating || avatarManager.isManualPosingEnabled()) {
        this.idleAnimationId = requestAnimationFrame(animate);
        return;
      }

      time += 0.016; // ~60fps

      // Breathing
      const breathPhase = Easing.breath(time * breathFrequency);
      const breathAmount = breathPhase * 2; // degrees

      // Apply breathing to spine/chest
      const spine = vrm.humanoid!.getNormalizedBoneNode('spine' as VRMHumanBoneName);
      const chest = vrm.humanoid!.getNormalizedBoneNode('chest' as VRMHumanBoneName);
      
      if (spine) {
        const euler = new THREE.Euler(THREE.MathUtils.degToRad(breathAmount * 0.5), 0, 0, 'XYZ');
        spine.quaternion.setFromEuler(euler);
      }
      if (chest) {
        const euler = new THREE.Euler(THREE.MathUtils.degToRad(breathAmount), 0, 0, 'XYZ');
        chest.quaternion.setFromEuler(euler);
      }

      // Subtle weight shift
      const swayPhase = Easing.sway(time * swayFrequency);
      const hips = vrm.humanoid!.getNormalizedBoneNode('hips' as VRMHumanBoneName);
      if (hips) {
        const euler = new THREE.Euler(0, THREE.MathUtils.degToRad(swayPhase * 0.5), THREE.MathUtils.degToRad(swayPhase * 1), 'XYZ');
        hips.quaternion.setFromEuler(euler);
      }

      this.idleAnimationId = requestAnimationFrame(animate);
    };

    animate();
  }

  /**
   * Stop idle animation
   */
  stopIdleAnimation(): void {
    if (this.idleAnimationId) {
      cancelAnimationFrame(this.idleAnimationId);
      this.idleAnimationId = null;
    }
  }

  // -------------------------------------------------------------------------
  // SPEAKING ANIMATION
  // -------------------------------------------------------------------------

  /**
   * Trigger speaking visual feedback
   */
  startSpeaking(): void {
    if (this.state.isSpeaking) return;
    this.state.isSpeaking = true;
    
    // Add subtle head movements and mouth animation while speaking
    const vrm = avatarManager.getVRM();
    if (!vrm) return;

    let time = 0;
    const speakingLoop = () => {
      if (!this.state.isSpeaking || avatarManager.isInteracting() || avatarManager.isManualPosingEnabled()) {
        // Ensure mouth is closed when stopping or overridden
        if (!this.state.isSpeaking && vrm.expressionManager) {
          vrm.expressionManager.setValue('Aa', 0);
          vrm.expressionManager.update();
        }
        if (this.state.isSpeaking) requestAnimationFrame(speakingLoop);
        return;
      }

      time += 0.016;
      
      // 1. Procedural Mouth Movement (Lip-sync simulation)
      if (vrm.expressionManager) {
        // Create natural mouth opening/closing oscillation
        // Using multiple sine waves for more irregular/natural movement
        const mouthOpen = 
          Math.sin(time * 10) * 0.3 + 
          Math.sin(time * 25) * 0.2 + 
          0.5;
        
        vrm.expressionManager.setValue('Aa', Math.max(0, Math.min(1, mouthOpen)));
      }

      // 2. Subtle Head Movements
      if (vrm.humanoid) {
        const head = vrm.humanoid.getNormalizedBoneNode('head' as VRMHumanBoneName);
        if (head) {
          // Subtle nodding and tilting while speaking
          const nodAmount = Math.sin(time * 3) * 2;
          const tiltAmount = Math.sin(time * 1.5) * 1;
          const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(nodAmount),
            THREE.MathUtils.degToRad(tiltAmount),
            0,
            'XYZ'
          );
          head.quaternion.setFromEuler(euler);
        }
      }

      vrm.update(0.016);

      requestAnimationFrame(speakingLoop);
    };

    speakingLoop();
  }

  /**
   * Stop speaking animation
   */
  stopSpeaking(): void {
    this.state.isSpeaking = false;
  }

  // -------------------------------------------------------------------------
  // COMPOUND ACTIONS (for AI)
  // -------------------------------------------------------------------------

  /**
   * Execute a compound action that combines gesture + expression
   */
  async executeAction(action: ActionCommand): Promise<void> {
    console.log(`[AvatarController] Executing action:`, action);

    switch (action.type) {
      case 'gesture':
        await this.performGesture(action.value as GestureType, action.intensity ?? 1.0);
        break;
      
      case 'expression':
        await this.setEmotion(action.value as EmotionState, action.duration ?? 0.5);
        break;
      
      case 'pose':
        await this.applyPose(action.value as PoseId, action.blend ?? true);
        break;
      
      case 'speak':
        this.startSpeaking();
        break;
      
      case 'idle':
        this.startIdleAnimation();
        break;
      
      default:
        console.warn(`[AvatarController] Unknown action type: ${action.type}`);
    }
  }

  /**
   * Execute multiple actions in sequence
   */
  async executeSequence(actions: ActionCommand[]): Promise<void> {
    for (const action of actions) {
      await this.executeAction(action);
    }
  }

  /**
   * React naturally to a situation (AI helper)
   */
  async react(situation: string): Promise<void> {
    // Map common situations to actions
    const reactions: Record<string, ActionCommand[]> = {
      greeting: [
        { type: 'expression', value: 'happy' },
        { type: 'gesture', value: 'wave' },
      ],
      agreement: [
        { type: 'expression', value: 'happy' },
        { type: 'gesture', value: 'nod' },
      ],
      disagreement: [
        { type: 'expression', value: 'thinking' },
        { type: 'gesture', value: 'shake' },
      ],
      confusion: [
        { type: 'expression', value: 'surprised' },
        { type: 'gesture', value: 'shrug' },
      ],
      excitement: [
        { type: 'expression', value: 'excited' },
        { type: 'gesture', value: 'celebrate' },
      ],
      thinking: [
        { type: 'expression', value: 'thinking' },
        { type: 'gesture', value: 'think' },
      ],
      listening: [
        { type: 'expression', value: 'neutral' },
        { type: 'gesture', value: 'listen' },
      ],
      acknowledgment: [
        { type: 'expression', value: 'happy' },
        { type: 'gesture', value: 'acknowledge' },
      ],
      success: [
        { type: 'expression', value: 'excited' },
        { type: 'gesture', value: 'thumbsUp' },
      ],
      respect: [
        { type: 'expression', value: 'neutral' },
        { type: 'gesture', value: 'bow' },
      ],
    };

    const actionSequence = reactions[situation.toLowerCase()];
    if (actionSequence) {
      await this.executeSequence(actionSequence);
    } else {
      console.warn(`[AvatarController] Unknown situation: ${situation}`);
    }
  }

  // -------------------------------------------------------------------------
  // CLEANUP
  // -------------------------------------------------------------------------

  cleanup(): void {
    this.stopIdleAnimation();
    if (this.expressionTransitionId) {
      cancelAnimationFrame(this.expressionTransitionId);
    }
    this.state.isSpeaking = false;
    this.state.isAnimating = false;
  }
}

// Export singleton
export const avatarController = new AvatarController();

// Export types and constants for AI use
export { GESTURE_LIBRARY, EXPRESSION_PRESETS, Easing };
export type { EmotionState, GestureType };
