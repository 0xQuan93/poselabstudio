import * as THREE from 'three';
import { sceneManager } from '../three/sceneManager';

export class WebXRManager {
  private currentSession: XRSession | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private originalRendererXrEnabled: boolean | null = null;

  constructor() {
    // We'll get the renderer lazily when starting
  }

  async isSupported(): Promise<boolean> {
    if (!navigator.xr) return false;
    return navigator.xr.isSessionSupported('immersive-ar');
  }

  async startAR() {
    if (!navigator.xr) {
      throw new Error("WebXR not supported in this browser");
    }

    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) {
      throw new Error("Immersive AR not supported on this device");
    }

    if (this.currentSession) {
      console.warn("AR Session already active");
      return;
    }

    const renderer = sceneManager.getRenderer();
    if (!renderer) {
      throw new Error("Renderer not initialized");
    }
    this.renderer = renderer;

    try {
      // Enable XR on renderer
      this.originalRendererXrEnabled = this.renderer.xr.enabled;
      this.renderer.xr.enabled = true;

      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        optionalFeatures: ['light-estimation'],
        domOverlay: { root: document.body } // Use body as overlay root
      });

      this.currentSession = session;
      this.renderer.xr.setSession(session);

      // Handle session end
      session.addEventListener('end', this.onSessionEnd);
      
      console.log("[WebXRManager] AR Session started");
    } catch (e) {
      console.error("[WebXRManager] Failed to start AR session", e);
      throw e;
    }
  }

  private onSessionEnd = () => {
    console.log("[WebXRManager] AR Session ended");
    this.currentSession = null;
    if (this.renderer) {
      this.renderer.xr.enabled = this.originalRendererXrEnabled ?? false;
    }
    this.originalRendererXrEnabled = null;
  };

  async stopAR() {
    if (this.currentSession) {
      await this.currentSession.end();
    }
  }

  isActive() {
    return !!this.currentSession;
  }
}

export const webXRManager = new WebXRManager();
