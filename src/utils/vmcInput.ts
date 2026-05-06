import { VRMHumanBoneName } from '@pixiv/three-vrm';
import * as THREE from 'three';
import type { MotionCaptureManager } from './motionCapture';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ========================
// VMC Frame Buffer for Jitter Reduction
// ========================

interface VMCBoneFrame {
  rotation: THREE.Quaternion;
  timestamp: number;
}

interface VMCRootFrame {
  position: THREE.Vector3;
  timestamp: number;
}

interface VMCExpressionFrame {
  value: number;
  timestamp: number;
}

/**
 * VMC Frame Buffer - Buffers incoming VMC data and provides interpolated values
 * to smooth out timing inconsistencies between VMC sender and render loop.
 */
class VMCFrameBuffer {
  // Bone rotation buffer: stores last 3 frames for better interpolation
  private boneFrames: Map<string, { 
    frames: VMCBoneFrame[]; 
    smoothed: THREE.Quaternion | null;
  }> = new Map();
  
  // Root position buffer
  private rootFrames: { 
    frames: VMCRootFrame[]; 
    smoothed: THREE.Vector3 | null;
  } = { frames: [], smoothed: null };
  
  // Expression buffer
  private expressionFrames: Map<string, { 
    frames: VMCExpressionFrame[]; 
    smoothed: number | null;
  }> = new Map();
  
  // Configuration - tuned for maximum smoothness
  private readonly MAX_BUFFER_SIZE = 4; // Buffer 4 frames for better interpolation
  private readonly INTERPOLATION_DELAY_MS = 50; // ~3 frames at 60fps for more smoothing
  private readonly EXPONENTIAL_SMOOTH_FACTOR = 0.15; // Very smooth exponential blending (lower = smoother)
  
  // Temporary quaternion for SLERP operations
  private tempQuat = new THREE.Quaternion();
  
  /**
   * Push a new bone rotation into the buffer
   */
  pushBoneRotation(boneName: string, rotation: THREE.Quaternion, timestamp: number = performance.now()) {
    let buffer = this.boneFrames.get(boneName);
    if (!buffer) {
      buffer = { frames: [], smoothed: null };
      this.boneFrames.set(boneName, buffer);
    }
    
    // Handle quaternion double-cover: ensure new rotation is on same hemisphere as previous
    if (buffer.frames.length > 0) {
      const lastRot = buffer.frames[buffer.frames.length - 1].rotation;
      if (lastRot.dot(rotation) < 0) {
        rotation = rotation.clone();
        rotation.x = -rotation.x;
        rotation.y = -rotation.y;
        rotation.z = -rotation.z;
        rotation.w = -rotation.w;
      }
    }
    
    // Add to buffer, maintaining max size
    buffer.frames.push({ rotation: rotation.clone(), timestamp });
    while (buffer.frames.length > this.MAX_BUFFER_SIZE) {
      buffer.frames.shift();
    }
  }
  
  /**
   * Push a new root position into the buffer
   */
  pushRootPosition(position: THREE.Vector3, timestamp: number = performance.now()) {
    this.rootFrames.frames.push({ position: position.clone(), timestamp });
    while (this.rootFrames.frames.length > this.MAX_BUFFER_SIZE) {
      this.rootFrames.frames.shift();
    }
  }
  
  /**
   * Push a new expression value into the buffer
   */
  pushExpression(name: string, value: number, timestamp: number = performance.now()) {
    let buffer = this.expressionFrames.get(name);
    if (!buffer) {
      buffer = { frames: [], smoothed: null };
      this.expressionFrames.set(name, buffer);
    }
    
    buffer.frames.push({ value, timestamp });
    while (buffer.frames.length > this.MAX_BUFFER_SIZE) {
      buffer.frames.shift();
    }
  }
  
