import { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';

/**
 * VoiceLipSync - Audio-based lip synchronization for VRM avatars
 * 
 * Uses Web Audio API to capture microphone input and analyze audio
 * to drive mouth expressions based on volume and frequency characteristics.
 */

// ======================
// Configuration Constants
// ======================

/** Smoothing factor for expression transitions (lower = smoother) */
const SMOOTHING_FACTOR = 0.25;

/** Minimum volume threshold to trigger lip movement (0-1) */
const VOLUME_THRESHOLD = 0.02;

/** Frequency bands for vowel detection (Hz) */
const FREQUENCY_BANDS = {
  // Formant frequency ranges for vowel detection
  // Based on typical human speech formants (F1 and F2)
  LOW: { min: 200, max: 400 },      // 'O', 'U' sounds
  MID_LOW: { min: 400, max: 800 },  // 'A' sounds
  MID: { min: 800, max: 1200 },     // 'E' sounds  
  HIGH: { min: 1200, max: 2500 },   // 'I' sounds
};

/** Expression mapping for different VRM standards */
const MOUTH_EXPRESSIONS = {
  A: ['Aa', 'a', 'mouthOpen', 'jawOpen', 'A', 'aa'],
  E: ['Ee', 'e', 'E', 'ee'],
  I: ['Ih', 'i', 'I', 'ih'],
  O: ['Oh', 'o', 'O', 'oh', 'mouthPucker'],
  U: ['Ou', 'u', 'U', 'ou', 'mouthFunnel'],
};

interface VoiceLipSyncConfig {
  /** FFT size for frequency analysis (power of 2) */
  fftSize: number;
  /** Update rate in Hz */
  updateRate: number;
  /** Volume sensitivity multiplier */
  sensitivity: number;
}

const DEFAULT_CONFIG: VoiceLipSyncConfig = {
  fftSize: 256,
  updateRate: 30,
  sensitivity: 2.0,
};

export class VoiceLipSync {
  private vrm: VRM | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private mediaStream: MediaStream | null = null;
  
  // Analysis buffers
  private frequencyData: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private timeDomainData: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  
  // State tracking
  private isActive = false;
  private snappyMode = false;
  private updateLoopId: number | null = null;
  private config: VoiceLipSyncConfig;
  
  // Smoothed expression values
  private currentValues = { A: 0, E: 0, I: 0, O: 0, U: 0 };
  private targetValues = { A: 0, E: 0, I: 0, O: 0, U: 0 };
  
  // Available expressions on current avatar
  private availableExpressions: Map<string, string[]> = new Map();
  
  // Callbacks
  private onVolumeChange: ((volume: number) => void) | null = null;
  private onStateChange: ((isActive: boolean) => void) | null = null;

  constructor(config: Partial<VoiceLipSyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setSnappyMode(enabled: boolean) {
    this.snappyMode = enabled;
    console.log(`[VoiceLipSync] Snappy mode: ${enabled ? 'ON' : 'OFF'}`);
  }

  /**
   * Set the VRM avatar to control
   */
  setVRM(vrm: VRM | null) {
    this.vrm = vrm;
    if (vrm) {
      this.detectAvailableExpressions();
    }
  }

  /**
   * Detect which mouth expressions are available on the current avatar
   */
  private detectAvailableExpressions() {
    this.availableExpressions.clear();
    if (!this.vrm?.expressionManager) return;

    const manager = this.vrm.expressionManager as any;
    const available = new Set<string>();

    // Extract expression names
    if (manager.expressionMap) {
      Object.keys(manager.expressionMap).forEach(name => available.add(name));
    } else if (manager._expressionMap) {
      Object.keys(manager._expressionMap).forEach(name => available.add(name));
    } else if (manager.expressions) {
      manager.expressions.forEach((expr: any) => {
        if (expr.expressionName) available.add(expr.expressionName);
      });
    }

    // Map vowels to available expressions
    Object.entries(MOUTH_EXPRESSIONS).forEach(([vowel, candidates]) => {
      const found = candidates.filter(name => available.has(name));
      if (found.length > 0) {
        this.availableExpressions.set(vowel, found);
      }
    });

    console.log('[VoiceLipSync] Available expressions:', Object.fromEntries(this.availableExpressions));
  }

  /**
   * Start listening to microphone and driving lip sync
   */
  async start(): Promise<void> {
    if (this.isActive) return;

    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Create audio context and analyser
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect microphone to analyser
      this.microphone = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.microphone.connect(this.analyser);

      // Initialize buffers
      const bufferLength = this.analyser.frequencyBinCount;
      this.frequencyData = new Uint8Array(bufferLength);
      this.timeDomainData = new Uint8Array(bufferLength);

      this.isActive = true;
      this.startUpdateLoop();
      this.onStateChange?.(true);

      console.log('[VoiceLipSync] Started - FFT bins:', bufferLength);
    } catch (error) {
      console.error('[VoiceLipSync] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop lip sync and release microphone
   */
  stop() {
    this.stopUpdateLoop();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.isActive = false;
    
    // Reset expressions
    this.resetExpressions();
    this.onStateChange?.(false);

    console.log('[VoiceLipSync] Stopped');
  }

  /**
   * Check if lip sync is currently active
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Set callback for volume level changes (for UI visualization)
   */
  setOnVolumeChange(callback: ((volume: number) => void) | null) {
    this.onVolumeChange = callback;
  }

  /**
   * Set callback for state changes
   */
  setOnStateChange(callback: ((isActive: boolean) => void) | null) {
    this.onStateChange = callback;
  }

  private startUpdateLoop() {
    if (this.updateLoopId) return;

    const intervalMs = 1000 / this.config.updateRate;
    
    const update = () => {
      this.analyzeAudio();
      this.applyExpressions();
      this.updateLoopId = window.setTimeout(update, intervalMs);
    };
    
    update();
  }

  private stopUpdateLoop() {
    if (this.updateLoopId) {
      clearTimeout(this.updateLoopId);
      this.updateLoopId = null;
    }
  }

  /**
   * Analyze audio and compute vowel targets
   */
  private analyzeAudio() {
    if (!this.analyser) return;

    // Get frequency and time domain data
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeDomainData);

    // Calculate overall volume from time domain (RMS)
    let sumSquares = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      const normalized = (this.timeDomainData[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / this.timeDomainData.length);
    const volume = Math.min(rms * this.config.sensitivity, 1);

    this.onVolumeChange?.(volume);

    // If below threshold, close mouth
    if (volume < VOLUME_THRESHOLD) {
      this.targetValues = { A: 0, E: 0, I: 0, O: 0, U: 0 };
      return;
    }

    // Analyze frequency bands for vowel detection
    const bandEnergies = this.calculateBandEnergies();
    
    // Map frequency characteristics to vowel shapes
    this.targetValues = this.mapToVowels(bandEnergies, volume);
  }

  /**
   * Calculate energy in each frequency band
   */
  private calculateBandEnergies(): { low: number; midLow: number; mid: number; high: number } {
    if (!this.analyser || !this.audioContext) {
      return { low: 0, midLow: 0, mid: 0, high: 0 };
    }

    const nyquist = this.audioContext.sampleRate / 2;
    const binWidth = nyquist / this.frequencyData.length;

    const getEnergyInRange = (minHz: number, maxHz: number): number => {
      const minBin = Math.floor(minHz / binWidth);
      const maxBin = Math.ceil(maxHz / binWidth);
      let sum = 0;
      let count = 0;

      for (let i = minBin; i <= maxBin && i < this.frequencyData.length; i++) {
        sum += this.frequencyData[i];
        count++;
      }

      return count > 0 ? (sum / count) / 255 : 0;
    };

    return {
      low: getEnergyInRange(FREQUENCY_BANDS.LOW.min, FREQUENCY_BANDS.LOW.max),
      midLow: getEnergyInRange(FREQUENCY_BANDS.MID_LOW.min, FREQUENCY_BANDS.MID_LOW.max),
      mid: getEnergyInRange(FREQUENCY_BANDS.MID.min, FREQUENCY_BANDS.MID.max),
      high: getEnergyInRange(FREQUENCY_BANDS.HIGH.min, FREQUENCY_BANDS.HIGH.max),
    };
  }

  /**
   * Map frequency band energies to vowel shapes
   */
  private mapToVowels(
    bands: { low: number; midLow: number; mid: number; high: number },
    volume: number
  ): { A: number; E: number; I: number; O: number; U: number } {
    const { low, midLow, mid, high } = bands;
    const total = low + midLow + mid + high + 0.001; // Avoid division by zero

    // Normalize bands
    const normLow = low / total;
    const normMidLow = midLow / total;
    const normMid = mid / total;
    const normHigh = high / total;

    // Vowel estimation based on formant characteristics:
    // A: Strong mid-low (F1 ~700Hz)
    // E: Strong mid + some high (F1 ~400Hz, F2 ~2000Hz)
    // I: Strong high (F2 ~2500Hz)
    // O: Strong low + mid-low (F1 ~500Hz, F2 ~900Hz)
    // U: Very strong low (F1 ~300Hz, F2 ~900Hz)

    // Weight each vowel based on frequency distribution
    const vowelWeights = {
      A: normMidLow * 1.5 + normMid * 0.5,
      E: normMid * 1.2 + normHigh * 0.8,
      I: normHigh * 1.8 + normMid * 0.4,
      O: normLow * 0.8 + normMidLow * 1.0,
      U: normLow * 1.5 + normMidLow * 0.3,
    };

    // Find dominant vowel
    const maxWeight = Math.max(...Object.values(vowelWeights));
    
    // Scale by volume and apply soft selection (boost dominant, reduce others)
    const result = { A: 0, E: 0, I: 0, O: 0, U: 0 };
    
    Object.entries(vowelWeights).forEach(([vowel, weight]) => {
      // Soft-max style selection: boost higher weights
      const normalized = weight / (maxWeight + 0.001);
      const boosted = Math.pow(normalized, 2); // Square to emphasize dominant
      result[vowel as keyof typeof result] = THREE.MathUtils.clamp(boosted * volume * 1.5, 0, 1);
    });

    return result;
  }

  /**
   * Apply smoothed expressions to VRM
   */
  private applyExpressions() {
    if (!this.vrm?.expressionManager) return;

    // Smooth towards target values
    Object.keys(this.currentValues).forEach(vowel => {
      const key = vowel as keyof typeof this.currentValues;
      
      if (this.snappyMode) {
        // Instant update for mesh swaps (PNGTuber style)
        this.currentValues[key] = this.targetValues[key];
      } else {
        // Smooth lerp for standard 3D avatars
        this.currentValues[key] = THREE.MathUtils.lerp(
          this.currentValues[key],
          this.targetValues[key],
          SMOOTHING_FACTOR
        );
      }

      // Apply to VRM
      const expressionNames = this.availableExpressions.get(vowel);
      if (expressionNames) {
        expressionNames.forEach(name => {
          this.vrm!.expressionManager!.setValue(name, this.currentValues[key]);
        });
      }
    });

    this.vrm.expressionManager.update();
  }

  /**
   * Reset all mouth expressions to 0
   */
  private resetExpressions() {
    if (!this.vrm?.expressionManager) return;

    this.currentValues = { A: 0, E: 0, I: 0, O: 0, U: 0 };
    this.targetValues = { A: 0, E: 0, I: 0, O: 0, U: 0 };

    this.availableExpressions.forEach((names) => {
      names.forEach(name => {
        this.vrm!.expressionManager!.setValue(name, 0);
      });
    });

    this.vrm.expressionManager.update();
  }

  /**
   * Update sensitivity
   */
  setSensitivity(value: number) {
    this.config.sensitivity = value;
  }

  /**
   * Get current vowel values (for UI/debugging)
   */
  getCurrentValues(): { A: number; E: number; I: number; O: number; U: number } {
    return { ...this.currentValues };
  }

  /**
   * Check if a given expression name is controlled by voice lip sync
   * Used to prevent VMC from overwriting mouth expressions when lip sync is active
   */
  isExpressionControlled(expressionName: string): boolean {
    if (!this.isActive) return false;
    
    const lowerName = expressionName.toLowerCase();
    
    // Explicitly allow smile expressions so webcam can still control them
    if (lowerName.includes('smile')) {
      return false;
    }
    
    // Check all mouth expression mappings (Aa, Ee, Ih, Oh, Ou, jawOpen, mouthOpen, etc.)
    for (const candidates of Object.values(MOUTH_EXPRESSIONS)) {
      if (candidates.some(c => c.toLowerCase() === lowerName)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get all expression names that voice lip sync controls
   */
  getControlledExpressionNames(): string[] {
    const names: string[] = [];
    for (const candidates of Object.values(MOUTH_EXPRESSIONS)) {
      names.push(...candidates);
    }
    return names;
  }
}

// Export singleton instance
export const voiceLipSync = new VoiceLipSync();

