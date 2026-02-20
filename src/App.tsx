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
import { ConnectionProgressPanel } from './components/ConnectionProgressPanel';
import { AIAgentWidget } from './components/AIAgentWidget';
import { SessionHUD } from './components/SessionHUD';
import { MobileWelcomeModal } from './components/MobileWelcomeModal';
import { GearSix, X } from '@phosphor-icons/react';

// import { LobbyPanel } from './components/LobbyPanel';

// Initialize multiplayer avatar bridge on app startup
initAvatarBridge();

const IS_DEV = import.meta.env.DEV;

function App() {
  const { mode, setMode, mobileDrawerOpen, setMobileDrawerOpen, focusModeActive } = useUIStore();
  const streamMode = useUIStore((state) => state.streamMode);
  const { theme, locale, textScale, autosaveEnabled, autosaveIntervalMinutes, autosaveMaxEntries } = useSettingsStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 960);

  // Handle body transparency for Stream Mode
  useEffect(() => {
    if (streamMode) {
      // Force transparent background on body and html to allow OBS transparency
      document.body.style.backgroundColor = 'transparent';
      document.documentElement.style.backgroundColor = 'transparent';
    } else {
      document.body.style.backgroundColor = '';
      document.documentElement.style.backgroundColor = '';
    }
    
    return () => {
      document.body.style.backgroundColor = '';
      document.documentElement.style.backgroundColor = '';
    };
  }, [streamMode]);

  useEffect(() => {
    // Apply theme to HTML element
    const root = document.documentElement;
    if (theme !== 'system') {
      root.setAttribute('data-theme', theme);
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const applyTheme = () => {
      root.setAttribute('data-theme', mediaQuery.matches ? 'light' : 'dark');
    };

    applyTheme();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', applyTheme);
      return () => mediaQuery.removeEventListener('change', applyTheme);
    }

    mediaQuery.addListener(applyTheme);
    return () => mediaQuery.removeListener(applyTheme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const baseSize = 16;
    document.documentElement.style.fontSize = `${baseSize * textScale}px`;
  }, [textScale]);

  useEffect(() => {
    if (!autosaveEnabled) return undefined;
    const intervalMs = autosaveIntervalMinutes * 60 * 1000;
    if (intervalMs <= 0) return undefined;

    const saveSnapshot = () => {
      const project = projectManager.serializeProject('Autosave');
      autosaveManager.addAutosave(project, autosaveMaxEntries);
    };

    saveSnapshot();
    const intervalId = window.setInterval(saveSnapshot, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [autosaveEnabled, autosaveIntervalMinutes, autosaveMaxEntries]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 960);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Trigger resize when layout modes change to ensure 3D canvas fills the space
  useEffect(() => {
    // Small timeout to allow CSS transition/reflow to complete
    const timeout = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timeout);
  }, [streamMode, focusModeActive, mobileDrawerOpen]);

  // Handle URL parameters for auto-stream mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stream') === 'true' || params.get('clean') === 'true') {
      useUIStore.getState().setStreamMode(true);
    }
  }, []);

  // Handle Esc to exit Stream Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUIStore.getState().streamMode) {
        // Prevent if default prevented (e.g. closing a modal)
        if (e.defaultPrevented) return;
        useUIStore.getState().setStreamMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`app-shell ${focusModeActive ? 'focus-mode' : ''} ${streamMode ? 'stream-mode' : ''}`}>
      <AppHeader mode={mode} onModeChange={setMode} />
      
      <main className="layout">
        <section className="viewport">
          <ErrorBoundary>
            <CanvasStage />
            <ViewportEffectOverlay />
            <ViewportOverlay mode={mode} />
          </ErrorBoundary>
        </section>

        {!isMobile && <ControlPanel mode={mode} />}
      </main>

      {/* Exit Stream Mode Button */}
      {streamMode && (
        <button 
          className="exit-stream-mode-btn"
          onClick={() => useUIStore.getState().setStreamMode(false)}
          title="Exit Virtual Cam Mode (Esc)"
        >
          Exit Virtual Cam Mode
        </button>
      )}

      {/* Mobile drawer toggle */}
      {isMobile && (
        <button
          className={`control-toggle ${mobileDrawerOpen ? 'open' : ''}`}
          onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
          aria-label={mobileDrawerOpen ? 'Close Controls' : 'Open Controls'}
        >
          {mobileDrawerOpen ? <X size={24} weight="bold" /> : <GearSix size={24} weight="bold" />}
        </button>
      )}

      {/* Mobile Backdrop */}
      {isMobile && mobileDrawerOpen && (
        <div 
          className="drawer-backdrop" 
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <div className={`control-drawer ${mobileDrawerOpen ? 'open' : ''}`}>
          <ControlPanel mode={mode} />
        </div>
      )}

      <ToastHost />
      <ConnectionProgressPanel />
      {IS_DEV && <AIAgentWidget />}
      <SessionHUD />
      <MobileWelcomeModal />
      {/* <LobbyPanel /> */}
    </div>
  );
}

export default App;