  /**
   * Get interpolated bone rotation using SLERP with exponential smoothing
   * Returns the smoothed quaternion between buffered frames
   */
  getInterpolatedBoneRotation(boneName: string, renderTime: number = performance.now()): THREE.Quaternion | null {
    const buffer = this.boneFrames.get(boneName);
    if (!buffer || buffer.frames.length === 0) return null;
    
    const frames = buffer.frames;
    
    // If only one frame, return it
    if (frames.length === 1) {
      if (!buffer.smoothed) {
        buffer.smoothed = frames[0].rotation.clone();
      }
      return buffer.smoothed.clone();
    }
    
    // Find the two frames to interpolate between based on delayed time
    const targetTime = renderTime - this.INTERPOLATION_DELAY_MS;
    
    // Find frame pair for interpolation
    let prevFrame = frames[0];
    let nextFrame = frames[frames.length - 1];
    
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i].timestamp <= targetTime && frames[i + 1].timestamp >= targetTime) {
        prevFrame = frames[i];
        nextFrame = frames[i + 1];
        break;
      }
    }
    
    // Calculate interpolation factor
    const frameDelta = nextFrame.timestamp - prevFrame.timestamp;
    let t = 0.5; // Default to middle if timestamps are same
    if (frameDelta > 0) {
      t = Math.max(0, Math.min(1, (targetTime - prevFrame.timestamp) / frameDelta));
    }
    
    // SLERP between frames
    this.tempQuat.copy(prevFrame.rotation).slerp(nextFrame.rotation, t);
    
    // Apply additional exponential smoothing for micro-jitter reduction
    if (buffer.smoothed) {
      // Ensure quaternions are on same hemisphere for smooth interpolation
      if (buffer.smoothed.dot(this.tempQuat) < 0) {
        this.tempQuat.x = -this.tempQuat.x;
        this.tempQuat.y = -this.tempQuat.y;
        this.tempQuat.z = -this.tempQuat.z;
        this.tempQuat.w = -this.tempQuat.w;
      }
      buffer.smoothed.slerp(this.tempQuat, this.EXPONENTIAL_SMOOTH_FACTOR);
    } else {
      buffer.smoothed = this.tempQuat.clone();
    }
    
    return buffer.smoothed.clone();
  }
  
  /**
   * Get interpolated root position using linear interpolation with exponential smoothing
   */
  getInterpolatedRootPosition(renderTime: number = performance.now()): THREE.Vector3 | null {
    const frames = this.rootFrames.frames;
    if (frames.length === 0) return null;
    
    if (frames.length === 1) {
      if (!this.rootFrames.smoothed) {
        this.rootFrames.smoothed = frames[0].position.clone();
      }
      return this.rootFrames.smoothed.clone();
    }
    
    const targetTime = renderTime - this.INTERPOLATION_DELAY_MS;
    
    // Find frame pair
    let prevFrame = frames[0];
    let nextFrame = frames[frames.length - 1];
    
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i].timestamp <= targetTime && frames[i + 1].timestamp >= targetTime) {
        prevFrame = frames[i];
        nextFrame = frames[i + 1];
        break;
      }
    }
    
    const frameDelta = nextFrame.timestamp - prevFrame.timestamp;
    let t = 0.5;
    if (frameDelta > 0) {
      t = Math.max(0, Math.min(1, (targetTime - prevFrame.timestamp) / frameDelta));
    }
    
    const interpolated = new THREE.Vector3().lerpVectors(prevFrame.position, nextFrame.position, t);
    
    // Apply exponential smoothing
    if (this.rootFrames.smoothed) {
      this.rootFrames.smoothed.lerp(interpolated, this.EXPONENTIAL_SMOOTH_FACTOR);
    } else {
      this.rootFrames.smoothed = interpolated.clone();
    }
    
    return this.rootFrames.smoothed.clone();
  }
  
  /**
   * Get interpolated expression value using linear interpolation with exponential smoothing
   */
  getInterpolatedExpression(name: string, renderTime: number = performance.now()): number | null {
    const buffer = this.expressionFrames.get(name);
    if (!buffer || buffer.frames.length === 0) return null;
    
    const frames = buffer.frames;
    
    if (frames.length === 1) {
      if (buffer.smoothed === null) {
        buffer.smoothed = frames[0].value;
      }
      return buffer.smoothed;
    }
    
    const targetTime = renderTime - this.INTERPOLATION_DELAY_MS;
    
    let prevFrame = frames[0];
    let nextFrame = frames[frames.length - 1];
    
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i].timestamp <= targetTime && frames[i + 1].timestamp >= targetTime) {
        prevFrame = frames[i];
        nextFrame = frames[i + 1];
        break;
      }
    }
    
    const frameDelta = nextFrame.timestamp - prevFrame.timestamp;
    let t = 0.5;
    if (frameDelta > 0) {
      t = Math.max(0, Math.min(1, (targetTime - prevFrame.timestamp) / frameDelta));
    }
    
    const interpolated = prevFrame.value + (nextFrame.value - prevFrame.value) * t;
    
    // Apply exponential smoothing
    if (buffer.smoothed !== null) {
      buffer.smoothed = buffer.smoothed + (interpolated - buffer.smoothed) * this.EXPONENTIAL_SMOOTH_FACTOR;
    } else {
      buffer.smoothed = interpolated;
    }
    
    return buffer.smoothed;
  }
  
  /**
   * Get all buffered bone names
   */
  getBufferedBoneNames(): string[] {
    return Array.from(this.boneFrames.keys());
  }
  
  /**
   * Get all buffered expression names
   */
  getBufferedExpressionNames(): string[] {
    return Array.from(this.expressionFrames.keys());
  }
  
  /**
   * Check if root position is buffered
   */
  hasRootPosition(): boolean {
    return this.rootFrames.frames.length > 0;
  }
  
  /**
   * Clear all buffers
   */
  clear() {
    this.boneFrames.clear();
    this.rootFrames = { frames: [], smoothed: null };
    this.expressionFrames.clear();
  }
}

