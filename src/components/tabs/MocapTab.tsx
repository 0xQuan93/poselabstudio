import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnimationClip } from 'three';
import { MotionCaptureManager, type FaceMaskAdjustments, type MotionCaptureStatus } from '../../utils/motionCapture';
import { voiceLipSync } from '../../utils/voiceLipSync';
import { avatarManager } from '../../three/avatarManager';
import { useAnimationStore } from '../../state/useAnimationStore';
import { useToastStore } from '../../state/useToastStore';
import { useUIStore } from '../../state/useUIStore';
import { useReactionStore } from '../../state/useReactionStore';
import { useUserStore } from '../../state/useUserStore';
import { useMocapStore } from '../../state/useMocapStore';
import { convertAnimationToScenePaths } from '../../pose-lab/convertAnimationToScenePaths';
import { CalibrationWizard } from '../CalibrationWizard';
import { sceneManager } from '../../three/sceneManager';
import { vrManager } from '../../three/vrManager';
import { webXRManager } from '../../utils/webXRManager';
import { vmcInputManager } from '../../utils/vmcInput';
import { initMocapManager, getMocapVideo } from '../../utils/mocapInstance';
import { useMediaDevices } from '../../hooks/useMediaDevices';
import { 
  VideoCamera, 
  Person, 
  UserFocus, 
  Stop, 
  Record, 
  MagicWand, 
  Rectangle,
  Microphone,
  StopCircle,
  Lightbulb,
  ArrowRight,
  Lock,
  Camera,
  Broadcast
} from '@phosphor-icons/react';

const EMPTY_MOCAP_STATUS: MotionCaptureStatus = {
  isTracking: false,
  isFaceMaskMode: false,
  mode: 'full',
  isHolisticReady: false,
  videoWidth: 0,
  videoHeight: 0,
  fps: 0,
  targetFps: 0,
  droppedVideoFrames: 0,
  lastFrameAt: null,
  lastPoseAt: null,
  lastFaceAt: null,
  lastLeftHandAt: null,
  lastRightHandAt: null,
  lastFaceMaskAt: null,
  activeSources: [],
};

const DEFAULT_FACE_MASK_ADJUSTMENTS: FaceMaskAdjustments = {
  offsetX: 0,
  offsetY: 0,
  lift: 0,
  scale: 1,
  depth: 0,
  backset: 0,
  crop: 0,
};

function isFresh(timestamp: number | null, now: number, windowMs = 1600) {
  return timestamp !== null && now - timestamp < windowMs;
}

function formatMaskValue(key: keyof FaceMaskAdjustments, value: number) {
  if (key === 'scale') return `${Math.round(value * 100)}%`;
  return value.toFixed(2);
}

function normalizeFaceMaskAdjustments(adjustments?: Partial<FaceMaskAdjustments>): FaceMaskAdjustments {
  return {
    ...DEFAULT_FACE_MASK_ADJUSTMENTS,
    ...adjustments,
  };
}

type FaceMaskAvatarMetadata = {
  name?: string;
  title?: string;
};

function getCurrentFaceMaskAvatarProfileId() {
  const vrm = avatarManager.getVRM();
  const meta = vrm?.meta as FaceMaskAvatarMetadata | undefined;
  return meta?.name || meta?.title || vrm?.scene?.name || vrm?.scene?.uuid || 'avatar';
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type StartMocapOptions = {
  isolateFaceMask?: boolean;
};

function getBrowserCaptureSupport() {
  const canUseCamera = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const canRecordCanvas = typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const isTouchDevice = typeof window !== 'undefined'
    && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches);

  return { canUseCamera, canRecordCanvas, isTouchDevice };
}

