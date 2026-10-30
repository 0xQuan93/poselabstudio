import { isArkitFaceBridgeEnabled } from './faceCaptureCapabilities';
import { ARKIT_FACE_DEFAULT_URL, parseArkitFaceMessage, type ArkitFaceFrameMessage } from './arkitFaceProtocol';
import { assertLanWebSocketUrl } from './lanWebSocket';

export type ArkitFaceBridgeStatus = 'off' | 'connecting' | 'connected' | 'error';

type FrameListener = (frame: ArkitFaceFrameMessage) => void;
type StatusListener = (status: ArkitFaceBridgeStatus, error: string | null) => void;

/**
 * Browser client for the optional local ARKit FaceTracking companion.
 * Feature-flagged off. Connects only to LAN WebSocket URLs. Never uploads.
 */
export class ArkitFaceBridge {
  private socket: WebSocket | null = null;
  private status: ArkitFaceBridgeStatus = 'off';
  private error: string | null = null;
  private url = ARKIT_FACE_DEFAULT_URL;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;

  isEnabled() {
    return isArkitFaceBridgeEnabled();
  }

  getStatus() {
    return this.status;
  }

  getError() {
    return this.error;
  }

  getUrl() {
    return this.url;
  }

  subscribe(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status, this.error);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onFrame(listener: FrameListener) {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  async connect(url = this.url) {
    if (!this.isEnabled()) {
      throw new Error('ARKit companion is off. Set VITE_ENABLE_ARKIT_FACE_BRIDGE=true in a local .env and restart Vite.');
    }

    const parsed = assertLanWebSocketUrl(url);
    this.disconnect();
    this.url = parsed.toString();
    this.shouldReconnect = true;
    this.setStatus('connecting', null);

    try {
      this.socket = new WebSocket(this.url);
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : 'Failed to open WebSocket');
      throw error;
    }

    this.socket.addEventListener('open', () => {
      this.setStatus('connected', null);
    });
    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseArkitFaceMessage(event.data);
      if (!message || message.type !== 'arkit-face-frame') return;
      this.frameListeners.forEach((listener) => listener(message));
    });
    this.socket.addEventListener('close', () => {
      this.socket = null;
      if (this.shouldReconnect && this.status !== 'off') {
        this.setStatus('connecting', 'Companion disconnected. Retrying on LAN…');
        this.scheduleReconnect();
      } else if (this.status !== 'off') {
        this.setStatus('off', null);
      }
    });
    this.socket.addEventListener('error', () => {
      this.setStatus('error', 'Companion WebSocket error. Check the iPhone is on the same LAN.');
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('off', null);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        void this.connect(this.url).catch(() => {
          this.scheduleReconnect();
        });
      }
    }, 1500);
  }

  private setStatus(status: ArkitFaceBridgeStatus, error: string | null) {
    this.status = status;
    this.error = error;
    this.statusListeners.forEach((listener) => listener(status, error));
  }
}

export const arkitFaceBridge = new ArkitFaceBridge();
