import { create } from 'zustand';

interface MocapState {
  isActive: boolean;
  isStarting: boolean;
  isRecording: boolean;
  recordingTime: number;
  error: string | null;
  selectedDeviceId: string;
  isVoiceLipSyncActive: boolean;
  faceMaskEnabled: boolean;
  voiceVolume: number;
  voiceSensitivity: number;
  
  setIsActive: (active: boolean) => void;
  setIsStarting: (starting: boolean) => void;
  setIsRecording: (recording: boolean) => void;
  setRecordingTime: (time: number | ((t: number) => number)) => void;
  setError: (error: string | null) => void;
  setSelectedDeviceId: (deviceId: string) => void;
  setIsVoiceLipSyncActive: (active: boolean) => void;
  setFaceMaskEnabled: (enabled: boolean) => void;
  setVoiceVolume: (volume: number) => void;
  setVoiceSensitivity: (sensitivity: number) => void;
}

export const useMocapStore = create<MocapState>((set) => ({
  isActive: false,
  isStarting: false,
  isRecording: false,
  recordingTime: 0,
  error: null,
  selectedDeviceId: '',
  isVoiceLipSyncActive: false,
  faceMaskEnabled: false,
  voiceVolume: 0,
  voiceSensitivity: 2.0,

  setIsActive: (active) => set({ isActive: active }),
  setIsStarting: (starting) => set({ isStarting: starting }),
  setIsRecording: (recording) => set({ isRecording: recording }),
  setRecordingTime: (time) => set((state) => ({ 
    recordingTime: typeof time === 'function' ? time(state.recordingTime) : time 
  })),
  setError: (error) => set({ error }),
  setSelectedDeviceId: (deviceId) => set({ selectedDeviceId: deviceId }),
  setIsVoiceLipSyncActive: (active) => set({ isVoiceLipSyncActive: active }),
  setFaceMaskEnabled: (enabled) => set({ faceMaskEnabled: enabled }),
  setVoiceVolume: (volume) => set({ voiceVolume: volume }),
  setVoiceSensitivity: (sensitivity) => set({ voiceSensitivity: sensitivity }),
}));