export function MocapTab() {
  const { addToast } = useToastStore();
  const { addAnimation } = useAnimationStore();
  const { startCalibration, isCalibrationActive, setStreamMode } = useUIStore();
  const {
    liveModeEnabled,
    liveControlsEnabled,
    mocapMode,
    vmcEnabled,
    vmcWebSocketUrl,
    setLiveModeEnabled,
    setLiveControlsEnabled,
    setMocapMode,
    setVmcEnabled,
    setVmcWebSocketUrl,
  } = useReactionStore();

  const {
    isActive,
    isStarting,
    isRecording,
    recordingTime,
    error,
    selectedDeviceId,
    isVoiceLipSyncActive,
    faceMaskEnabled,
    voiceVolume,
    voiceSensitivity,
    setIsActive,
    setIsStarting,
    setIsRecording,
    setRecordingTime,
    setError,
    setSelectedDeviceId,
    setIsVoiceLipSyncActive,
    setFaceMaskEnabled,
    setFaceMaskProfile,
    getFaceMaskProfile,
    clearFaceMaskProfiles,
    setVoiceVolume,
    setVoiceSensitivity,
  } = useMocapStore();
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const managerRef = useRef<MotionCaptureManager | null>(null);
  const timerRef = useRef<number | null>(null);
  
  const [isGreenScreen, setIsGreenScreen] = useState(false);
  const [isSelfieMode, setIsSelfieMode] = useState(false);
  const [isVoiceStarting, setIsVoiceStarting] = useState(false);
  
  const previousMocapModeRef = useRef<'full' | 'face'>(mocapMode);
  const previousMocapActiveRef = useRef(isActive);
  const previousVoiceActiveRef = useRef(isVoiceLipSyncActive);
  const liveModeEnabledRef = useRef(liveModeEnabled);
  const previousLiveModeEnabledRef = useRef(liveModeEnabled);
  const liveShutdownRef = useRef(false);
  const mocapStartingRef = useRef(false);
  const voiceStartingRef = useRef(false);
  const [arSupported, setArSupported] = useState(false);
  const [isARActive, setIsARActive] = useState(webXRManager.isActive());
  const [isARStarting, setIsARStarting] = useState(webXRManager.isStarting());
  const [arVisibility, setArVisibility] = useState<XRVisibilityState | null>(null);
  const [vrSupported, setVrSupported] = useState(false);
  const [isVRActive, setIsVRActive] = useState(false);
  const [isVRStarting, setIsVRStarting] = useState(false);
  const [vmcStatus, setVmcStatus] = useState(vmcInputManager.getStatus());
  const [vmcError, setVmcError] = useState<string | null>(null);
  const [managerStatus, setManagerStatus] = useState<MotionCaptureStatus>(EMPTY_MOCAP_STATUS);
  const [statusNow, setStatusNow] = useState(0);
  const [faceMaskAvatarProfileId, setFaceMaskAvatarProfileId] = useState('avatar');
  const [faceMaskAdjustments, setFaceMaskAdjustments] = useState<FaceMaskAdjustments>(DEFAULT_FACE_MASK_ADJUSTMENTS);
  const [faceMaskDebug, setFaceMaskDebug] = useState(false);
  const [browserCaptureSupport, setBrowserCaptureSupport] = useState(getBrowserCaptureSupport);

  // Camera Selection
  const { devices, fetchDevices } = useMediaDevices();

  const fallbackVideoWidth = managerStatus.videoWidth;
  const fallbackVideoHeight = managerStatus.videoHeight;
  const getFaceMaskProfileKey = useCallback(() => {
    const status = managerRef.current?.getStatus();
    const videoWidth = status?.videoWidth ?? fallbackVideoWidth;
    const videoHeight = status?.videoHeight ?? fallbackVideoHeight;
    const resolution = videoWidth && videoHeight
      ? `${videoWidth}x${videoHeight}`
      : 'pending';
    return `${faceMaskAvatarProfileId}::${selectedDeviceId || 'default-camera'}::${resolution}`;
  }, [faceMaskAvatarProfileId, fallbackVideoHeight, fallbackVideoWidth, selectedDeviceId]);

  // Initialize Global Manager
  useEffect(() => {
    webXRManager.isSupported().then(setArSupported);
    vrManager.refreshSupport().then(setVrSupported);
    managerRef.current = initMocapManager();
    managerRef.current.setMode(mocapMode);
    if (managerRef.current) {
      setManagerStatus(managerRef.current.getStatus());
    }
  }, [mocapMode]);

  useEffect(() => {
    const refreshCaptureSupport = () => setBrowserCaptureSupport(getBrowserCaptureSupport());
    refreshCaptureSupport();
    window.addEventListener('pageshow', refreshCaptureSupport);
    return () => window.removeEventListener('pageshow', refreshCaptureSupport);
  }, []);

  useEffect(() => {
    const unsubscribeState = webXRManager.subscribe(({ isActive: nextIsActive, isStarting, visibilityState }) => {
      setIsARActive(nextIsActive);
      setIsARStarting(isStarting);
      setArVisibility(visibilityState);
    });
    const unsubscribeSessionEnd = webXRManager.subscribeSessionEnd(() => {
      addToast("AR mode ended", "info");
    });

    return () => {
      unsubscribeState();
      unsubscribeSessionEnd();
    };
  }, [addToast]);

  useEffect(() => {
    managerRef.current?.setFaceMaskAdjustments(faceMaskAdjustments);
  }, [faceMaskAdjustments]);

  useEffect(() => {
    managerRef.current?.setFaceMaskDebug(faceMaskDebug);
  }, [faceMaskDebug]);

  useEffect(() => {
    const updateStatus = () => {
      if (managerRef.current) {
        setManagerStatus(managerRef.current.getStatus());
      }
      setStatusNow(performance.now());
      setFaceMaskAvatarProfileId((current) => {
        const next = getCurrentFaceMaskAvatarProfileId();
        return next === current ? current : next;
      });
      setIsVRActive(vrManager.isInVR());
    };
    updateStatus();
    const interval = window.setInterval(updateStatus, 750);
    return () => window.clearInterval(interval);
  }, []);

  // Synchronize local preview video with global video source
  useEffect(() => {
    const globalVideo = getMocapVideo();
    if (globalVideo && videoRef.current) {
        // If the global video already has a stream, mirror it
        if (globalVideo.srcObject) {
            videoRef.current.srcObject = globalVideo.srcObject;
            videoRef.current.play().catch(e => console.warn('Preview play blocked:', e));
        }
        
        // Listen for changes in the global video's stream
        const handleLoadedMetadata = () => {
            if (videoRef.current) {
                videoRef.current.srcObject = globalVideo.srcObject;
                videoRef.current.play().catch(e => console.warn('Preview play blocked:', e));
            }
        };
        
        globalVideo.addEventListener('loadedmetadata', handleLoadedMetadata);
        return () => {
            globalVideo.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    }
  }, [isActive]);

  useEffect(() => {
    const unsubscribe = vmcInputManager.subscribeStatus((status) => {
      setVmcStatus(status);
      if (status === 'error') {
        setVmcError(vmcInputManager.getLastError());
      } else {
        setVmcError(null);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!managerRef.current) return;
    vmcInputManager.setMotionCaptureManager(managerRef.current);
    if (!vmcEnabled) {
      vmcInputManager.disconnect();
      return;
    }
    const vrm = avatarManager.getVRM();
    if (!vrm) {
      addToast('Load an avatar before enabling VMC input.', 'warning');
      return;
    }
    managerRef.current.setVRM(vrm);
    vmcInputManager.connect(vmcWebSocketUrl);
  }, [addToast, vmcEnabled, vmcWebSocketUrl]);

  useEffect(() => {
    if (vmcStatus === 'connected') {
      if (faceMaskEnabled) {
        avatarManager.setInteraction(true);
        return;
      }
      avatarManager.freezeCurrentPose();
      avatarManager.setInteraction(true);
      return;
    }
    if (!isActive) {
      avatarManager.setInteraction(false);
    }
  }, [vmcStatus, isActive, faceMaskEnabled]);

  const toggleGreenScreen = () => {
      if (isGreenScreen) {
          // Revert to active preset background
          const currentPreset = useReactionStore.getState().activePreset;
          sceneManager.setBackground(currentPreset.background);
          setIsGreenScreen(false);
      } else {
          // Set to Green Screen
          sceneManager.setBackground('green-screen');
          setIsGreenScreen(true);
      }
  };

  const handleModeChange = useCallback((mode: 'full' | 'face') => {
      if (faceMaskEnabled) {
          addToast("Stop Face AR before changing mocap modes.", "warning");
          return;
      }

      setMocapMode(mode);
      if (managerRef.current) {
          managerRef.current.setMode(mode);
      }
      
      // Only apply avatar state changes if actively tracking
      if (isActive) {
          // Freeze current pose to ensure clean transition and no fighting with animation
          avatarManager.freezeCurrentPose();
          avatarManager.setInteraction(true);
          
          if (mode === 'face') {
              addToast("Upper Body Tracking: Animation paused for mocap control", "info");
          } else {
              addToast("Full Body Mode: Animation Frozen for Tracking", "info");
          }
      }
  }, [addToast, faceMaskEnabled, isActive, setMocapMode]);

  const setMocapModeOnly = useCallback((mode: 'full' | 'face') => {
    setMocapMode(mode);
    if (managerRef.current) {
      managerRef.current.setMode(mode);
    }
  }, [setMocapMode]);

  const saveRecordingClip = useCallback((clip: AnimationClip | null) => {
      if (!clip) {
          addToast('No motion data recorded', 'warning');
          return;
      }

      const vrm = avatarManager.getVRM();
      if (!vrm) {
          addToast('Load an avatar to save the recording', 'warning');
          return;
      }

      try {
          const sceneClip = convertAnimationToScenePaths(clip, vrm);
          const name = `Mocap Take ${new Date().toLocaleTimeString()}`;
          addAnimation(sceneClip, name);
          addToast(`Recording saved: ${name}`, 'success');
      } catch (e) {
          console.error(e);
          addToast('Failed to process recording', 'error');
      }
  }, [addAnimation, addToast]);

  const finishRecording = useCallback((showStoppedToast = false) => {
      if (!managerRef.current) return;
      const clip = managerRef.current.stopRecording();
      setIsRecording(false);
      if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
      }
      setRecordingTime(0);
      saveRecordingClip(clip);
      if (showStoppedToast) {
          addToast('Camera stopped and recording was finalized.', 'info');
      }
  }, [addToast, saveRecordingClip, setIsRecording, setRecordingTime]);

  const toggleRecording = () => {
      if (!managerRef.current || !isActive) return;

      if (isRecording) {
          finishRecording();

      } else {
          // Start Recording
          managerRef.current.startRecording();
          setIsRecording(true);
          setRecordingTime(0);
          timerRef.current = window.setInterval(() => {
              setRecordingTime(t => t + 1);
          }, 1000);
      }
  };

  // Sync recording timer if already recording when mounting
  useEffect(() => {
    if (isRecording && !timerRef.current) {
        timerRef.current = window.setInterval(() => {
            setRecordingTime(t => t + 1);
        }, 1000);
    }
    return () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };
  }, [isRecording, setRecordingTime]);

  // Voice Lip Sync handlers
  const stopVoiceLipSync = useCallback(() => {
    if (!isVoiceLipSyncActive) return;
    voiceLipSync.stop();
    setIsVoiceLipSyncActive(false);
    setVoiceVolume(0);
  }, [isVoiceLipSyncActive, setIsVoiceLipSyncActive, setVoiceVolume]);

  const startVoiceLipSync = useCallback(async (): Promise<boolean> => {
    if (isVoiceLipSyncActive) return true;
    if (voiceStartingRef.current) return false;
    const vrm = avatarManager.getVRM();
    if (!vrm) {
      addToast("Load an avatar first!", "error");
      return false;
    }
    voiceStartingRef.current = true;
    setIsVoiceStarting(true);
    try {
      voiceLipSync.setVRM(vrm);
      voiceLipSync.setOnVolumeChange(setVoiceVolume);
      voiceLipSync.setSensitivity(voiceSensitivity);
      await voiceLipSync.start();
      setIsVoiceLipSyncActive(true);
      addToast("Voice Lip Sync started", "success");
      if (liveShutdownRef.current && !liveModeEnabledRef.current) {
        voiceLipSync.stop();
        setIsVoiceLipSyncActive(false);
        setVoiceVolume(0);
        return false;
      }
      return true;
    } catch (e: any) {
      console.error('[VoiceLipSync]', e);
      let msg = "Failed to access microphone.";
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        msg = "Microphone permission denied. Please allow access in browser settings.";
      } else if (e.name === 'NotFoundError') {
        msg = "No microphone found.";
      }
      addToast(msg, "error");
      return false;
    } finally {
      voiceStartingRef.current = false;
      setIsVoiceStarting(false);
    }
  }, [addToast, isVoiceLipSyncActive, voiceSensitivity, setVoiceVolume, setIsVoiceLipSyncActive, liveModeEnabled]);

  const toggleVoiceLipSync = async () => {
    if (isVoiceLipSyncActive) {
      stopVoiceLipSync();
      return;
    }
    await startVoiceLipSync();
  };

  const handleSensitivityChange = (value: number) => {
    setVoiceSensitivity(value);
    voiceLipSync.setSensitivity(value);
  };

  const updateFaceMaskAdjustment = useCallback((key: keyof FaceMaskAdjustments, value: number) => {
    setFaceMaskAdjustments((current) => {
      const next = normalizeFaceMaskAdjustments({ ...current, [key]: value });
      managerRef.current?.setFaceMaskAdjustments(next);
      setFaceMaskProfile(getFaceMaskProfileKey(), next);
      return next;
    });
  }, [getFaceMaskProfileKey, setFaceMaskProfile]);

  const saveFaceMaskCalibration = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) {
      addToast("Start Face AR before saving calibration.", "warning");
      return;
    }

    const next = manager.calibrateFaceMaskNeutral();
    if (!next) {
      addToast("Keep your face visible, then try neutral calibration again.", "warning");
      return;
    }

    const normalized = normalizeFaceMaskAdjustments(next);
    manager.setFaceMaskAdjustments(normalized);
    setFaceMaskAdjustments(normalized);
    setFaceMaskProfile(getFaceMaskProfileKey(), normalized);
    setManagerStatus(manager.getStatus());
    addToast("Face AR neutral calibration saved for this avatar and camera.", "success");
  }, [addToast, getFaceMaskProfileKey, setFaceMaskProfile]);

  const resetFaceMaskAdjustments = useCallback(() => {
    managerRef.current?.resetFaceMaskAdjustments();
    const next = normalizeFaceMaskAdjustments(managerRef.current?.getFaceMaskAdjustments());
    setFaceMaskProfile(getFaceMaskProfileKey(), next);
    setFaceMaskAdjustments(next);
    addToast("Face AR adjustments reset", "info");
  }, [addToast, getFaceMaskProfileKey, setFaceMaskProfile]);

  const clearFacialCaptureData = useCallback(() => {
    const confirmed = window.confirm(
      'Clear the saved Facial XR camera choice and all local face-mask calibration profiles? Your browser permissions and downloaded recordings will not be changed.',
    );
    if (!confirmed) return;

    clearFaceMaskProfiles();
    managerRef.current?.resetFaceMaskAdjustments();
    setFaceMaskAdjustments(DEFAULT_FACE_MASK_ADJUSTMENTS);
    addToast('Saved Facial XR calibration and camera choice cleared from this device.', 'success');
  }, [addToast, clearFaceMaskProfiles]);

  const stopMocap = useCallback(() => {
    if (!managerRef.current || !isActive) return;
    if (isRecording) {
      finishRecording(true);
    }
    managerRef.current.setFaceMaskMode(false);
    setFaceMaskEnabled(false);
    setFaceMaskDebug(false);
    managerRef.current.stop();
    setIsActive(false);
    setIsStarting(false);
    // Resume normal behavior when stopping camera
    avatarManager.setInteraction(false);
    if (isSelfieMode) {
      sceneManager.setFollowTarget(null, null);
      setIsSelfieMode(false);
    }
    mocapStartingRef.current = false;
  }, [finishRecording, isActive, isRecording, isSelfieMode, setFaceMaskEnabled, setIsActive, setIsStarting]);

  const startMocap = useCallback(async (modeOverride?: 'full' | 'face', options?: StartMocapOptions) => {
    if (!managerRef.current || isActive || mocapStartingRef.current) return;
    const vrm = avatarManager.getVRM();
    if (!vrm) {
      setError("Load an avatar first!");
      return;
    }
    mocapStartingRef.current = true;
    setIsStarting(true);
    try {
      // Check for secure context first
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        throw new Error("Webcam access requires HTTPS (Secure Context).");
      }

      if (modeOverride && modeOverride !== mocapMode) {
        setMocapMode(modeOverride);
        managerRef.current.setMode(modeOverride);
      }

      managerRef.current.setVRM(vrm);
      if (options?.isolateFaceMask) {
        managerRef.current.setFaceMaskMode(true);
      }
      
      // Pass the selected device ID if available
      await managerRef.current.start(selectedDeviceId || undefined);
      fetchDevices();
      
      // Regular mocap freezes the current pose. XR Face Mask instead resets into
      // an isolated neutral head base so inherited body pose cannot skew the mask.
      if (!options?.isolateFaceMask) {
        avatarManager.freezeCurrentPose();
      }
      avatarManager.setInteraction(true);
      setIsActive(true);
      setError(null);
      setManagerStatus(managerRef.current.getStatus());
      
      useUserStore.getState().recordGamifiedAction('first_mocap').then(reward => {
        if (reward > 0) {
           useToastStore.getState().addToast(`+${reward} LP for starting Mocap!`, 'success');
        }
      });

      if (liveShutdownRef.current && !liveModeEnabledRef.current) {
        managerRef.current.stop();
        setIsActive(false);
      }
    } catch (e: any) {
      if (options?.isolateFaceMask) {
        managerRef.current?.setFaceMaskMode(false);
      }
      console.error(e);
      let msg = "Failed to access webcam.";
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        msg = "Permission denied. Please allow camera access in your browser settings.";
      } else if (e.name === 'NotFoundError') {
        msg = "No camera found.";
      } else if (e.name === 'NotReadableError') {
        msg = "Camera is in use by another application.";
      } else if (e.message) {
        msg = e.message;
      }
      setError(msg);
    } finally {
      mocapStartingRef.current = false;
      setIsStarting(false);
    }
  }, [fetchDevices, isActive, mocapMode, setError, setIsActive, setIsStarting, setMocapMode, selectedDeviceId, liveModeEnabled]);

  const toggleMocap = async () => {
    if (!managerRef.current) return;
    
    if (isActive) {
        stopMocap();
    } else {
        await startMocap();
    }
  };

  const toggleSelfieMode = () => {
    if (faceMaskEnabled) {
      addToast("Stop Face AR before enabling Selfie Mode.", "warning");
      return;
    }
    const next = !isSelfieMode;
    if (next) {
      const vrm = avatarManager.getVRM();
      const head = vrm?.humanoid?.getNormalizedBoneNode('head');
      if (!head) {
        addToast("Load an avatar to enable Selfie Mode.", "warning");
        return;
      }
      sceneManager.setFollowTarget(head, 'selfie');
      setIsSelfieMode(true);
    } else {
      sceneManager.setFollowTarget(null, null);
      setIsSelfieMode(false);
    }
  };

  const startAR = useCallback(async () => {
    if (isARActive || isARStarting) return;
    try {
      await webXRManager.startAR();
    } catch (e: unknown) {
      addToast(getErrorMessage(e, "Failed to start AR"), 'error');
    }
  }, [addToast, isARActive, isARStarting]);

  const exitAR = useCallback(async () => {
    if (!isARActive) return;
    try {
      await webXRManager.stopAR();
    } catch (e: unknown) {
      addToast(getErrorMessage(e, "Failed to exit AR"), 'error');
    }
  }, [addToast, isARActive]);

  const toggleFaceMask = useCallback(async (withVoice = false) => {
    if (!managerRef.current) return;

    if (faceMaskEnabled) {
      managerRef.current.setFaceMaskMode(false);
      setFaceMaskEnabled(false);
      setFaceMaskDebug(false);
      addToast("Face AR stopped", "info");
      return;
    }

    const vrm = avatarManager.getVRM();
    if (!vrm) {
      addToast("Load a VRM avatar before starting Face AR.", "warning");
      return;
    }

    if (isSelfieMode) {
      sceneManager.setFollowTarget(null, null);
      setIsSelfieMode(false);
    }

    if (mocapMode !== 'face') {
      setMocapMode('face');
      managerRef.current.setMode('face');
    }

    if (!isActive) {
      await startMocap('face', { isolateFaceMask: true });
      if (!managerRef.current?.getStatus().isTracking) {
        managerRef.current?.setFaceMaskMode(false);
        return;
      }
    } else {
      avatarManager.setInteraction(true);
    }

    managerRef.current.setVRM(vrm);
    const savedAdjustments = getFaceMaskProfile(getFaceMaskProfileKey());
    const adjustments = normalizeFaceMaskAdjustments(savedAdjustments);
    setFaceMaskAdjustments(adjustments);
    managerRef.current.setFaceMaskAdjustments(adjustments);
    managerRef.current.setFaceMaskDebug(faceMaskDebug);
    managerRef.current.setFaceMaskMode(true);
    setFaceMaskEnabled(true);
    sceneManager.setFollowTarget(null, null);
    sceneManager.setCameraPreset('headshot', true, 0.2);
    sceneManager.setBackground('transparent');
    setIsGreenScreen(false);
    setManagerStatus(managerRef.current.getStatus());
    const voiceReady = withVoice ? await startVoiceLipSync() : isVoiceLipSyncActive;
    addToast(
      voiceReady
        ? "Facial XR started. Your front camera and voice are driving the avatar."
        : "Face AR started. Add voice when you are ready to record.",
      "success",
    );
  }, [addToast, faceMaskDebug, faceMaskEnabled, getFaceMaskProfile, getFaceMaskProfileKey, isActive, isSelfieMode, isVoiceLipSyncActive, mocapMode, setFaceMaskEnabled, setMocapMode, startMocap, startVoiceLipSync]);

  const toggleFacialXR = useCallback(async () => {
    if (faceMaskEnabled) {
      managerRef.current?.setFaceMaskMode(false);
      setFaceMaskEnabled(false);
      setFaceMaskDebug(false);
      stopVoiceLipSync();
      stopMocap();
      addToast("Facial XR ended. Camera and microphone released.", "info");
      return;
    }

    await toggleFaceMask(true);
  }, [addToast, faceMaskEnabled, setFaceMaskEnabled, stopMocap, stopVoiceLipSync, toggleFaceMask]);

  const enterVR = async () => {
    const vrm = avatarManager.getVRM();
    if (!vrm) {
      addToast("Load a VRM avatar before entering VR.", "warning");
      return;
    }
    setIsVRStarting(true);
    try {
      if (isSelfieMode) {
        sceneManager.setFollowTarget(null, null);
        setIsSelfieMode(false);
      }
      if (faceMaskEnabled) {
        managerRef.current?.setFaceMaskMode(false);
        setFaceMaskEnabled(false);
        setFaceMaskDebug(false);
      }
      if (isActive) {
        stopMocap();
      }
      await vrManager.enterVR();
      setIsVRActive(true);
    } catch (e: any) {
      addToast(e.message || "Failed to enter VR", 'error');
    } finally {
      setIsVRStarting(false);
    }
  };

  const exitVR = async () => {
    try {
      await vrManager.exitVR();
      setIsVRActive(false);
    } catch (e: any) {
      addToast(e.message || "Failed to exit VR", 'error');
    }
  };

  useEffect(() => {
    const wasLiveModeEnabled = previousLiveModeEnabledRef.current;
    liveModeEnabledRef.current = liveModeEnabled;
    previousLiveModeEnabledRef.current = liveModeEnabled;
    if (liveModeEnabled) {
      liveShutdownRef.current = false;
      previousMocapModeRef.current = mocapMode;
      previousMocapActiveRef.current = isActive;
      previousVoiceActiveRef.current = isVoiceLipSyncActive;
      if (mocapMode !== 'face') {
        handleModeChange('face');
      }
      if (!isActive && !mocapStartingRef.current) {
        startMocap('face');
      }
      if (!isVoiceLipSyncActive && !voiceStartingRef.current) {
        startVoiceLipSync();
      }
      return;
    }

    const exitingLiveMode = wasLiveModeEnabled;
    liveShutdownRef.current = exitingLiveMode;
    if (previousMocapModeRef.current !== mocapMode) {
      if (!isActive && !previousMocapActiveRef.current) {
        setMocapModeOnly(previousMocapModeRef.current);
      } else {
        handleModeChange(previousMocapModeRef.current);
      }
    }
    if (exitingLiveMode && !previousMocapActiveRef.current && isActive) {
      liveShutdownRef.current = true;
      stopMocap();
    }
    if (exitingLiveMode && !previousVoiceActiveRef.current && isVoiceLipSyncActive) {
      liveShutdownRef.current = true;
      stopVoiceLipSync();
    }
  }, [
    liveModeEnabled,
    mocapMode,
    isActive,
    isVoiceLipSyncActive,
    handleModeChange,
    setMocapModeOnly,
    startMocap,
    startVoiceLipSync,
    stopMocap,
    stopVoiceLipSync,
  ]);

  const now = statusNow;
  const poseFresh = isFresh(managerStatus.lastPoseAt, now);
  const faceFresh = isFresh(managerStatus.lastFaceAt, now);
  const leftHandFresh = isFresh(managerStatus.lastLeftHandAt, now);
  const rightHandFresh = isFresh(managerStatus.lastRightHandAt, now);
  const faceMaskFresh = isFresh(managerStatus.lastFaceMaskAt, now);
  const frameFresh = isFresh(managerStatus.lastFrameAt, now);
  const activePartCount = [poseFresh, faceFresh, leftHandFresh, rightHandFresh].filter(Boolean).length;
  const cameraStateLabel = isStarting
    ? 'Starting'
    : isActive && managerStatus.isTracking
      ? 'Live'
      : isActive
        ? 'Interrupted'
        : 'Idle';
  const trackingQualityLabel = !managerStatus.isHolisticReady
    ? 'MediaPipe unavailable'
    : !isActive
      ? 'Standby'
      : !managerStatus.isTracking
        ? 'Camera interrupted'
      : !frameFresh
        ? 'Searching'
        : activePartCount >= 3
          ? 'Strong'
          : activePartCount >= 1
            ? 'Partial'
            : 'Searching';
  const trackingHint = !managerStatus.isHolisticReady
    ? 'Reload if the CDN script failed.'
    : !isActive
      ? 'Ready when the camera starts.'
      : !managerStatus.isTracking
        ? 'Camera stream ended. Stop, then start the camera to reconnect.'
      : !frameFresh
        ? 'Waiting for camera frames.'
        : activePartCount >= 3
          ? 'Body signal looks usable.'
          : 'Improve lighting or re-frame the subject.';
  const videoResolution = managerStatus.videoWidth && managerStatus.videoHeight
    ? `${managerStatus.videoWidth}x${managerStatus.videoHeight}`
    : 'No video';
  const vmcLabel = vmcEnabled ? vmcStatus : 'off';
  const facialXrReady = Boolean(avatarManager.getVRM())
    && browserCaptureSupport.canUseCamera
    && browserCaptureSupport.canRecordCanvas;

  return (
    <div className="tab-content mocap-tab">
      <div className="tab-section">
        <h3>Face AR</h3>
        <p className="muted small">
          Browser-first facial capture for your VRM: front camera, voice lip sync, and local video recording. It uses browser landmarks—not native TrueDepth/ARKit data.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <button
            className={`primary full-width ${faceMaskEnabled ? 'secondary' : ''}`}
            onClick={toggleFacialXR}
            disabled={isStarting}
            aria-pressed={faceMaskEnabled}
            style={{ flex: '1 1 100%' }}
          >
            <MagicWand size={18} weight="duotone" /> {faceMaskEnabled ? 'Exit Facial XR' : 'Enter Facial XR'}
          </button>
          <button
            className={`primary full-width ${liveModeEnabled ? 'secondary' : ''}`}
            onClick={() => setLiveModeEnabled(!liveModeEnabled)}
            aria-pressed={liveModeEnabled}
            style={{ flex: '1 1 100%' }}
          >
            {liveModeEnabled ? 'Stop Voice + Controls' : 'Add Voice + Controls'}
          </button>
          <button
            className="secondary full-width"
            onClick={() => {
              setStreamMode(true);
              addToast('Clean Stream Output active. Press Esc or move your pointer to the top-right to exit.', 'info');
            }}
            style={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            <Broadcast size={16} weight="duotone" /> Open Clean Stream Output
          </button>
          <button
            className={`secondary full-width ${liveControlsEnabled ? 'active' : ''}`}
            onClick={() => setLiveControlsEnabled(!liveControlsEnabled)}
            aria-pressed={liveControlsEnabled}
            style={{ flex: '1 1 100%' }}
          >
            {liveControlsEnabled ? 'Arrow Key Controls: On' : 'Arrow Key Controls: Off'}
          </button>
        </div>
        <div className="mocap-checklist" aria-label="Live performance readiness">
          <span className={avatarManager.getVRM() ? 'is-ready' : ''}>Avatar</span>
          <span className={browserCaptureSupport.canUseCamera ? 'is-ready' : ''}>Camera API</span>
          <span className={isVoiceLipSyncActive ? 'is-ready' : isVoiceStarting ? 'is-pending' : ''}>
            {isVoiceStarting ? 'Voice starting' : 'Voice'}
          </span>
          <span className={browserCaptureSupport.canRecordCanvas ? 'is-ready' : ''}>Video recorder</span>
        </div>
        <p className="small muted" style={{ marginTop: '0.75rem' }}>
          {facialXrReady
            ? browserCaptureSupport.isTouchDevice
              ? 'Preflight ready. Keep your face centered, use front lighting, then tap Enter Facial XR. Use the red camera button on the stage to save a local take.'
              : 'Preflight ready. Enter Facial XR, then use the red camera button on the stage to save a local take.'
            : 'Load an avatar and use a browser with camera and video-recording support to enter Facial XR.'}
        </p>
        <button
          type="button"
          className="secondary full-width"
          onClick={clearFacialCaptureData}
          style={{ marginTop: '0.5rem', minHeight: '44px' }}
          title="Remove saved Facial XR calibration and camera preferences from this browser"
        >
          Clear local Facial XR data
        </button>
      </div>
      <div className="tab-section">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><VideoCamera size={18} weight="duotone" /> Webcam Motion Capture</h3>
        <p className="muted small">
            Control your avatar with your webcam. Full Body mode uses pose + hands + face, so keep your full body in frame and ensure good lighting.
        </p>

        <div className="mocap-status-grid" aria-live="polite">
          <div className={`mocap-status-card ${isActive ? 'is-live' : ''}`}>
            <span>Camera</span>
            <strong>{cameraStateLabel}</strong>
            <small>{videoResolution}</small>
          </div>
          <div className={`mocap-status-card ${frameFresh ? 'is-live' : ''}`}>
            <span>Tracking</span>
            <strong>{trackingQualityLabel}</strong>
            <small>{trackingHint}</small>
          </div>
          <div className={`mocap-status-card ${isRecording ? 'is-recording' : ''}`}>
            <span>Take</span>
            <strong>{isRecording ? `${recordingTime}s` : 'Ready'}</strong>
            <small>{isRecording ? 'Recording motion' : 'Record after camera starts'}</small>
          </div>
        </div>

        <div className="mocap-signal-row" aria-label="Detected mocap signals">
          <span className={`mocap-signal ${poseFresh ? 'is-ready' : ''}`}>Body</span>
          <span className={`mocap-signal ${faceFresh ? 'is-ready' : ''}`}>Face</span>
          <span className={`mocap-signal ${leftHandFresh ? 'is-ready' : ''}`}>Left Hand</span>
          <span className={`mocap-signal ${rightHandFresh ? 'is-ready' : ''}`}>Right Hand</span>
          <span className={`mocap-signal ${faceMaskFresh ? 'is-ready' : ''}`}>Face AR</span>
          <span
            className={`mocap-signal ${managerStatus.fps > 12 ? 'is-ready' : ''}`}
            title={managerStatus.droppedVideoFrames > 0 ? `${managerStatus.droppedVideoFrames} camera frames skipped to protect rendering performance` : 'Tracker frame rate'}
          >
            {managerStatus.targetFps ? `${managerStatus.fps}/${managerStatus.targetFps} FPS` : `${managerStatus.fps} FPS`}
          </span>
        </div>
        
        {/* Camera Selector */}
        {!isActive && devices.length > 0 && (
          <div className="field" style={{ marginBottom: '10px' }}>
             <label htmlFor="camera-select" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Camera size={14} /> Camera Input
             </label>
             <select 
               id="camera-select"
               value={selectedDeviceId}
               onChange={(e) => setSelectedDeviceId(e.target.value)}
               disabled={isStarting}
               className="full-width"
             >
               <option value="">Default Camera</option>
               {devices.map(device => (
                 <option key={device.deviceId} value={device.deviceId}>
                   {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                 </option>
               ))}
             </select>
          </div>
        )}

        <div className={`mocap-preview ${isActive ? 'is-live' : ''}`}>
            <video 
                ref={videoRef} 
                style={{ 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'cover',
                    transform: 'scaleX(-1)' // Mirror effect
                }} 
                playsInline 
                muted 
            />
            <div className={`mocap-preview__badge ${isActive ? 'is-live' : isStarting ? 'is-pending' : ''}`}>
              {isStarting ? 'Starting Camera' : isActive ? `${trackingQualityLabel} Tracking` : 'Camera Off'}
            </div>
            {!isActive && (
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(255,255,255,0.5)'
                }}>
                    {isStarting ? 'Starting...' : 'Camera Off'}
                </div>
            )}
        </div>

        {error && (
            <div className="error-message" style={{ marginBottom: '1rem', padding: '10px', background: 'rgba(255, 50, 50, 0.1)', border: '1px solid #ff5555', borderRadius: '4px' }}>
                {error}
                {error.includes("Permission") && (
                    <div style={{ marginTop: '5px', fontSize: '0.8em' }}>
                        <ArrowRight size={14} weight="bold" /> Check the lock icon <Lock size={14} weight="fill" /> in your address bar to reset permissions.
                    </div>
                )}
            </div>
        )}

        {/* Mode Selection */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <button
                className={`secondary full-width ${mocapMode === 'full' ? 'active' : ''}`}
                onClick={() => handleModeChange('full')}
                aria-pressed={mocapMode === 'full'}
                title="Track both body and face"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
                <Person size={16} weight="duotone" /> Full Body
            </button>
            <button
                className={`secondary full-width ${mocapMode === 'face' ? 'active' : ''}`}
                onClick={() => handleModeChange('face')}
                aria-pressed={mocapMode === 'face'}
                title="Track face, hands, and upper body"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
                <UserFocus size={16} weight="duotone" /> Upper Body
            </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <button 
                className={`primary full-width ${isActive ? 'secondary' : ''}`}
                onClick={toggleMocap}
                disabled={isStarting}
                aria-pressed={isActive}
                style={{ flex: isActive ? '1 1 45%' : '1 1 100%' }}
            >
                {isActive ? <><StopCircle size={16} weight="fill" /> Stop Camera</> : isStarting ? <><VideoCamera size={16} weight="duotone" /> Starting...</> : <><VideoCamera size={16} weight="duotone" /> Start Camera</>}
            </button>

            {isActive && (
                <button 
                    className={`primary full-width ${isRecording ? 'danger' : ''}`}
                    onClick={toggleRecording}
                    aria-pressed={isRecording}
                    style={{ flex: '1 1 45%' }}
                >
                    {isRecording ? <><Stop size={16} weight="fill" /> Stop ({recordingTime}s)</> : <><Record size={16} weight="fill" style={{ color: '#ff4444' }} /> Record</>}
                </button>
            )}

            {isActive && (
                <div style={{ display: 'flex', width: '100%', gap: '10px' }}>
                    <button
                        className="secondary full-width"
                        onClick={() => {
                            if (!managerRef.current) {
                                addToast("Please start the camera first!", "warning");
                                return;
                            }
                            startCalibration();
                        }}
                        style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        title="Launch the calibration wizard for body and face"
                    >
                        <MagicWand size={16} weight="duotone" /> Wizard
                    </button>
                    <button
                        className={`secondary full-width ${isGreenScreen ? 'active' : ''}`}
                        onClick={toggleGreenScreen}
                        aria-pressed={isGreenScreen}
                        style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        title="Toggle Green Screen Background"
                    >
                        <Rectangle size={16} weight="fill" style={{ color: '#00ff00' }} /> Green Screen
                    </button>
                </div>
            )}

            <button
                className={`secondary full-width ${isSelfieMode ? 'active' : ''}`}
                onClick={toggleSelfieMode}
                disabled={faceMaskEnabled}
                aria-pressed={isSelfieMode}
                style={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                title="Follow head motion with the camera"
            >
                <UserFocus size={16} weight="duotone" /> Selfie Mode
            </button>

            <button
                className={`secondary full-width ${faceMaskEnabled ? 'active' : ''}`}
                onClick={() => toggleFaceMask(false)}
                disabled={isStarting}
                aria-pressed={faceMaskEnabled}
                style={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                title="Use the front camera to composite and drive the loaded VRM head"
            >
                <MagicWand size={16} weight="duotone" /> {faceMaskEnabled ? 'Face Overlay: On' : 'Face Overlay'}
            </button>

            {faceMaskEnabled && (
                <div className="mocap-mask-controls" aria-label="Face AR manual adjustments">
                    <div className="mocap-mask-controls__header">
                        <span>Mask Adjust</span>
                        <div className="mocap-mask-controls__actions">
                            <button
                                type="button"
                                className="secondary"
                                onClick={saveFaceMaskCalibration}
                                title="Save the current straight-ahead face as neutral for this avatar and camera"
                            >
                                Calibrate
                            </button>
                            <button
                                type="button"
                                className={`secondary ${faceMaskDebug ? 'active' : ''}`}
                                onClick={() => setFaceMaskDebug((current) => !current)}
                                aria-pressed={faceMaskDebug}
                                title="Show face bounds, target anchor, and neck crop markers in the canvas"
                            >
                                Debug
                            </button>
                            <button
                                type="button"
                                className="secondary"
                                onClick={resetFaceMaskAdjustments}
                                title="Reset mask offset, lift, size, depth, backset, and crop"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                    {([
                        { key: 'offsetX', label: 'Horizontal', min: -0.9, max: 0.9, step: 0.01 },
                        { key: 'offsetY', label: 'Vertical', min: -0.9, max: 1.4, step: 0.01 },
                        { key: 'lift', label: 'Head Lift', min: -0.6, max: 1.2, step: 0.01 },
                        { key: 'scale', label: 'Size', min: 0.25, max: 3.4, step: 0.01 },
                        { key: 'depth', label: 'Depth', min: -1.4, max: 2.2, step: 0.01 },
                        { key: 'backset', label: 'Backset', min: -0.8, max: 4.0, step: 0.01 },
                        { key: 'crop', label: 'Neck Crop', min: -0.4, max: 0.9, step: 0.01 },
                    ] as Array<{ key: keyof FaceMaskAdjustments; label: string; min: number; max: number; step: number }>).map((control) => (
                        <label className="mocap-mask-slider" key={control.key}>
                            <span>
                                {control.label}
                                <strong>{formatMaskValue(control.key, faceMaskAdjustments[control.key])}</strong>
                            </span>
                            <input
                                type="range"
                                min={control.min}
                                max={control.max}
                                step={control.step}
                                value={faceMaskAdjustments[control.key]}
                                onChange={(event) => updateFaceMaskAdjustment(control.key, Number(event.target.value))}
                            />
                        </label>
                    ))}
                </div>
            )}

            {!isActive && (
                <button
                    className={`secondary full-width ${isGreenScreen ? 'active' : ''}`}
                    onClick={toggleGreenScreen}
                    aria-pressed={isGreenScreen}
                    style={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    title="Toggle Green Screen Background"
                >
                    <Rectangle size={16} weight="fill" style={{ color: '#00ff00' }} /> Green Screen
                </button>
            )}

            {(arSupported || isARActive || isARStarting || vrSupported || isVRActive) && (
                <div className="mocap-xr-actions">
                    {vrSupported && (
                        <button
                            className={`secondary full-width ${isVRActive ? 'active' : ''}`}
                            onClick={isVRActive ? exitVR : enterVR}
                            disabled={isVRStarting || isARActive || isARStarting}
                            aria-pressed={isVRActive}
                            title="Use your headset and controllers to pose the loaded VRM avatar"
                        >
                            <UserFocus size={16} weight="duotone" />
                            {isVRActive ? 'Exit VR Tracking' : isVRStarting ? 'Starting VR...' : 'Enter VR Tracking'}
                        </button>
                    )}
                    {(arSupported || isARActive || isARStarting) && !isActive && !isVRActive && (
                        <button
                            className={`secondary full-width ${isARActive ? 'active' : ''}`}
                            onClick={isARActive ? exitAR : startAR}
                            disabled={isARStarting}
                            aria-pressed={isARActive}
                            aria-busy={isARStarting}
                            title={isARActive ? "End the active AR session" : "Start an immersive AR session if this browser and device allow it"}
                        >
                            <MagicWand size={16} weight="fill" style={{ color: '#00ffff' }} />
                            {isARActive ? 'Exit AR Mode' : isARStarting ? 'Starting AR...' : 'Enter AR Mode'}
                        </button>
                    )}
                    {isARActive && arVisibility === 'hidden' && (
                      <p className="muted small" role="status" aria-live="polite">
                        AR is paused while the headset or camera view is hidden.
                      </p>
                    )}
                </div>
            )}
        </div>

        {/* Calibration Wizard Overlay */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {isCalibrationActive && <CalibrationWizard manager={managerRef.current} />}
      </div>
      
      <div className="tab-section">
        <h3>VMC Input</h3>
        <p className="muted small">
          Connect to a local VMC bridge (OSC → WebSocket) to drive the avatar from XR Animator or Warudo.
        </p>

        <label className="small muted" htmlFor="vmc-url">WebSocket URL</label>
        <input
          id="vmc-url"
          className="full-width"
          value={vmcWebSocketUrl}
          onChange={(event) => setVmcWebSocketUrl(event.target.value)}
          placeholder="ws://localhost:39540"
          style={{ marginBottom: '10px' }}
        />

        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <button
            className={`primary full-width ${vmcEnabled ? 'secondary' : ''}`}
            onClick={() => setVmcEnabled(!vmcEnabled)}
            aria-pressed={vmcEnabled}
            disabled={vmcStatus === 'connecting'}
          >
            {vmcStatus === 'connecting' ? 'Connecting VMC...' : vmcEnabled ? 'Disconnect VMC' : 'Connect VMC'}
          </button>
          
          {vmcEnabled && vmcStatus === 'connected' && (
              <button
                className="secondary full-width"
                onClick={() => {
                    if (managerRef.current) {
                        managerRef.current.recalibrateVMC();
                        addToast("Calibrated VMC position to center.", "success");
                    }
                }}
                title="Recalibrate VMC drift (sets current position as center)"
              >
                Recalibrate Center
              </button>
          )}
        </div>

        <div className="small muted">
          Status: <strong className={`mocap-status-pill is-${vmcLabel}`}>{vmcLabel}</strong>
          {vmcError && <div className="error-message" style={{ marginTop: '6px' }}>{vmcError}</div>}
        </div>
      </div>

      <div className="tab-section">
          <h3>Instructions</h3>
          <ul className="small muted" style={{ paddingLeft: '1.2rem' }}>
              <li><strong>Upper Body:</strong> Track face, hands, and arms without lower-body tracking.</li>
              <li><strong>Face AR:</strong> Uses the front camera as a live backdrop and replaces the tracked human head with the loaded VRM head.</li>
              <li><strong>Full Body:</strong> Stand back so your head, torso, legs, and hands are visible.</li>
              <li><strong>Calibration:</strong> Use the <strong>Wizard</strong> button to align your body and gaze.</li>
              <li>If the camera stops immediately, check browser camera permissions and close other apps using the camera.</li>
              <li>Ensure good lighting on your face.</li>
          </ul>
      </div>

      {/* Voice Lip Sync Section */}
      <div className="tab-section">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Microphone size={18} weight="duotone" /> Voice Lip Sync</h3>
        <p className="muted small">
          Use your microphone to drive mouth movements. Works alongside or instead of camera face tracking.
        </p>

        <button 
          className={`primary full-width ${isVoiceLipSyncActive ? 'secondary' : ''}`}
          onClick={toggleVoiceLipSync}
          disabled={isVoiceStarting}
          aria-pressed={isVoiceLipSyncActive}
          style={{ marginBottom: '12px' }}
        >
          {isVoiceLipSyncActive ? <><StopCircle size={16} weight="fill" /> Stop Voice Sync</> : isVoiceStarting ? <><Microphone size={16} weight="duotone" /> Starting Voice...</> : <><Microphone size={16} weight="duotone" /> Start Voice Sync</>}
        </button>

        {isVoiceLipSyncActive && (
          <>
            {/* Volume meter */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '4px' 
              }}>
                <span className="small">Volume</span>
                <span className="small muted">{Math.round(voiceVolume * 100)}%</span>
              </div>
              <div style={{
                height: '8px',
                background: 'var(--bg-input)',
                borderRadius: '4px',
                overflow: 'hidden'
              }} role="meter" aria-label="Voice volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(voiceVolume * 100)}>
                <div style={{
                  height: '100%',
                  width: `${voiceVolume * 100}%`,
                  background: voiceVolume > 0.5 
                    ? 'var(--accent-warning)' 
                    : 'var(--accent-success)',
                  transition: 'width 50ms ease-out',
                  borderRadius: '4px'
                }} />
              </div>
            </div>

            {/* Sensitivity slider */}
            <div>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '4px' 
              }}>
                <span className="small">Sensitivity</span>
                <span className="small muted">{voiceSensitivity.toFixed(1)}x</span>
              </div>
              <input 
                type="range"
                min="0.5"
                max="5"
                step="0.1"
                value={voiceSensitivity}
                onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}

        <p className="small muted" style={{ marginTop: '12px', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
          <Lightbulb size={14} weight="duotone" style={{ flexShrink: 0, marginTop: '2px' }} /> 
          <span><strong>Tip:</strong> Voice lip sync can run simultaneously with camera mocap for best results - 
          camera tracks face expressions while microphone drives precise mouth movements.</span>
        </p>
      </div>
    </div>
  );
}
