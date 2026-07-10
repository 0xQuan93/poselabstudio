import * as THREE from 'three';
import { sceneManager } from '../three/sceneManager';

type WebXRSessionState = {
  isActive: boolean;
  isStarting: boolean;
  visibilityState: XRVisibilityState | null;
};

type WebXRSessionStateListener = (state: WebXRSessionState) => void;
type WebXRSessionEndListener = () => void;

export class WebXRManager {
  private currentSession: XRSession | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private originalRendererXrEnabled: boolean | null = null;
  private isStartingSession = false;
  private stateListeners = new Set<WebXRSessionStateListener>();
  private sessionEndListeners = new Set<WebXRSessionEndListener>();

  constructor() {
    // We'll get the renderer lazily when starting
  }

  async isSupported(): Promise<boolean> {
    if (!navigator.xr) return false;
    if (!window.isSecureContext && window.location.hostname !== 'localhost') return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  }

  getState(): WebXRSessionState {
    return {
      isActive: !!this.currentSession,
      isStarting: this.isStartingSession,
      visibilityState: this.currentSession?.visibilityState ?? null,
    };
  }

  subscribe(listener: WebXRSessionStateListener) {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  subscribeSessionEnd(listener: WebXRSessionEndListener) {
    this.sessionEndListeners.add(listener);
    return () => {
      this.sessionEndListeners.delete(listener);
    };
  }

  private notifyState() {
    const state = this.getState();
    this.stateListeners.forEach((listener) => listener(state));
  }

  private notifySessionEnd() {
    this.sessionEndListeners.forEach((listener) => listener());
  }

  private restoreRendererXrEnabled() {
    if (this.renderer && this.originalRendererXrEnabled !== null) {
      this.renderer.xr.enabled = this.originalRendererXrEnabled;
    }
    this.originalRendererXrEnabled = null;
  }

  async startAR() {
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      throw new Error("AR requires a secure HTTPS connection");
    }
    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      throw new Error("Keep this page visible and focused, then try AR again");
    }
    if (!navigator.xr) {
      throw new Error("This browser does not support WebXR. Try Chrome on a compatible Android device");
    }

    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) {
      throw new Error("Immersive AR not supported on this device");
    }

    if (this.currentSession) {
      console.warn("AR Session already active");
      return;
    }

    if (this.isStartingSession) {
      console.warn("AR Session is already starting");
      return;
    }

    const renderer = sceneManager.getRenderer();
    if (!renderer) {
      throw new Error("Renderer not initialized");
    }
    this.renderer = renderer;
    this.isStartingSession = true;
    this.notifyState();

    let requestedSession: XRSession | null = null;
    try {
      // Enable XR on renderer
      this.originalRendererXrEnabled = this.renderer.xr.enabled;
      this.renderer.xr.enabled = true;

      requestedSession = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['hit-test', 'dom-overlay', 'light-estimation'],
        domOverlay: { root: document.body } // Use body as overlay root
      });

      this.currentSession = requestedSession;
      requestedSession.addEventListener('end', this.onSessionEnd);
      requestedSession.addEventListener('visibilitychange', this.onVisibilityChange);
      await this.renderer.xr.setSession(requestedSession);

      console.log("[WebXRManager] AR Session started");
    } catch (e) {
      if (requestedSession) {
        requestedSession.removeEventListener('end', this.onSessionEnd);
        requestedSession.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.currentSession === requestedSession) {
          this.currentSession = null;
        }
        try {
          await requestedSession.end();
        } catch {
          // The session may already be ending after a failed renderer bind.
        }
      } else {
        this.currentSession = null;
      }
      this.restoreRendererXrEnabled();
      console.error("[WebXRManager] Failed to start AR session", e);
      if (e instanceof DOMException) {
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
          throw new Error("AR access was blocked. Allow motion/camera access and keep the page focused", { cause: e });
        }
        if (e.name === 'NotSupportedError') {
          throw new Error("Immersive AR is not available on this browser or device", { cause: e });
        }
        if (e.name === 'InvalidStateError') {
          throw new Error("AR could not start because the page is not active. Return to the page and try again", { cause: e });
        }
      }
      throw e;
    } finally {
      this.isStartingSession = false;
      this.notifyState();
    }
  }

  private onSessionEnd = (event: Event) => {
    const session = event.target as XRSession | null;
    const wasCurrentSession = !session || session === this.currentSession;
    session?.removeEventListener('end', this.onSessionEnd);
    session?.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (!wasCurrentSession) return;

    console.log("[WebXRManager] AR Session ended");
    this.currentSession = null;
    this.restoreRendererXrEnabled();
    this.notifySessionEnd();
    this.notifyState();
  };

  private onVisibilityChange = () => {
    // The UA can temporarily blur or hide an immersive session (for example,
    // when a system prompt appears). Surface that state instead of treating it
    // as a session failure.
    this.notifyState();
  };

  async stopAR() {
    if (this.currentSession) {
      await this.currentSession.end();
    }
  }

  isActive() {
    return !!this.currentSession;
  }

  isStarting() {
    return this.isStartingSession;
  }
}

export const webXRManager = new WebXRManager();
