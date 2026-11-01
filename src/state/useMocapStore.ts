import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FaceMaskAdjustments } from '../utils/motionCapture';
import { ARKIT_FACE_DEFAULT_URL } from '../utils/arkitFaceProtocol';

interface MocapState {
  isActive: boolean;
  isStarting: boolean;
  isRecording: boolean;
  recordingTime: number;
  error: string | null;
  selectedDeviceId: string;
  isVoiceLipSyncActive: boolean;
  faceMaskEnabled: boolean;
  faceMaskProfiles: Record<string, FaceMaskAdjustments>;
  voiceVolume: number;
  voiceSensitivity: number;
  arkitCompanionUrl: string;
  arkitCompanionEnabled: boolean;
  
  setIsActive: (active: boolean) => void;
  setIsStarting: (starting: boolean) => void;
  setIsRecording: (recording: boolean) => void;
  setRecordingTime: (time: number | ((t: number) => number)) => void;
  setError: (error: string | null) => void;
  setSelectedDeviceId: (deviceId: string) => void;
  setIsVoiceLipSyncActive: (active: boolean) => void;
  setFaceMaskEnabled: (enabled: boolean) => void;
  setFaceMaskProfile: (profileKey: string, adjustments: FaceMaskAdjustments) => void;
  getFaceMaskProfile: (profileKey: string) => FaceMaskAdjustments | undefined;
  clearFaceMaskProfiles: () => void;
  setVoiceVolume: (volume: number) => void;
  setVoiceSensitivity: (sensitivity: number) => void;
  setArkitCompanionUrl: (url: string) => void;
  setArkitCompanionEnabled: (enabled: boolean) => void;
}

export const useMocapStore = create<MocapState>()(
  persist(
    (set, get) => ({
      isActive: false,
      isStarting: false,
      isRecording: false,
      recordingTime: 0,
      error: null,
      selectedDeviceId: '',
      isVoiceLipSyncActive: false,
      faceMaskEnabled: false,
      faceMaskProfiles: {},
      voiceVolume: 0,
      voiceSensitivity: 2.0,
      arkitCompanionUrl: ARKIT_FACE_DEFAULT_URL,
      arkitCompanionEnabled: false,

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
      setFaceMaskProfile: (profileKey, adjustments) => set((state) => ({
        faceMaskProfiles: {
          ...state.faceMaskProfiles,
          [profileKey]: { ...adjustments },
        },
      })),
      getFaceMaskProfile: (profileKey) => get().faceMaskProfiles[profileKey],
      clearFaceMaskProfiles: () => set({ selectedDeviceId: '', faceMaskProfiles: {} }),
      setVoiceVolume: (volume) => set({ voiceVolume: volume }),
      setVoiceSensitivity: (sensitivity) => set({ voiceSensitivity: sensitivity }),
      setArkitCompanionUrl: (url) => set({ arkitCompanionUrl: url }),
      setArkitCompanionEnabled: (enabled) => set({ arkitCompanionEnabled: enabled }),
    }),
    {
      name: 'poselab-mocap-settings',
      partialize: (state) => ({
        selectedDeviceId: state.selectedDeviceId,
        faceMaskProfiles: state.faceMaskProfiles,
        arkitCompanionUrl: state.arkitCompanionUrl,
      }),
    }
  )
);
