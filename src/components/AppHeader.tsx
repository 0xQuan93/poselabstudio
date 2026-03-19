import { useRef, useState, useEffect } from 'react';
import { useAvatarSource } from '../state/useAvatarSource';
import { useReactionStore } from '../state/useReactionStore';
import { useToastStore } from '../state/useToastStore';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';
import { useUserStore } from '../state/useUserStore';
import { sceneManager } from '../three/sceneManager';
import { avatarManager } from '../three/avatarManager';
import { AboutModal } from './AboutModal';
import { SettingsModal } from './SettingsModal';
import { projectManager } from '../persistence/projectManager';
import {
  GearSix,
  FloppyDisk,
  FolderOpen,
  Question,
  Atom,
  Flask,
  Broadcast,
  Fire,
  List,
  Monitor
} from '@phosphor-icons/react';
import { useUIStore } from '../state/useUIStore';
import { vrManager } from '../three/vrManager';

import { LoginButton } from './auth/LoginButton';

interface AppHeaderProps {
  mode: 'reactions' | 'poselab' | 'studio';
  onModeChange: (mode: 'reactions' | 'poselab' | 'studio') => void;
}

export function AppHeader({ mode, onModeChange }: AppHeaderProps) {
  const vrmInputRef = useRef<HTMLInputElement>(null);
  const live2dInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [vrSupported, setVrSupported] = useState(false);
  const [inVr, setInVr] = useState(false);
  const { avatarType, setFileSource, setLive2dSource, sourceLabel } = useAvatarSource();
  const isAvatarReady = useReactionStore((state) => state.isAvatarReady);
  const { addToast } = useToastStore();
  const { recordExploration, user } = useUserStore();
  const resetSceneSettings = useSceneSettingsStore((state) => state.resetAll);
  const setStreamMode = useUIStore((state) => state.setStreamMode);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);

  // Check VR support
  useEffect(() => {
    const checkVR = async () => {
      if (navigator.xr) {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        setVrSupported(supported);
      }
    };
    checkVR();
  }, []);

  const handleToggleVR = async () => {
    try {
      if (inVr) {
        await vrManager.exitVR();
        setInVr(false);
      } else {
        await vrManager.enterVR();
        setInVr(true);
        addToast('Entering VR...', 'success');
      }
    } catch (error) {
      addToast('Failed to toggle VR session', 'error');
    }
  };

  // Easter egg
  useEffect(() => {
    let keys = '';
    const handleKeyDown = (e: KeyboardEvent) => {
      keys += e.key;
      if (keys.length > 2) keys = keys.slice(1);
      if (keys === '89') {
        useUserStore.getState().recordGamifiedAction('easter_egg_89').then(reward => {
          if (reward > 0) {
            useToastStore.getState().addToast(`🥚 EASTER EGG FOUND! +${reward} LP!`, 'success');
          }
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleModeChange = (newMode: 'reactions' | 'poselab' | 'studio') => {
    onModeChange(newMode);

    // Reward for exploring different modes
    if (user) {
      recordExploration(`explore_mode_${newMode}`).then(reward => {
        if (reward > 0) {
          addToast(`Explorer Bonus: +${reward} LP for visiting ${newMode}! 🔥`, 'success');
        }
      });
    }
  };

  const handleResetScene = () => {
    if (confirm('Reset scene settings to default? This will clear lighting, effects, and background settings.')) {
      resetSceneSettings();
      // Also reset camera
      sceneManager.resetCamera();
      // And reset avatar pose if loaded
      avatarManager.resetPose();

      addToast('Scene reset to default', 'info');
    }
  };

  const handleVRMUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.vrm')) {
      addToast('Please select a VRM file', 'error');
      return;
    }

    setFileSource(file);
    useUserStore.getState().recordGamifiedAction('first_avatar_load').then(reward => {
      if (reward > 0) {
        addToast(`+${reward} LP for loading your first avatar!`, 'success');
      }
    });
  };

  const handleLive2dUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    event.target.value = '';

    const zipFile = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');
    if (zipFile) {
      addToast('ZIP bundles are not supported yet. Please select the .model3.json and texture files directly.', 'warning');
      return;
    }

    try {
      const label = files.find((file) => file.name.toLowerCase().endsWith('.model3.json'))?.name ?? 'Live2D Avatar';
      await setLive2dSource(files, label);
      addToast('Live2D avatar loaded successfully', 'success');
      useUserStore.getState().recordGamifiedAction('first_avatar_load').then(reward => {
        if (reward > 0) {
          addToast(`+${reward} LP for loading your first avatar!`, 'success');
        }
      });
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to load Live2D assets', 'error');
    }
  };

  const handleProjectLoad = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      
      const result = await projectManager.loadFromFile(file);
      if (result.success) {
          addToast("Project loaded", "success");
          // Show avatar warning if needed
          if (result.avatarWarning) {
            setTimeout(() => addToast(result.avatarWarning!, "warning"), 500);
          }
      } else {
          addToast("Failed to load project", "error");
      }
      // Reset input value to allow reloading same file
      event.target.value = '';
  };

  const handleProjectSave = () => {
      projectManager.downloadProject("My Project");
      addToast("Project saved", "success");
  };

  return (
    <>
      <header className="app-header">
        <div className="app-header__left">
          <div 
            className="app-header__logo" 
            onClick={handleResetScene} 
            title="Reset Scene Settings"
            style={{ cursor: 'pointer' }}
          >
            <img src="/logo/poselab.svg" alt="PoseLab" />
            <span>PoseLab</span>
          </div>
          <div className="mode-switch" data-tutorial-id="mode-switch">
            <button
              className={mode === 'reactions' ? 'active' : ''}
              onClick={() => handleModeChange('reactions')}
            >
              <Atom size={16} weight="duotone" />
              <span>Reactions</span>
            </button>
            <button
              className={mode === 'poselab' ? 'active' : ''}
              onClick={() => handleModeChange('poselab')}
            >
              <Flask size={16} weight="duotone" />
              <span>Pose Lab</span>
            </button>
            <button
              className={mode === 'studio' ? 'active' : ''}
              onClick={() => handleModeChange('studio')}
            >
              <Fire size={16} weight="duotone" />
              <span>Studio</span>
            </button>
          </div>
        </div>

        <div className="app-header__center">
          {avatarType !== 'none' ? (
            <div className="avatar-selector">
              <span className="avatar-selector__label">{sourceLabel}</span>
              <button
                className="avatar-selector__button"
                onClick={() => {
                  if (avatarType === 'live2d') {
                    live2dInputRef.current?.click();
                    return;
                  }
                  vrmInputRef.current?.click();
                }}
                title="Change avatar"
              >
                Change Avatar
              </button>
            </div>
          ) : (
            <button
              className="avatar-selector__button primary"
              onClick={() => vrmInputRef.current?.click()}
            >
              Load VRM Avatar
            </button>
          )}
          <input
            ref={vrmInputRef}
            type="file"
            accept=".vrm"
            onChange={handleVRMUpload}
            style={{ display: 'none' }}
          />
          <input
            ref={live2dInputRef}
            type="file"
            accept=".model3.json,.zip,.moc3,.json,image/*"
            multiple
            onChange={handleLive2dUpload}
            style={{ display: 'none' }}
          />
        </div>

        <div className="app-header__right">
          <div className="status-indicator">
            <span className={`status-dot ${isAvatarReady ? 'ready' : 'loading'}`} />
            <span className="status-text hide-mobile">{isAvatarReady ? 'Ready' : 'Loading...'}</span>
          </div>

          <button 
            className="icon-button"
            style={{ width: '32px', height: '32px', marginLeft: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <GearSix size={20} weight="duotone" />
          </button>
          
          <div className="hide-mobile" style={{ width: '1px', height: '20px', background: 'var(--border-color)', margin: '0 0.5rem' }}></div>

          <button 
            className="icon-button hide-mobile"
            style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={handleProjectSave}
            title="Save Project"
          >
            <FloppyDisk size={20} weight="duotone" />
          </button>
          
          {vrSupported && (
            <button 
              className={`icon-button ${inVr ? 'active' : ''}`}
              style={{ width: '32px', height: '32px', marginLeft: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: inVr ? 'var(--accent)' : 'inherit' }}
              onClick={handleToggleVR}
              title={inVr ? 'Exit VR' : 'Enter VR'}
            >
              <Monitor size={20} weight={inVr ? "fill" : "duotone"} />
            </button>
          )}
          <button 
            className="icon-button hide-mobile"
            style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => projectInputRef.current?.click()}
            title="Load Project"
          >
            <FolderOpen size={20} weight="duotone" />
          </button>
          
          <input
            ref={projectInputRef}
            type="file"
            accept=".pose,.json"
            onChange={handleProjectLoad}
            style={{ display: 'none' }}
          />

          <div className="hide-mobile" style={{ width: '1px', height: '20px', background: 'var(--border-color)', margin: '0 0.5rem' }}></div>

          <button 
            className="icon-button hide-mobile"
            style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => {
                setStreamMode(true);
                addToast("Stream Mode Active (Press Esc to exit)", "info");
            }}
            title="Virtual Camera / Stream Mode (Clean Output)"
          >
            <Broadcast size={20} weight="duotone" style={{ color: 'var(--accent)' }} />
          </button>

          <button 
            className="icon-button"
            style={{ width: '32px', height: '32px', marginLeft: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setShowAbout(true)}
            title="About PoseLab"
          >
            <Question size={20} weight="duotone" />
          </button>
          
          <div className="hide-mobile" style={{ width: '1px', height: '20px', background: 'var(--border-color)', margin: '0 0.5rem' }}></div>
          
          <button 
            className={`icon-button hide-mobile ${sidebarOpen ? 'active' : ''}`}
            style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '0.5rem' }}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle Sidebar"
          >
            <List size={20} weight="duotone" />
          </button>

          <LoginButton />
        </div>
      </header>
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
