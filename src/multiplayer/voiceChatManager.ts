import { Room, RemoteTrack, RoomEvent, Track } from 'livekit-client';
import type { PeerId } from '../types/multiplayer';
import { multiAvatarManager } from '../three/multiAvatarManager';
import * as THREE from 'three';
import { sceneManager } from '../three/sceneManager';

/**
 * VoiceChatManager handles peer-to-peer audio communication using LiveKit.
 * Enhanced with Spatial Audio support adapted from Hyperfy.
 */

interface AudioPeer {
  peerId: PeerId;
  audioElement: HTMLAudioElement;
  isMuted: boolean;
  volume: number;
  // Spatial Audio
  panner?: PannerNode;
  gain?: GainNode;
  track?: RemoteTrack;
}

type VoiceChatStateListener = (state: VoiceChatState) => void;

export interface VoiceChatState {
  isEnabled: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  volume: number;
  spatialEnabled: boolean;
  activePeers: Map<PeerId, { isSpeaking: boolean; volume: number }>;
}

class VoiceChatManager {
  private room: Room | null = null;
  private audioPeers = new Map<PeerId, AudioPeer>();
  private audioContext: AudioContext | null = null;
  
  // State
  private isEnabled = false;
  private isMuted = false;
  private volume = 1.0;
  private isSpeaking = false;
  private spatialEnabled = true; // Default to spatial
  
  // Listeners
  private stateListeners = new Set<VoiceChatStateListener>();
  
  // Audio container for remote audio elements
  private audioContainer: HTMLDivElement | null = null;

  // Temp vectors for spatial updates
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();

  constructor() {
    // Create hidden container for audio elements
    if (typeof document !== 'undefined') {
      this.audioContainer = document.createElement('div');
      this.audioContainer.id = 'voice-chat-audio-container';
      this.audioContainer.style.display = 'none';
      document.body.appendChild(this.audioContainer);
    }
  }

  // ==================
  // Public API
  // ==================

  /**
   * Initialize voice chat with an existing Room instance
   */
  setRoom(room: Room | null) {
    this.room = room;
    
    if (this.room) {
      // Initialize AudioContext if not already done
      if (!this.audioContext && typeof window !== 'undefined') {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      this.setupRoomListeners();
    }
  }

  /**
   * Enable voice chat (publish microphone)
   */
  async enable(): Promise<void> {
    if (this.isEnabled || !this.room) return;

    try {
      this.isEnabled = true;
      this.notifyStateChange();

      // Ensure AudioContext is resumed (requires user gesture)
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Publish microphone
      await this.room.localParticipant.setMicrophoneEnabled(true, {
         echoCancellation: true,
         noiseSuppression: true,
      });

      console.log('[VoiceChatManager] Voice chat enabled');
    } catch (error) {
      console.error('[VoiceChatManager] Failed to enable voice chat:', error);
      this.isEnabled = false;
      this.notifyStateChange();
      throw error;
    }
  }

  /**
   * Disable voice chat
   */
  async disable() {
    if (!this.isEnabled) return;

    // Unpublish microphone
    if (this.room && this.room.localParticipant) {
        await this.room.localParticipant.setMicrophoneEnabled(false);
    }
    
    this.isEnabled = false;
    this.isSpeaking = false;
    this.notifyStateChange();

    console.log('[VoiceChatManager] Voice chat disabled');
  }

  /**
   * Toggle mute state
   */
  toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  /**
   * Set mute state
   */
  setMuted(muted: boolean) {
    if (this.isMuted === muted) return;
    this.isMuted = muted;
    
    if (this.room && this.room.localParticipant) {
        const audioTrack = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (audioTrack && audioTrack.track) {
            if (this.isMuted) {
                audioTrack.track.mute();
            } else {
                audioTrack.track.unmute();
            }
        }
    }

    this.notifyStateChange();
  }

  /**
   * Toggle spatial audio
   */
  toggleSpatial(): boolean {
    this.spatialEnabled = !this.spatialEnabled;
    this.audioPeers.forEach(peer => this.applySpatialToPeer(peer));
    this.notifyStateChange();
    return this.spatialEnabled;
  }

  /**
   * Set output volume (0-1)
   */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    
    // Update all audio elements or gain nodes
    this.audioPeers.forEach((audioPeer) => {
      if (audioPeer.gain) {
        audioPeer.gain.gain.value = this.volume * audioPeer.volume;
      } else {
        audioPeer.audioElement.volume = this.volume * audioPeer.volume;
      }
    });

    this.notifyStateChange();
  }

  /**
   * Set volume for a specific peer (0-1)
   */
  setPeerVolume(peerId: PeerId, volume: number) {
    const audioPeer = this.audioPeers.get(peerId);
    if (audioPeer) {
      audioPeer.volume = Math.max(0, Math.min(1, volume));
      if (audioPeer.gain) {
        audioPeer.gain.gain.value = this.volume * audioPeer.volume;
      } else {
        audioPeer.audioElement.volume = this.volume * audioPeer.volume;
      }
      this.notifyStateChange();
    }
  }

  /**
   * Mute/unmute a specific peer
   */
  togglePeerMute(peerId: PeerId): boolean {
    const audioPeer = this.audioPeers.get(peerId);
    if (audioPeer) {
      audioPeer.isMuted = !audioPeer.isMuted;
      audioPeer.audioElement.muted = audioPeer.isMuted;
      if (audioPeer.gain) {
        audioPeer.gain.gain.value = audioPeer.isMuted ? 0 : this.volume * audioPeer.volume;
      }
      this.notifyStateChange();
      return audioPeer.isMuted;
    }
    return false;
  }

