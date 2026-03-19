import * as THREE from 'three';
import { sceneManager } from './sceneManager';

/**
 * VR Manager
 * 
 * Handles WebXR sessions and camera syncing for PoseLab.
 * Adapted from Hyperfy's XR system.
 */
class VRManager {
  private session: XRSession | null = null;
  private isVRSupported: boolean = false;
  private renderer: THREE.WebGLRenderer | null = null;

  constructor() {
    this.checkSupport();
  }

  private async checkSupport() {
    if (navigator.xr) {
      this.isVRSupported = await navigator.xr.isSessionSupported('immersive-vr');
      console.log(`[VRManager] VR Support: ${this.isVRSupported}`);
    }
  }

  public async enterVR() {
    if (!this.isVRSupported || !navigator.xr) {
      throw new Error('VR is not supported on this device/browser');
    }

    this.renderer = (sceneManager.getRenderer() as THREE.WebGLRenderer) || null;
    if (!this.renderer) {
      throw new Error('Renderer not initialized');
    }

    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
      });

      this.session = session;
      this.renderer.xr.setSession(session);
      
      session.addEventListener('end', () => {
        this.session = null;
        console.log('[VRManager] VR Session ended');
      });

      console.log('[VRManager] VR Session started');
    } catch (error) {
      console.error('[VRManager] Failed to enter VR:', error);
      throw error;
    }
  }

  public async exitVR() {
    if (this.session) {
      await this.session.end();
      this.session = null;
    }
  }

  public isSupported(): boolean {
    return this.isVRSupported;
  }

  public isInVR(): boolean {
    return this.session !== null;
  }
}

export const vrManager = new VRManager();
