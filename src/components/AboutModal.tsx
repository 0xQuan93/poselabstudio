import { 
  X, 
  Users, 
  Microphone, 
  Camera, 
  Sparkle,
  VideoCamera,
  FilmSlate,
  Cube,
  Brain,
  GithubLogo,
  TwitterLogo
} from '@phosphor-icons/react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <button className="modal-close" onClick={onClose}><X size={20} weight="bold" /></button>
        
        <h2 style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px',
          color: 'var(--signal-green, var(--accent))',
          textShadow: '0 0 20px rgba(0, 255, 214, 0.3)'
        }}>
          <img 
            src="/logo/poselab.svg" 
            alt="PoseLab" 
            style={{ 
              width: '32px', 
              height: '32px',
              filter: 'drop-shadow(0 0 10px rgba(0, 255, 214, 0.4))'
            }} 
          />
          PoseLab
        </h2>
        
        <div className="modal-body">
          <p className="lead" style={{ fontSize: '1.1rem', opacity: 0.9 }}>
            The ultimate browser-based VRM avatar studio for creating, posing, animating, and streaming.
          </p>
          
          <h3 style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkle size={18} weight="duotone" /> Core Features
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '8px' }}>
            <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Users size={18} weight="duotone" style={{ color: 'var(--accent)' }} />
              <span><strong>Multiplayer Co-op:</strong> Real-time P2P sessions with WebRTC</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Microphone size={18} weight="duotone" style={{ color: 'var(--accent)' }} />
              <span><strong>Voice Chat & Lip Sync:</strong> Live voice with mouth animations</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <VideoCamera size={18} weight="duotone" style={{ color: 'var(--accent)' }} />
              <span><strong>Webcam Mocap:</strong> Full body & face tracking via MediaPipe</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FilmSlate size={18} weight="duotone" style={{ color: 'var(--accent)' }} />
              <span><strong>FBX/GLTF Loading:</strong> Mixamo animation retargeting</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Camera size={18} weight="duotone" style={{ color: 'var(--accent)' }} />
              <span><strong>Cinematic Export:</strong> PNG, WebM video, GLB with effects</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Cube size={18} weight="duotone" style={{ color: 'var(--accent)' }} />
              <span><strong>Post-Processing:</strong> Bloom, color grading, film overlays</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Brain size={18} weight="duotone" style={{ color: 'var(--accent)' }} />
              <span><strong>Pose Lab:</strong> Timeline keyframes, gizmos, and expression editing</span>
            </li>
          </ul>

          <h3 style={{ marginTop: '1.5rem' }}>Hotkeys</h3>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '6px' }}>
            <li><strong>Space:</strong> Save a snapshot PNG</li>
            <li><strong>P:</strong> Export PNG with effects</li>
            <li><strong>1 / 3 / 5 / 7:</strong> Camera presets (headshot, 3/4, side, home)</li>
            <li><strong>2:</strong> Toggle Pose Lab rotate gizmo</li>
            <li><strong>R:</strong> Reset pose</li>
            <li><strong>S:</strong> Stop animation</li>
            <li><strong>Arrow keys:</strong> Trigger reaction presets (Live Controls)</li>
            <li><strong>Ctrl/Cmd + S:</strong> Save project</li>
            <li><strong>Ctrl/Cmd + O:</strong> Load project</li>
            <li><strong>Esc:</strong> Turn off gizmo tools</li>
          </ul>

          <h3 style={{ marginTop: '1.5rem' }}>About</h3>
          <p style={{ opacity: 0.85, lineHeight: 1.6 }}>
            PoseLab is an open-source initiative by Project 89 to democratize VRM avatar creation and animation. 
            Built entirely in the browser using Three.js, React, and WebRTC - no downloads or accounts required.
          </p>
          
          <div style={{ 
            marginTop: '1.5rem', 
            padding: '1rem', 
            background: 'rgba(0, 255, 214, 0.05)', 
            borderRadius: '8px',
            border: '1px solid rgba(0, 255, 214, 0.15)'
          }}>
            <a 
              href="https://github.com/0xQuan93/project89-reaction-forge" 
              target="_blank" 
              rel="noopener noreferrer" 
              style={{ 
                color: 'var(--accent)', 
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600
              }}
            >
              <GithubLogo size={20} weight="duotone" />
              Contribute on GitHub
            </a>
          </div>

          <div style={{ 
            marginTop: '0.75rem', 
            padding: '1rem', 
            background: 'rgba(124, 58, 237, 0.05)', 
            borderRadius: '8px',
            border: '1px solid rgba(124, 58, 237, 0.15)'
          }}>
            <a 
              href="https://x.com/poselabstudio" 
              target="_blank" 
              rel="noopener noreferrer" 
              style={{ 
                color: 'var(--violet)', 
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600
              }}
            >
              <TwitterLogo size={20} weight="duotone" />
              Follow @poselabstudio
            </a>
          </div>
          
          <div className="version-info" style={{ marginTop: '1.5rem', opacity: 0.6 }}>
            <small>Version 1.2.0 • Phosphor Icons • Orbitron Typography</small>
          </div>
        </div>
      </div>
    </div>
  );
}
