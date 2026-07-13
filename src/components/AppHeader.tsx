import { useRef, useState } from 'react';
import { useAvatarSource } from '../state/useAvatarSource';
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
  Atom,
  Flask,
  Fire,
  List,
  Question,
  ArrowCounterClockwise,
  DotsThreeVertical,
  UploadSimple
} from '@phosphor-icons/react';
import { useUIStore } from '../state/useUIStore';

import { LoginButton } from './auth/LoginButton';

interface AppHeaderProps {
  mode: 'reactions' | 'poselab' | 'studio';
  onModeChange: (mode: 'reactions' | 'poselab' | 'studio') => void;
}

export function AppHeader({ mode, onModeChange }: AppHeaderProps) {
  const vrmInputRef = useRef<HTMLInputElement>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const { setFileSource, sourceLabel } = useAvatarSource();
  const { addToast } = useToastStore();
  const { recordExploration, user } = useUserStore();
  const resetSceneSettings = useSceneSettingsStore((state) => state.resetAll);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);

  const handleModeChange = (newMode: 'reactions' | 'poselab' | 'studio') => {
    onModeChange(newMode);
    avatarManager.setVisibility(true);

    if (user) {
      recordExploration(`explore_mode_${newMode}`).then(reward => {
        if (reward > 0) addToast(`Explorer Bonus: +${reward} LP!`, 'success');
      });
    }
  };

  const handleResetScene = () => {
    if (confirm('Reset scene?')) {
      resetSceneSettings();
      sceneManager.resetCamera();
      avatarManager.resetPose();
      addToast('Scene reset', 'info');
    }
  };

  return (
    <>
      <header className="app-header">
        <div className="app-header__left">
          <button type="button" className="app-header__logo" onClick={() => handleModeChange('reactions')} aria-label="Go to Reactions home">
            <img src="/logo/poselab.svg" alt="PoseLab" />
            <span>PoseLab</span>
          </button>
          <div className="mode-switch" data-tutorial-id="mode-switch">
            <button className={mode === 'reactions' ? 'active' : ''} onClick={() => handleModeChange('reactions')}>
              <Atom size={16} weight="duotone" />
              <span>Reactions</span>
            </button>
            <button className={mode === 'poselab' ? 'active' : ''} onClick={() => handleModeChange('poselab')}>
              <Flask size={16} weight="duotone" />
              <span>Pose Lab</span>
            </button>
            <button className={mode === 'studio' ? 'active' : ''} onClick={() => handleModeChange('studio')}>
              <Fire size={16} weight="duotone" />
              <span>Studio</span>
            </button>
          </div>
        </div>

        <div className="app-header__center desktop-avatar-loader">
          <button className="avatar-selector__button primary" onClick={() => vrmInputRef.current?.click()}>
            {sourceLabel || 'Load Avatar'}
          </button>
          <input ref={vrmInputRef} type="file" accept=".vrm" onChange={(e) => e.target.files?.[0] && setFileSource(e.target.files[0])} style={{ display: 'none' }} />
        </div>

        <div className="app-header__right">
          <div className="desktop-header-actions">
            <button className="icon-button" aria-label="About and help" title="About and help" onClick={() => setShowAbout(true)}><Question size={20} /></button>
            <button className="icon-button" aria-label="Reset scene" title="Reset scene" onClick={handleResetScene}><ArrowCounterClockwise size={20} /></button>
            <button className="icon-button" aria-label="Open settings" onClick={() => setShowSettings(true)}><GearSix size={20} /></button>
            <button className="icon-button" aria-label="Save project" onClick={handleProjectSave}><FloppyDisk size={20} /></button>
            <button className="icon-button" aria-label={sidebarOpen ? 'Close tools panel' : 'Open tools panel'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><List size={20} /></button>
          </div>
          <div className="mobile-header-menu">
            <button className="icon-button" aria-label="Open app menu" aria-expanded={showMobileMenu} onClick={() => setShowMobileMenu(!showMobileMenu)}><DotsThreeVertical size={22} /></button>
            {showMobileMenu && (
              <div className="mobile-header-menu__popover" role="menu">
                <button role="menuitem" onClick={() => { vrmInputRef.current?.click(); setShowMobileMenu(false); }}><UploadSimple size={18} /> Load avatar</button>
                <button role="menuitem" onClick={() => { setShowAbout(true); setShowMobileMenu(false); }}><Question size={18} /> About & help</button>
                <button role="menuitem" onClick={() => { setShowSettings(true); setShowMobileMenu(false); }}><GearSix size={18} /> Settings</button>
                <button role="menuitem" onClick={() => { handleProjectSave(); setShowMobileMenu(false); }}><FloppyDisk size={18} /> Save project</button>
                <button role="menuitem" onClick={() => { setShowMobileMenu(false); handleResetScene(); }}><ArrowCounterClockwise size={18} /> Reset scene</button>
              </div>
            )}
          </div>
          <LoginButton />
        </div>
      </header>
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );

  function handleProjectSave() {
    projectManager.downloadProject("My Project");
    addToast("Project saved", "success");
  }
}