// Export singleton buffer instance
export const vmcFrameBuffer = new VMCFrameBuffer();

type OscArgument = { type?: string; value: number | string };

type OscMessage = {
  address: string;
  args?: Array<OscArgument | number | string>;
};

type VmcPayload = OscMessage | OscMessage[];

const VMC_BONE_ADDRESS = '/VMC/Ext/Bone/Pos';
const VMC_ROOT_ADDRESS = '/VMC/Ext/Root/Pos';
const VMC_BLEND_ADDRESS = '/VMC/Ext/Blend/Val';
const VMC_BLEND_APPLY = '/VMC/Ext/Blend/Apply';

const VRM_BONE_NAMES = new Set(Object.values(VRMHumanBoneName));

const toVrmBoneName = (name: string): VRMHumanBoneName | null => {
  const candidate = `${name.charAt(0).toLowerCase()}${name.slice(1)}` as VRMHumanBoneName;
  if (VRM_BONE_NAMES.has(candidate)) {
    return candidate;
  }
  return null;
};

const normalizeArgs = (args?: Array<OscArgument | number | string>): Array<number | string> => {
  if (!args) return [];
  return args.map((arg) => {
    if (typeof arg === 'object' && arg !== null && 'value' in arg) {
      return arg.value;
    }
    return arg;
  });
};

class VmcInputManager {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private motionCaptureManager: MotionCaptureManager | null = null;
  private lastError: string | null = null;
  private hasActiveBlendFrame = false;

  setMotionCaptureManager(manager: MotionCaptureManager | null) {
    this.motionCaptureManager = manager;
  }

  getStatus() {
    return this.status;
  }

