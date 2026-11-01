import { create } from 'zustand';
import { defaultPreset, findPresetById, pickPresetForName, randomPreset } from '../data/reactions';
import type { ReactionPreset, AnimationMode } from '../types/reactions';

export type MocapMode = 'full' | 'face' | 'faceOnly';

interface ReactionState {
  nameInput: string;
  activePreset: ReactionPreset;
  isAvatarReady: boolean;
  animationMode: AnimationMode;
  liveModeEnabled: boolean;
  liveControlsEnabled: boolean;
  mocapMode: MocapMode;
  vmcEnabled: boolean;
  vmcWebSocketUrl: string;
  setNameInput: (value: string) => void;
  setAvatarReady: (ready: boolean) => void;
  setAnimationMode: (mode: AnimationMode) => void;
  setLiveModeEnabled: (enabled: boolean) => void;
  setLiveControlsEnabled: (enabled: boolean) => void;
  setMocapMode: (mode: MocapMode) => void;
  setVmcEnabled: (enabled: boolean) => void;
  setVmcWebSocketUrl: (url: string) => void;
  applyName: () => ReactionPreset;
  randomize: () => ReactionPreset;
  setPresetById: (id: string) => ReactionPreset | undefined;
}

export const useReactionStore = create<ReactionState>((set, get) => ({
  nameInput: '',
  activePreset: defaultPreset,
  isAvatarReady: false,
  animationMode: 'loop',
  liveModeEnabled: false,
  liveControlsEnabled: true,
  mocapMode: 'full',
  vmcEnabled: false,
  vmcWebSocketUrl: 'ws://localhost:39540',
  setNameInput: (value) => set({ nameInput: value }),
  setAvatarReady: (ready) => set({ isAvatarReady: ready }),
  setAnimationMode: (mode) => set({ animationMode: mode }),
  setLiveModeEnabled: (enabled) => set({ liveModeEnabled: enabled }),
  setLiveControlsEnabled: (enabled) => set({ liveControlsEnabled: enabled }),
  setMocapMode: (mode) => set({ mocapMode: mode }),
  setVmcEnabled: (enabled) => set({ vmcEnabled: enabled }),
  setVmcWebSocketUrl: (url) => set({ vmcWebSocketUrl: url }),
  applyName: () => {
    const preset = pickPresetForName(get().nameInput);
    set({ activePreset: preset });
    return preset;
  },
  randomize: () => {
    const preset = randomPreset();
    set({ activePreset: preset });
    return preset;
  },
  setPresetById: (id) => {
    const preset = findPresetById(id);
    if (preset) set({ activePreset: preset });
    return preset;
  },
}));
