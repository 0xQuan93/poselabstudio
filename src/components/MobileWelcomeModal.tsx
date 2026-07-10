import { useState, useEffect, useRef } from 'react';
import { DeviceMobile, HandTap, X } from '@phosphor-icons/react';

export function MobileWelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if mobile
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches;
    
    // Check if already seen in this session
    let hasSeen = false;
    try {
      hasSeen = sessionStorage.getItem('poselab_mobile_welcome_seen') === 'true';
    } catch {
      // Storage can be unavailable in private or embedded browsing contexts.
    }

    if (isMobile && !hasSeen) {
      setIsOpen(true);
    }
  }, []);

  function handleClose() {
    setIsOpen(false);
    try {
      sessionStorage.setItem('poselab_mobile_welcome_seen', 'true');
    } catch {
      // Closing the dialog should never depend on storage access.
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay mobile-welcome-overlay" style={{ zIndex: 2000 }}>
      <div
        ref={dialogRef}
        className="modal-content mobile-welcome-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-welcome-title"
        aria-describedby="mobile-welcome-description"
        tabIndex={-1}
      >
        <button className="modal-close" onClick={handleClose} aria-label="Close mobile welcome">
          <X size={24} />
        </button>
        
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          marginBottom: '1.5rem',
          color: 'var(--accent)'
        }}>
          <DeviceMobile size={64} weight="duotone" />
        </div>

        <h2 id="mobile-welcome-title" style={{
          fontFamily: 'var(--font-display)', 
          fontSize: '1.5rem', 
          marginBottom: '1rem',
          color: 'var(--text-primary)'
        }}>
          Mobile Mode Active
        </h2>

        <p id="mobile-welcome-description" style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: '1.6' }}>
          We've optimized performance for your device.
        </p>

        <div style={{ 
          background: 'rgba(255, 255, 255, 0.05)', 
          borderRadius: '12px', 
          padding: '1rem',
          marginBottom: '2rem',
          textAlign: 'left'
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            marginBottom: '12px',
            color: 'var(--text-primary)',
            fontSize: '0.9rem'
          }}>
            <HandTap size={24} weight="fill" style={{ color: 'var(--accent)' }} />
            <strong>Gestures</strong>
          </div>
          <ul style={{ 
            margin: 0, 
            paddingLeft: '2rem', 
            color: 'var(--text-secondary)', 
            fontSize: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <li><strong>One Finger:</strong> Rotate Camera</li>
            <li><strong>Two Fingers:</strong> Pan & Zoom</li>
          </ul>
        </div>

        <button 
          className="primary full-width large" 
          onClick={handleClose}
        >
          Start Creating
        </button>
      </div>
    </div>
  );
}
