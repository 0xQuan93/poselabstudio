import { useState, useEffect, useRef, useCallback } from 'react';
import { sceneManager } from '../three/sceneManager';

export function usePopOutViewport(activeCssOverlay: string | null) {
  const [isPoppedOut, setIsPoppedOut] = useState(false);
  const popOutWindowRef = useRef<Window | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const closePopOut = useCallback(() => {
    // Stop all tracks in the stream to release the canvas capture
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (popOutWindowRef.current) {
      popOutWindowRef.current.close();
      popOutWindowRef.current = null;
    }
    setIsPoppedOut(false);
  }, []);

  const openPopOut = useCallback(() => {
    const canvas = sceneManager.getCanvas();
    if (!canvas) {
      console.warn('Canvas not found');
      return;
    }

    // Capture stream (60fps)
    const stream = canvas.captureStream(60);
    streamRef.current = stream;
    
    // Open new window
    const newWindow = window.open('', 'PoseLab Viewport', 'width=960,height=540,menubar=no,toolbar=no,location=no,status=no');
    
    if (!newWindow) {
      alert('Pop-up blocked! Please allow pop-ups for this site.');
      return;
    }

    popOutWindowRef.current = newWindow;
    setIsPoppedOut(true);

    // Setup Document
    const doc = newWindow.document;
    doc.title = "PoseLab Viewport";
    doc.body.style.margin = '0';
    doc.body.style.backgroundColor = '#000';
    doc.body.style.overflow = 'hidden';
    doc.body.style.display = 'flex';
    doc.body.style.alignItems = 'center';
    doc.body.style.justifyContent = 'center';

    // Copy all styles from parent window to ensure overlays and fonts work
    Array.from(document.styleSheets).forEach(styleSheet => {
      try {
        if (styleSheet.href) {
          const link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = styleSheet.href;
          doc.head.appendChild(link);
        } else {
            // Inline styles
            try {
                const style = doc.createElement('style');
                Array.from(styleSheet.cssRules).forEach(rule => {
                    style.appendChild(doc.createTextNode(rule.cssText));
                });
                doc.head.appendChild(style);
            } catch (_e) {
                // Ignore CORS errors for cross-origin stylesheets
            }
        }
      } catch (e) {
        console.warn('Could not copy stylesheet', e);
      }
    });

    // Add specific styles for the video and overlay container
    const style = doc.createElement('style');
    style.textContent = `
      video {
        width: 100vw;
        height: 100vh;
        object-fit: contain; /* Maintain aspect ratio */
      }
      .popout-overlay-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
        z-index: 10;
      }
      /* Ensure overlays match the video size if possible, or just fill screen */
      /* Since object-fit: contain might leave black bars, overlays filling screen might look odd */
      /* Ideally we want the overlay to match the video rect. */
    `;
    doc.head.appendChild(style);

    // Create Video Element
    const video = doc.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    doc.body.appendChild(video);

    // Create Overlay Container
    const overlayDiv = doc.createElement('div');
    overlayDiv.id = 'active-css-overlay'; // Re-use ID logic or just class
    overlayDiv.className = 'popout-overlay-container';
    doc.body.appendChild(overlayDiv);

    // Handle Window Close
    newWindow.addEventListener('beforeunload', () => {
      // Stop all tracks in the stream to release the canvas capture
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsPoppedOut(false);
      popOutWindowRef.current = null;
    });

  }, []);

  const togglePopOut = useCallback(() => {
    if (isPoppedOut) {
      closePopOut();
    } else {
      openPopOut();
    }
  }, [isPoppedOut, closePopOut, openPopOut]);

  // Sync Overlay State
  useEffect(() => {
    if (!popOutWindowRef.current) return;
    
    const win = popOutWindowRef.current;
    const overlayDiv = win.document.getElementById('active-css-overlay');
    
    if (overlayDiv) {
        // Reset classes but keep base container class
        overlayDiv.className = 'popout-overlay-container'; 
        
        if (activeCssOverlay) {
            overlayDiv.classList.add(activeCssOverlay);
            // Ensure the specific overlay styles are applied
            // The copied stylesheets should handle .overlay-glitch etc.
        }
    }
  }, [activeCssOverlay, isPoppedOut]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop all tracks in the stream to release the canvas capture
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (popOutWindowRef.current) {
        popOutWindowRef.current.close();
      }
    };
  }, []);

  return { isPoppedOut, togglePopOut };
}
