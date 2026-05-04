import './App.css';
import './components/overlays.css';
import { useState, useEffect } from 'react';
import { AppHeader } from './components/AppHeader';
import { CanvasStage } from './components/CanvasStage';
import { ViewportOverlay } from './components/ViewportOverlay';
import { ViewportEffectOverlay } from './components/ViewportEffectOverlay';
import { ControlPanel } from './components/ControlPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastHost } from './ui/Toast';
import { useUIStore } from './state/useUIStore';
import { useSettingsStore } from './state/useSettingsStore';
import { projectManager } from './persistence/projectManager';
import { autosaveManager } from './persistence/autosaveManager';
import { initAvatarBridge } from './multiplayer/avatarBridge';
import { initMocapManager } from './utils/mocapInstance';
import { ConnectionProgressPanel } from './components/ConnectionProgressPanel';
import { AIAgentWidget } from './components/AIAgentWidget';
import { SessionHUD } from './components/SessionHUD';
import { TickerTape } from './components/TickerTape';
import { MobileWelcomeModal } from './components/MobileWelcomeModal';
import { Fire } from '@phosphor-icons/react';
import { useDiscordActivity, isEmbeddedApp } from './hooks/useDiscordActivity';
import { CreatorFeed } from './components/feed/CreatorFeed';
import { StudioChatPanel } from './components/studio/StudioChatPanel';
import { WearableFitter } from './components/studio/WearableFitter';
import { useUserStore } from './state/useUserStore';

import { useAvatarSource } from './state/useAvatarSource';
import { useToastStore } from './state/useToastStore';

// Initialize multiplayer avatar bridge on app startup
initAvatarBridge();
initMocapManager();

const IS_DEV = import.meta.env.DEV;

function App() {
  const { isReady, error, discordSdk } = useDiscordActivity();
  const { mode, setMode, focusModeActive, sidebarOpen } = useUIStore();
  const streamMode = useUIStore((state) => state.streamMode);
  const { theme, locale, textScale, autosaveEnabled, autosaveIntervalMinutes, autosaveMaxEntries } = useSettingsStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 960);
  const [isDragging, setIsDragging] = useState(false);
  const user = useUserStore((state) => state.user);
  const { setFileSource } = useAvatarSource();
  const { addToast } = useToastStore();

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.toLowerCase().endsWith('.vrm')) {
          setFileSource(file);
          addToast(`Loading ${file.name}...`, 'info');
        } else {
          addToast('Only .vrm files supported via drag and drop.', 'warning');
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [setFileSource, addToast]);

  useEffect(() => {
    if (isReady && isEmbeddedApp && discordSdk && user) {
      const level = Math.floor(user.lp / 100) + 1;
      let modeName = 'Reaction Forge';
      if (mode === 'studio') modeName = 'Browsing the Studio Feed';
      else if (mode === 'poselab') modeName = 'Crafting Poses in Pose Lab';
      else if (mode === 'wearables') modeName = 'Fitting Wearables';
      else if (mode === 'reactions') modeName = 'Triggering Reactions';

      discordSdk.commands.setActivity({
        activity: {
          type: 0,
          details: modeName,
          state: `Level ${level} | ${user.lp.toLocaleString()} LP`,
        }
      }).catch((err) => console.error('Failed to sync Activity', err));
    }
  }, [isReady, discordSdk, user, mode]);

  useEffect(() => {
    if (streamMode) {
      document.body.style.backgroundColor = 'transparent';
      document.documentElement.style.backgroundColor = 'transparent';
    } else {
      document.body.style.backgroundColor = '';
      document.documentElement.style.backgroundColor = '';
    }
  }, [streamMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme !== 'system') {
      root.setAttribute('data-theme', theme);
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const applyTheme = () => root.setAttribute('data-theme', mediaQuery.matches ? 'light' : 'dark');
    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [theme]);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  useEffect(() => {
    const baseSize = 16;
    document.documentElement.style.fontSize = `${baseSize * textScale}px`;
  }, [textScale]);

  useEffect(() => {
    if (!autosaveEnabled) return;
    const intervalMs = autosaveIntervalMinutes * 60 * 1000;
    const saveSnapshot = () => {
      const project = projectManager.serializeProject('Autosave', false);
      autosaveManager.addAutosave(project, autosaveMaxEntries);
    };
    const intervalId = window.setInterval(saveSnapshot, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [autosaveEnabled, autosaveIntervalMinutes, autosaveMaxEntries]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 960);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (isEmbeddedApp && error) return <div>Error: {error.message}</div>;
  if (isEmbeddedApp && !isReady) return <div>Loading...</div>;

  return (
    <div className={`app-shell ${focusModeActive ? 'focus-mode' : ''} ${streamMode ? 'stream-mode' : ''}`}>
      <AppHeader mode={mode} onModeChange={setMode} />

      {isDragging && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-content">
            <Fire size={48} weight="duotone" className="drag-icon" />
            <h2>Drop VRM to Load</h2>
          </div>
        </div>
      )}

      <main className={`layout ${mode === 'studio' ? 'studio-layout' : ''} ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        <div className="studio-mode-wrapper" style={{ display: mode === 'studio' ? 'flex' : 'none', flex: 1 }}>
          <CreatorFeed />
        </div>

        {mode === 'studio' && <StudioChatPanel />}

        <section className="viewport" style={{ display: mode === 'studio' ? 'none' : 'flex' }}>
          <ErrorBoundary>
            <CanvasStage />
            <ViewportEffectOverlay />
            {mode === 'wearables' && <WearableFitter />}
            {(mode === 'reactions' || mode === 'poselab') && <ViewportOverlay mode={mode} />}
          </ErrorBoundary>
        </section>

        {!isMobile && mode !== 'wearables' && (
          <div className={`desktop-sidebar ${!sidebarOpen ? 'closed' : ''}`} style={{ display: mode === 'studio' ? 'none' : 'block' }}>
            <ControlPanel mode={mode} />
          </div>
        )}
      </main>

      <ToastHost />
      <ConnectionProgressPanel />
      {IS_DEV && <AIAgentWidget />}
      <SessionHUD />
      <MobileWelcomeModal />
      <TickerTape />
    </div>
  );
}

export default App;
