import { sceneManager } from './sceneManager';
import { avatarManager } from './avatarManager';
import type { DirectorScript } from '../types/director';
import { useToastStore } from '../state/useToastStore';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';    
import { ActionParser } from '../ai/utils/ActionParser';
class DirectorManager {
  private isPlaying = false;
  private currentScript: DirectorScript | null = null;
  private currentShotIndex = 0;
  private tickDispose?: () => void;
  private shotTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Play a director script
   */
  async playScript(script: DirectorScript): Promise<void> {
    if (this.isPlaying) {
      this.stop();
    }

    const vrm = avatarManager.getVRM();
    if (!vrm) {
      useToastStore.getState().addToast('Please load an avatar first', 'error');
      return;
    }

    console.log(`[Director] Starting script: ${script.title}`);
    this.isPlaying = true;
    this.currentScript = script;
    this.currentShotIndex = -1; // Start at -1, nextShot will advance to 0

    this.nextShot();
  }

  /**
   * Stop playback
   */
  stop() {
    if (!this.isPlaying) return;
    
    console.log('[Director] Stopping playback');
    this.isPlaying = false;
    if (this.shotTimeout) clearTimeout(this.shotTimeout);
    this.tickDispose?.();
    this.tickDispose = undefined;
    this.currentScript = null;
    
    // Reset camera and follow mode
    sceneManager.setFollowTarget(null, null);
    sceneManager.resetCamera();
  }

  private async nextShot() {
    if (!this.currentScript) {
      this.stop();
      return;
    }
    
    this.currentShotIndex++;
    if (this.currentShotIndex >= this.currentScript.shots.length) {
      this.stop();
      return;
    }

    const shot = this.currentScript.shots[this.currentShotIndex];
    console.log(`[Director] Shot ${this.currentShotIndex + 1}: ${shot.name} (${shot.duration}s)`);

    // 1. Apply Pose & Expression
    const rotationLocked = useSceneSettingsStore.getState().rotationLocked;
    
    // Determine transition duration
    let transitionDuration = 0.4;
    switch (shot.transition) {
      case 'cut': transitionDuration = 0; break;
      case 'smooth': transitionDuration = 0.5; break;
      case 'fade': transitionDuration = 1.0; break;
    }

    await avatarManager.applyPose(
      shot.poseId, 
      rotationLocked, 
      shot.animated ?? true, 
      'loop', 
      shot.rootMotion ?? false,
      transitionDuration
    );
    avatarManager.applyExpression(shot.expressionId);

    // 2. Apply Background
    if ((shot.backgroundId as string) === 'custom') {
      const { customBackgroundUrl, customBackgroundData, customBackgroundType } = useSceneSettingsStore.getState();
      const bgUrl = customBackgroundUrl || (customBackgroundData ? `data:${customBackgroundType || 'image/png'};base64,${customBackgroundData}` : null);
      if (bgUrl) {
        await sceneManager.setBackground(bgUrl, true);
      } else {
        // Fallback if custom background is specified but no data is found
        await sceneManager.setBackground('midnight-circuit', true); 
      }
    } else {
      await sceneManager.setBackground(shot.backgroundId, true); // Force background change
    }

    // 3. Set Camera
    // Use sceneManager's presets for consistent framing
    // sceneManager now handles all presets including animations
    sceneManager.setCameraPreset(shot.cameraPreset, false, transitionDuration);
    
    // 4. Execute Arbitrary Actions (Lighting, Music, etc.)
    if (shot.actions && shot.actions.length > 0) {
        shot.actions!.forEach(action => {
          console.log(`[Director] Executing action: ${action}`);
          // Pass empty speak function as we don't want TTS during script execution unless specified
          ActionParser.execute(action, () => {}); 
        });
    }

    // 5. Schedule next shot
    this.shotTimeout = setTimeout(() => {
      this.nextShot();
    }, shot.duration * 1000);
  }
}

export const directorManager = new DirectorManager();
