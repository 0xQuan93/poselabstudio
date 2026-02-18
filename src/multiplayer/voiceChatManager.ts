import { Room, RemoteTrack, RoomEvent, Track } from 'livekit-client';
import type { PeerId } from '../types/multiplayer';

/**
 * VoiceChatManager handles peer-to-peer audio communication using LiveKit.
 * Works alongside the existing data-channel-based liveKitManager.
 */

interface AudioPeer {
  peerId: PeerId;
  audioElement: HTMLAudioElement;
  isMuted: boolean;
  volume: number;
}

type VoiceChatStateListener = (state: VoiceChatState) => void;

export interface VoiceChatState {
  isEnabled: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  volume: number;
  activePeers: Map<PeerId, { isSpeaking: boolean; volume: number }>;
}

class VoiceChatManager {
  private room: Room | null = null;
  private audioPeers = new Map<PeerId, AudioPeer>();
  
  // State
  private isEnabled = false;
  private isMuted = false;
  private volume = 1.0;
  private isSpeaking = false;
  
  // Listeners
  private stateListeners = new Set<VoiceChatStateListener>();
  
  // Audio container for remote audio elements
  private audioContainer: HTMLDivElement | null = null;

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
    this.isMuted = !this.isMuted;

    if (this.room && this.room.localParticipant) {
        // We can just mute the track or disable mic. 
        // Muting the track keeps it published but sends silence.
        // setMicrophoneEnabled(false) unpublishes.
        // Usually "mute" means silence but keep connection.
        // But LiveKit recommends setMicrophoneEnabled(false) for full mute to save bandwidth, 
        // or just track.mute()
        
        // Let's use track.mute() if available, or just setMicrophoneEnabled
        // Actually, LiveKit localParticipant.setMicrophoneEnabled(true/false) is the high level API
        // For temporary mute (toggle), we might want to just mute the track.
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
   * Set output volume (0-1)
   */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    
    // Update all audio elements
    this.audioPeers.forEach((audioPeer) => {
      audioPeer.audioElement.volume = this.volume * audioPeer.volume;
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
      audioPeer.audioElement.volume = this.volume * audioPeer.volume;
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
      this.notifyStateChange();
      return audioPeer.isMuted;
    }
    return false;
  }

  /**
   * Handle peer leaving
   */
  handlePeerLeave(peerId: PeerId) {
    const audioPeer = this.audioPeers.get(peerId);
    if (audioPeer) {
      audioPeer.audioElement.remove();
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
        isSpeaking: false, // LiveKit has 'ActiveSpeaker' events we can listen to
        volume: audioPeer.volume,
      });
    });

    return {
      isEnabled: this.isEnabled,
      isMuted: this.isMuted,
      isSpeaking: this.isSpeaking,
      volume: this.volume,
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
             // Update speaking state
             this.isSpeaking = speakers.some(s => s.isLocal);
             this.notifyStateChange();
        });
  }

  private handleTrackSubscribed(track: RemoteTrack, peerId: PeerId) {
      console.log('[VoiceChatManager] Audio track subscribed:', peerId);
      
      const element = track.attach();
      element.volume = this.volume;
      
      if (this.audioContainer) {
          this.audioContainer.appendChild(element);
      }

      this.audioPeers.set(peerId, {
          peerId,
          audioElement: element,
          isMuted: false,
          volume: 1.0
      });
      
      this.notifyStateChange();
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

    this.stateListeners.clear();
    this.room = null;
  }
}

// Singleton instance
export const voiceChatManager = new VoiceChatManager();