  getLastError() {
    return this.lastError;
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(status: ConnectionStatus, error?: string) {
    this.status = status;
    this.lastError = error ?? null;
    this.statusListeners.forEach((listener) => listener(status));
  }

  connect(url: string) {
    if (this.socket) {
      this.disconnect();
    }
    this.setStatus('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid WebSocket URL.';
      this.setStatus('error', message);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.setStatus('connected');
      this.motionCaptureManager?.startExternalInput();
    };

    socket.onclose = () => {
      this.motionCaptureManager?.stopExternalInput();
      vmcFrameBuffer.clear();
      this.setStatus('disconnected');
    };

    socket.onerror = () => {
      this.motionCaptureManager?.stopExternalInput();
      vmcFrameBuffer.clear();
      this.setStatus('error', 'Failed to connect to VMC bridge.');
    };

    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.motionCaptureManager?.stopExternalInput();
    vmcFrameBuffer.clear();
    this.hasReceivedRootPos = false;
    this.setStatus('disconnected');
  }

  private handleMessage(data: string | ArrayBuffer | Blob) {
    if (!this.motionCaptureManager) return;
    if (typeof data !== 'string') {
      if (data instanceof Blob) {
        data.text().then((text) => this.handleMessage(text));
        return;
      }
      const decoded = new TextDecoder().decode(data);
      this.handleMessage(decoded);
      return;
    }

    let payload: VmcPayload;
    try {
      payload = JSON.parse(data) as VmcPayload;
    } catch {
      return;
    }

    if (Array.isArray(payload)) {
      payload.forEach((message) => this.applyOscMessage(message));
    } else if (payload && typeof payload === 'object') {
      this.applyOscMessage(payload);
    }
  }

  private debugLogCount = 0;

  private hasReceivedRootPos = false;

  private applyOscMessage(message: OscMessage) {
    if (!this.motionCaptureManager) return;
    const args = normalizeArgs(message.args);

    // Debug log every 300 messages
    if (this.debugLogCount++ % 300 === 0) {
        console.log('[VMC] Received message:', message.address, args.length, 'args');
    }
    // Explicitly log bone messages for debugging
    if (message.address === VMC_BONE_ADDRESS && Math.random() < 0.001) {
        console.log('[VMC] BONE message received:', args[0]);
    }

    if (message.address === VMC_BONE_ADDRESS) {
      const [name, px, py, pz, qx, qy, qz, qw] = args;
      if (typeof name !== 'string' || [qx, qy, qz, qw].some((v) => typeof v !== 'number')) return;
      const boneName = toVrmBoneName(name);
      if (!boneName) return;
      const rotation = new THREE.Quaternion(qx as number, qy as number, qz as number, qw as number);
      
      // VMC coordinate system conversion (Left-Handed to Right-Handed/GL)
      rotation.x = -rotation.x;
      rotation.y = -rotation.y; 
      
      const timestamp = performance.now();
      
      // Push to buffer for interpolation (jitter reduction)
      vmcFrameBuffer.pushBoneRotation(boneName, rotation, timestamp);
      
      // Also apply directly for immediate feedback (filter will smooth it)
      this.motionCaptureManager.applyExternalBoneRotation(boneName, rotation);
      
      // Only use Hips position if we haven't received explicit Root position updates
      // This prevents conflict/jitter where both Root and Hips try to drive the character position
      if (boneName === 'hips' && !this.hasReceivedRootPos && [px, py, pz].every((v) => typeof v === 'number')) {
        const position = new THREE.Vector3(px as number, py as number, -(pz as number));
        vmcFrameBuffer.pushRootPosition(position, timestamp);
        this.motionCaptureManager.applyExternalRootPosition(position);
      }
      return;
    }

    if (message.address === VMC_ROOT_ADDRESS) {
      this.hasReceivedRootPos = true;
      const [name, px, py, pz, qx, qy, qz, qw] = args;
      const timestamp = performance.now();
      
      if ([px, py, pz].every((v) => typeof v === 'number')) {
         // Position X, Y, -Z
        const position = new THREE.Vector3(px as number, py as number, -(pz as number));
        vmcFrameBuffer.pushRootPosition(position, timestamp);
        this.motionCaptureManager.applyExternalRootPosition(position);
      }
      if (typeof name === 'string' && [qx, qy, qz, qw].every((v) => typeof v === 'number')) {
        const boneName = toVrmBoneName(name) ?? 'hips';
        const rotation = new THREE.Quaternion(qx as number, qy as number, qz as number, qw as number);
        // Coordinate conversion
        rotation.x = -rotation.x;
        rotation.y = -rotation.y;
        vmcFrameBuffer.pushBoneRotation(boneName, rotation, timestamp);
        this.motionCaptureManager.applyExternalBoneRotation(boneName, rotation);
      }
      return;
    }

    if (message.address === VMC_BLEND_ADDRESS) {
      const [name, value] = args;
      if (typeof name !== 'string' || typeof value !== 'number') return;
      const timestamp = performance.now();
      vmcFrameBuffer.pushExpression(name, value, timestamp);
      this.motionCaptureManager.applyExternalExpression(name, value);
      this.hasActiveBlendFrame = true;
      return;
    }

    if (message.address === VMC_BLEND_APPLY) {
      if (this.hasActiveBlendFrame) {
        this.hasActiveBlendFrame = false;
      }
    }
  }
}

export const vmcInputManager = new VmcInputManager();
