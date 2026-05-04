import { useEffect, useRef, useState, useCallback } from 'react';
import { sceneManager } from '../three/sceneManager';
import { avatarManager } from '../three/avatarManager';
import { useReactionStore } from '../state/useReactionStore';
import { useUIStore } from '../state/useUIStore';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';
import { useIntroStore } from '../state/useIntroStore';
import type { ReactionPreset } from '../types/reactions';
import { findPresetById } from '../data/reactions';
import { useAvatarSource } from '../state/useAvatarSource';
import { live2dManager } from '../live2d/live2dManager';
import { getMocapManager } from '../utils/mocapInstance';
import { voiceLipSync } from '../utils/voiceLipSync';
import { OnboardingOverlay } from './OnboardingOverlay';
import { useMultiplayerStore } from '../state/useMultiplayerStore';
import { multiAvatarManager } from '../three/multiAvatarManager';
import { syncManager } from '../multiplayer/syncManager';
import { introSequence } from '../intro/IntroSequence';
import { Warning } from '@phosphor-icons/react';
import { useToastStore } from '../state/useToastStore';
import { getPoseLabTimestamp } from '../utils/exportNaming';

// Simple Toast Component for Errors
function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="toast-notification error" style={{
      position: 'fixed',
      top: '1rem',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(255, 50, 50, 0.1)',
      border: '1px solid #ff4444',
      color: '#ff4444',
      padding: '0.75rem 1.5rem',
      borderRadius: '25px',
      backdropFilter: 'blur(10px)',
      zIndex: 2000,
      fontWeight: 600,
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
      animation: 'slideDown 0.3s ease-out'
    }}>
      <Warning size={18} weight="fill" /> {message}
    </div>
  );
}

import { interactionManager } from '../three/interactionManager';

