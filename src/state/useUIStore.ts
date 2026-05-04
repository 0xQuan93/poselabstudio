import { create } from 'zustand';

export type AppMode = 'reactions' | 'poselab' | 'studio' | 'wearables';
export type ReactionTab = 'presets' | 'pose' | 'scene' | 'export' | 'training' | 'feed' | 'mocap';
export type PoseLabTab = 'animations' | 'poses' | 'mocap' | 'director' | 'timeline' | 'export';

interface UIState {
  mode: AppMode;
  reactionTab: ReactionTab;
  poseLabTab: PoseLabTab;
  mobileDrawerOpen: boolean;
  sidebarOpen: boolean;

  // Tutorial State
  isTutorialActive: boolean;
  currentTutorialStep: number;

  // Calibration Wizard State
  isCalibrationActive: boolean;
  calibrationStep: number;

  // Global UI State
  activeCssOverlay: string | null;
  focusModeActive: boolean;
  streamMode: boolean; // Virtual Camera / Clean Output Mode

  setMode: (mode: AppMode) => void;
  setReactionTab: (tab: ReactionTab) => void;
  setPoseLabTab: (tab: PoseLabTab) => void;
  setMobileDrawerOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;

  startTutorial: () => void;
  endTutorial: () => void;
  nextTutorialStep: () => void;
  prevTutorialStep: () => void;
  setTutorialStep: (step: number) => void;

  startCalibration: () => void;
  endCalibration: () => void;
  setCalibrationStep: (step: number) => void;

  setActiveCssOverlay: (overlay: string | null) => void;
  setFocusModeActive: (active: boolean) => void;
  setStreamMode: (active: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  mode: 'reactions',
  reactionTab: 'presets',
  poseLabTab: 'animations', // Default will be changed to 'timeline' via logic or init
  mobileDrawerOpen: false,
  sidebarOpen: true,

  isTutorialActive: false,
  currentTutorialStep: 0,

  isCalibrationActive: false,
  calibrationStep: 0,

  activeCssOverlay: null,
  focusModeActive: false,
  streamMode: false,

  setMode: (mode) => set({ mode }),
  setReactionTab: (tab) => set({ reactionTab: tab }),
  setPoseLabTab: (tab) => set({ poseLabTab: tab }),
  setMobileDrawerOpen: (open) => set({ mobileDrawerOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  startTutorial: () => set({ isTutorialActive: true, currentTutorialStep: 0 }),
  endTutorial: () => set({ isTutorialActive: false, currentTutorialStep: 0 }),
  nextTutorialStep: () => set((state) => ({ currentTutorialStep: state.currentTutorialStep + 1 })),
  prevTutorialStep: () => set((state) => ({ currentTutorialStep: Math.max(0, state.currentTutorialStep - 1) })),
  setTutorialStep: (step) => set({ currentTutorialStep: step }),

  startCalibration: () => set({ isCalibrationActive: true, calibrationStep: 0 }),
  endCalibration: () => set({ isCalibrationActive: false, calibrationStep: 0 }),
  setCalibrationStep: (step) => set({ calibrationStep: step }),

  setActiveCssOverlay: (overlay) => set({ activeCssOverlay: overlay }),
  setFocusModeActive: (focusModeActive) => set({ focusModeActive }),
  setStreamMode: (streamMode) => set({ streamMode }),
}));
