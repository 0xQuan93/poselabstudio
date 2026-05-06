/* eslint-disable react-refresh/only-export-components */
/**
 * ScrambleText - Cyberpunk character scramble reveal effect
 * ═══════════════════════════════════════════════════════════════════════════
 * Ported from poselab-demo Remotion project
 * Perfect for loading text, toast messages, dramatic reveals
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import './ScrambleText.css';

const GLITCH_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`01アイウエオカキクケコ';

interface ScrambleTextProps {
  /** The final text to display */
  text: string;
  /** Whether to start the scramble animation */
  active?: boolean;
  /** Duration in ms for the full reveal */
  duration?: number;
  /** Delay before starting in ms */
  delay?: number;
  /** Additional CSS class */
  className?: string;
  /** Callback when animation completes */
  onComplete?: () => void;
}

export function ScrambleText({
  text,
  active = true,
  duration = 1000,
  delay = 0,
  className = '',
  onComplete,
}: ScrambleTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const [isAnimating, setIsAnimating] = useState(false);
  const frameRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);

  const scramble = useCallback(() => {
    if (!active) {
      setDisplayText(text);
      return;
    }

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Calculate how many characters should be revealed
      const revealedCount = Math.floor(progress * text.length);

      // Build the display string
      const chars = text.split('').map((char, i) => {
        if (char === ' ') return ' ';
        if (i < revealedCount) return char;
        // Scramble unrevealed characters
        return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
      });

      setDisplayText(chars.join(''));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayText(text);
        setIsAnimating(false);
        onComplete?.();
      }
    };

    setIsAnimating(true);
    startTimeRef.current = undefined;
    
    setTimeout(() => {
      frameRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [text, active, duration, delay, onComplete]);

  useEffect(() => {
    if (active) {
      const cleanup = scramble();
      return cleanup;
    } else {
      setDisplayText(text);
    }
  }, [active, text, scramble]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <span className={`scramble-text ${isAnimating ? 'animating' : ''} ${className}`}>
      {displayText}
    </span>
  );
}

/**
 * Hook for imperative scramble control
 * Usage: const { displayText, trigger } = useScramble('Hello World');
 */
export function useScramble(text: string, duration = 1000) {
  const [displayText, setDisplayText] = useState(text);
  const [isAnimating, setIsAnimating] = useState(false);
  const frameRef = useRef<number | undefined>(undefined);

  const trigger = useCallback(() => {
    if (isAnimating) return;

    setIsAnimating(true);
    const startTime = performance.now();

    const animate = (timestamp: number) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const revealedCount = Math.floor(progress * text.length);

      const chars = text.split('').map((char, i) => {
        if (char === ' ') return ' ';
        if (i < revealedCount) return char;
        return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
      });

      setDisplayText(chars.join(''));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayText(text);
        setIsAnimating(false);
      }
    };

    frameRef.current = requestAnimationFrame(animate);
  }, [text, duration, isAnimating]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return { displayText, trigger, isAnimating };
}