export function CanvasStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const presetId = useReactionStore((state) => state.activePreset.id);
  const animationMode = useReactionStore((state) => state.animationMode);
  const liveControlsEnabled = useReactionStore((state) => state.liveControlsEnabled);
  const setPresetById = useReactionStore((state) => state.setPresetById);
  const { addToast } = useToastStore();
  const { currentUrl, avatarType, live2dSource } = useAvatarSource();
  const activeCssOverlay = useUIStore((state) => state.activeCssOverlay);
  const rotationLocked = useSceneSettingsStore((state) => state.rotationLocked);
  const setRotationLocked = useSceneSettingsStore((state) => state.setRotationLocked);
  const setRotationLockedCallback = useCallback(setRotationLocked, [setRotationLocked]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [avatarReady, setAvatarReady] = useState(false);

  const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  };

  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
      target.closest(
        'button, a, summary, label, input, textarea, select, option, [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="slider"], [role="tab"], [role="menuitem"], [data-kbar-search]'
      )
    );
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    sceneManager.init(canvas);

    const container = containerRef.current;
    if (container) {
      live2dManager.attachToCanvas(canvas, container).then(() => {
        live2dManager.setTickRegistrar(sceneManager.registerTick.bind(sceneManager));
      });
    }
    
    // Ensure avatar is in the new scene (if one is already loaded)
    avatarManager.rebindToScene();
    
    // Rebind multi-avatar manager for multiplayer
    multiAvatarManager.rebindToScene();
    
    // Initialize Interaction Manager (Gizmos)
    // We do this after scene init to ensure renderer exists
    // The lazy init in toggle() usually handles it, but this ensures events are bound if enabled
    if (interactionManager.enabled) {
       // Force re-init if enabled, as we just re-created the renderer
       interactionManager.toggle(false);
       interactionManager.toggle(true);
    }

    return () => {
        sceneManager.dispose();
        live2dManager.dispose();
        avatarManager.clear();
        // interactionManager.dispose(); // Don't fully dispose, just detach? 
        // Ideally SceneManager handles renderer disposal, InteractionManager handles its own listeners
    };
  }, []);

  useEffect(() => {
    if (avatarType === 'none') {
      avatarManager.clear();
      live2dManager.dispose();
      getMocapManager()?.setVRM(null);
      voiceLipSync.setVRM(null);
      setAvatarReady(false);
      useReactionStore.setState({ isAvatarReady: false });
      return;
    }
    if (avatarType === 'vrm' && !currentUrl) return;
    if (avatarType === 'live2d' && !live2dSource?.manifestUrl) return;
    let cancelled = false;
    
    // Start Loading
    setAvatarReady(false);
    setIsLoading(true);
    setErrorMessage(null);
    console.log('[CanvasStage] Loading avatar from:', avatarType === 'vrm' ? currentUrl : live2dSource?.manifestUrl);
    
    const loadAvatar = async () => {
      try {
        if (avatarType === 'live2d' && live2dSource) {
          avatarManager.clear();
          await live2dManager.load({
            manifestUrl: live2dSource.manifestUrl,
            manifestPath: live2dSource.manifestPath,
            label: live2dSource.manifestPath,
          });
        } else if (avatarType === 'vrm' && currentUrl) {
          live2dManager.dispose();
          // Load via avatarManager (original system)
          await avatarManager.load(currentUrl, setRotationLockedCallback);
          const loadedVRM = avatarManager.getVRM();
          if (loadedVRM) {
            getMocapManager()?.setVRM(loadedVRM);
            if (voiceLipSync.getIsActive()) {
              voiceLipSync.setVRM(loadedVRM);
            }
          }
        }
        
        if (cancelled) return;
        
        // If in multiplayer session, register with multiAvatarManager (don't re-load)
        const mpState = useMultiplayerStore.getState();
        if (avatarType === 'vrm' && mpState.isConnected && mpState.localPeerId) {
          const loadedVRM = avatarManager.getVRM();
          if (loadedVRM) {
            console.log('[CanvasStage] Registering avatar with multiplayer system');
            // Use registerExistingAvatar to avoid creating a duplicate
            multiAvatarManager.registerExistingAvatar(
              mpState.localPeerId,
              loadedVRM,
              true,
              mpState.localDisplayName
            );
            
            // Notify peers about our avatar
            mpState.updatePeer(mpState.localPeerId, { hasAvatar: true });
            syncManager.broadcastFullState();
            
            // Send our VRM to all connected peers (after a short delay for buffer to be ready)
            setTimeout(() => {
              mpState.peers.forEach((peer) => {
                if (!peer.isLocal) {
                  console.log(`[CanvasStage] Sending VRM to peer: ${peer.peerId}`);
                  syncManager.sendVRMToPeer(peer.peerId);
                }
              });
            }, 500);
          }
        }
        
        console.log('[CanvasStage] Avatar loaded successfully');
        setAvatarReady(true);
        useReactionStore.setState({ isAvatarReady: true });
        
        if (avatarType === 'vrm') {
          // Trigger intro sequence (or apply default pose if disabled)
          const introStore = useIntroStore.getState();
          
          if (introStore.enabled) {
            console.log('[CanvasStage] Playing intro sequence:', introStore.sequenceId);
            introStore.setPlaying(true);
            introSequence.play(introStore.sequenceId).then(() => {
              introStore.setPlaying(false);
            });
          } else {
            // Just apply sunset-call as default
            console.log('[CanvasStage] Intro disabled, applying default pose');
            await introSequence.applyDefaultPose();
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.error('[CanvasStage] Failed to load avatar:', error);
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load avatar file');
        setAvatarReady(false);
        useReactionStore.setState({ isAvatarReady: false });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    
    loadAvatar();
      
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarType, currentUrl, live2dSource?.manifestUrl, setRotationLockedCallback]);

  useEffect(() => {
    if (!avatarReady) return;
    // Don't re-apply preset if we are in manual posing mode
    // This prevents the avatar from snapping back to default pose when switching animation modes for gizmos
    if (avatarManager.isManualPosingEnabled()) return;

    const preset = findPresetById(presetId);
    if (!preset) return;

    console.log('[CanvasStage] Preset or animation mode changed, applying:', preset.id, animationMode);
    applyPreset(preset);
  }, [presetId, avatarReady, animationMode]);

  useEffect(() => {
    // Hotkeys logic
    // 1-4: Camera Presets (Head, Quarter, Side, Full)
    // 0: Reset Camera
    // Arrow Keys: Reaction Presets (when Live Mode is enabled)
    
    const arrowMap: Record<string, string> = {
      ArrowUp: 'sunset-call',
      ArrowDown: 'signal-reverie',
      ArrowLeft: 'simple-wave',
      ArrowRight: 'point',
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;

      // 1. Camera Hotkeys (Priority)
      // Standard number keys or Numpad keys (event.key handles both usually)
      switch (event.key) {
        case '1':
          sceneManager.setCameraPreset('headshot', true);
          return;
        case '2':
          sceneManager.setCameraPreset('quarter', true);
          return;
        case '3':
          sceneManager.setCameraPreset('side', true);
          return;
        case '4':
          sceneManager.setCameraPreset('fullbody', true);
          return;
        case '0':
          sceneManager.resetCamera();
          return;
      }

      // 2. Reaction Presets (Live Mode only)
      if (liveControlsEnabled && arrowMap[event.key]) {
        event.preventDefault();
        setPresetById(arrowMap[event.key]);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [avatarReady, liveControlsEnabled, setPresetById]);

  useEffect(() => {
    const handleCaptureKeyDown = async (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code !== 'Space') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;
      if (isInteractiveTarget(event.target)) return;

      event.preventDefault();

      if (!avatarReady) {
        addToast('Load an avatar before capturing.', 'warning');
        return;
      }

      const dataUrl = await sceneManager.captureSnapshot();
      if (!dataUrl) {
        addToast('Failed to capture snapshot.', 'error');
        return;
      }

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `PoseLab_${getPoseLabTimestamp()}_capture.png`;
      link.click();
      addToast('📸 Snapshot saved.', 'success');
    };

    window.addEventListener('keydown', handleCaptureKeyDown);
    return () => window.removeEventListener('keydown', handleCaptureKeyDown);
  }, [addToast, avatarReady]);


  
  const applyPreset = useCallback((currentPreset: ReactionPreset) => {
    // Use preset's animation settings or fall back to global animation mode
    const animated = currentPreset.animated ?? (animationMode !== 'static');
    const mode = currentPreset.animationMode ?? animationMode;
    console.log('[CanvasStage] Applying preset with animation:', { animated, mode });
    
    if (avatarType === 'vrm') {
      avatarManager.applyPose(currentPreset.pose, rotationLocked, animated, mode);
      avatarManager.applyExpression(currentPreset.expression);
    }
    
    // Only change background if not locked
    const { backgroundLocked } = useSceneSettingsStore.getState();
    if (!backgroundLocked) {
      sceneManager.setBackground(currentPreset.background);
    }
  }, [animationMode, avatarType, rotationLocked]);

  useEffect(() => {
    if (!avatarReady) return;
    // Don't re-apply preset if we are in manual posing mode
    // This prevents the avatar from snapping back to default pose when switching animation modes for gizmos
    if (avatarManager.isManualPosingEnabled()) return;

    const preset = findPresetById(presetId);
    if (!preset) return;

    console.log('[CanvasStage] Preset or animation mode changed, applying:', preset.id, animationMode);
    applyPreset(preset);
  }, [presetId, avatarReady, animationMode, applyPreset]);

  useEffect(() => {
    const handleCaptureKeyDown = async (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code !== 'Space') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;
      if (isInteractiveTarget(event.target)) return;

      event.preventDefault();

      if (!avatarReady) {
        addToast('Load an avatar before capturing.', 'warning');
        return;
      }

      const dataUrl = await sceneManager.captureSnapshot();
      if (!dataUrl) {
        addToast('Failed to capture snapshot.', 'error');
        return;
      }

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `PoseLab_${getPoseLabTimestamp()}_capture.png`;
      link.click();
      addToast('📸 Snapshot saved.', 'success');
    };

    window.addEventListener('keydown', handleCaptureKeyDown);
    return () => window.removeEventListener('keydown', handleCaptureKeyDown);
  }, [addToast, avatarReady]);

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      data-tutorial-id="canvas-stage"
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <OnboardingOverlay />
      
      {isLoading && (
        <div className="loading-overlay" style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', zIndex: 20, backdropFilter: 'blur(5px)',
          flexDirection: 'column', gap: '1rem'
        }}>
          <div className="spinner" style={{
            width: '40px', height: '40px', border: '3px solid rgba(0,255,214,0.3)',
            borderTopColor: '#00ffd6', borderRadius: '50%', animation: 'spin 1s linear infinite'
          }}></div>
          <span style={{ color: '#00ffd6', fontWeight: 600 }}>Loading Avatar...</span>
        </div>
      )}

      {errorMessage && (
        <ErrorToast message={errorMessage} onClose={() => setErrorMessage(null)} />
      )}

      <div className="viewport-halo" aria-hidden="true" />

      <canvas ref={canvasRef} className="canvas-stage" />

      {/* Render active CSS Overlay */}
      {activeCssOverlay && (
        <div 
          className={activeCssOverlay} 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      )}
    </div>
  );
}