  /**
   * Update spatial positions for all peers
   * This should be called from the scene loop
   */
  updateSpatial() {
    if (!this.spatialEnabled || !this.audioContext) return;

    // Update Listener (Local Player)
    const camera = sceneManager.getCamera();
    if (camera) {
      const listener = this.audioContext.listener;
      camera.getWorldPosition(this.v1);
      camera.getWorldQuaternion(this.q1);
      this.v2.set(0, 0, -1).applyQuaternion(this.q1); // Look direction
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q1);

      if (listener.positionX) {
        const time = this.audioContext.currentTime;
        listener.positionX.setValueAtTime(this.v1.x, time);
        listener.positionY.setValueAtTime(this.v1.y, time);
        listener.positionZ.setValueAtTime(this.v1.z, time);
        listener.forwardX.setValueAtTime(this.v2.x, time);
        listener.forwardY.setValueAtTime(this.v2.y, time);
        listener.forwardZ.setValueAtTime(this.v2.z, time);
        listener.upX.setValueAtTime(up.x, time);
        listener.upY.setValueAtTime(up.y, time);
        listener.upZ.setValueAtTime(up.z, time);
      } else {
        // Fallback for older browsers
        listener.setPosition(this.v1.x, this.v1.y, this.v1.z);
        listener.setOrientation(this.v2.x, this.v2.y, this.v2.z, up.x, up.y, up.z);
      }
    }

    // Update Peers
    this.audioPeers.forEach((peer, peerId) => {
      if (!peer.panner) return;
      const avatar = multiAvatarManager.getAvatar(peerId);
      if (avatar) {
        avatar.scene.getWorldPosition(this.v1);
        const time = this.audioContext!.currentTime;
        peer.panner.positionX.setValueAtTime(this.v1.x, time);
        peer.panner.positionY.setValueAtTime(this.v1.y, time);
        peer.panner.positionZ.setValueAtTime(this.v1.z, time);
      }
    });
  }

  /**
   * Handle peer leaving
   */
  handlePeerLeave(peerId: PeerId) {
    const audioPeer = this.audioPeers.get(peerId);
    if (audioPeer) {
      audioPeer.audioElement.remove();
      audioPeer.track?.detach();
      this.audioPeers.delete(peerId);
      this.notifyStateChange();
    }
  }

  /**
   * Get current state
   */
  getState(): VoiceChatState {
    const activePeers = new Map<PeerId, { isSpeaking: boolean; volume: number }>();
    
    this.audioPeers.forEach((audioPeer, peerId) => {
      activePeers.set(peerId, {
        isSpeaking: false,
        volume: audioPeer.volume,
      });
    });

    return {
      isEnabled: this.isEnabled,
      isMuted: this.isMuted,
      isSpeaking: this.isSpeaking,
      volume: this.volume,
      spatialEnabled: this.spatialEnabled,
      activePeers,
    };
  }

  /**
   * Register state change listener
   */
  onStateChange(listener: VoiceChatStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Check if voice chat is available
   */
  isAvailable(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // ==================
  // Internal Methods
  // ==================

  private setupRoomListeners() {
      if (!this.room) return;

      this.room
        .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
            if (track.kind === Track.Kind.Audio) {
                this.handleTrackSubscribed(track as RemoteTrack, participant.identity);
            }
        })
        .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
            if (track.kind === Track.Kind.Audio) {
                this.handlePeerLeave(participant.identity);
            }
        })
        .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
             this.isSpeaking = speakers.some(s => s.isLocal);
             this.notifyStateChange();
        });

      // Periodic spatial update if enabled
      sceneManager.registerTick((_delta) => {
        this.updateSpatial();
      });
  }

  private handleTrackSubscribed(track: RemoteTrack, peerId: PeerId) {
      console.log('[VoiceChatManager] Audio track subscribed:', peerId);
      
      const element = track.attach();
      
      if (this.audioContainer) {
          this.audioContainer.appendChild(element);
      }

      const audioPeer: AudioPeer = {
          peerId,
          audioElement: element,
          isMuted: false,
          volume: 1.0,
          track
      };

      if (this.audioContext) {
        // Setup Web Audio Nodes
        const gain = this.audioContext.createGain();
        const panner = this.audioContext.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 50;
        panner.rolloffFactor = 1;

        audioPeer.gain = gain;
        audioPeer.panner = panner;

        // Use LiveKit's setAudioContext if supported by the version
        if ((track as any).setAudioContext && this.audioContext) {
           (track as any).setAudioContext(this.audioContext);
        }

        this.applySpatialToPeer(audioPeer);
      }

      this.audioPeers.set(peerId, audioPeer);
      this.notifyStateChange();
  }

  private applySpatialToPeer(peer: AudioPeer) {
    if (!this.audioContext || !peer.track || !peer.panner || !peer.gain) return;

    if (this.spatialEnabled) {
      peer.gain.gain.value = this.volume * peer.volume;
      (peer.track as any).setWebAudioPlugins([peer.panner, peer.gain]);
    } else {
      peer.gain.gain.value = this.volume * peer.volume;
      (peer.track as any).setWebAudioPlugins([peer.gain]);
    }
  }

  private notifyStateChange() {
    const state = this.getState();
    this.stateListeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[VoiceChatManager] State listener error:', error);
      }
    });
  }

  /**
   * Cleanup everything
   */
  destroy() {
    this.disable();
    
    if (this.audioContainer) {
      this.audioContainer.remove();
      this.audioContainer = null;
    }

    this.audioPeers.forEach(peer => {
      peer.audioElement.remove();
      peer.track?.detach();
    });
    this.audioPeers.clear();

    this.stateListeners.clear();
    this.room = null;
    this.audioContext = null;
  }
}

// Singleton instance
export const voiceChatManager = new VoiceChatManager();
