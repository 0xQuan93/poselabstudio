import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PoseLab from './pose-lab/PoseLab'
import { setupAvatarBridge } from './bridge/avatarBridge'
import { CommandPalette } from './ui/CommandPalette'

console.log('[main] Starting PoseLab');

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('[main] Root element not found!');
  throw new Error('Root element not found');
}

const root = createRoot(rootElement);

const render = () => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  console.log('[main] Render mode:', mode || 'main-app');

  root.render(
    <StrictMode>
      <CommandPalette>
        {mode === 'pose-lab' ? <PoseLab /> : <App />}
      </CommandPalette>
    </StrictMode>
  );
};

setupAvatarBridge();
render();
