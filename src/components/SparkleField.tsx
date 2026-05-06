/* eslint-disable react-refresh/only-export-components */
/**
 * SparkleField - Kawaii-style sparkle/star effect
 * ═══════════════════════════════════════════════════════════════════════════
 * Ported from poselab-demo Remotion project
 * Perfect for celebration moments, export success, sprint completion
 */

import { useEffect, useState, useMemo } from 'react';
import './SparkleField.css';

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  color: string;
  rotation: number;
}

interface SparkleFieldProps {
  /** Number of sparkles to render */
  count?: number;
  /** Overall opacity of the field */
  opacity?: number;
  /** Whether the sparkles are active/visible */
  active?: boolean;
  /** Container to constrain sparkles to (defaults to viewport) */
  contained?: boolean;
}

const SPARKLE_COLORS = [
  'var(--accent)',      // Signal green
  'var(--accent-300)',  // Lighter cyan
  '#FFD700',            // Gold
  '#FF69B4',            // Hot pink (kawaii!)
  'var(--violet-400)',  // Purple
  '#FFFFFF',            // White
];

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

export function SparkleField({ 
  count = 15, 
  opacity = 0.7,
  active = true,
  contained = false,
}: SparkleFieldProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const sparkles = useMemo<Sparkle[]>(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: seededRandom(i * 1.1) * 100,
      y: seededRandom(i * 2.2) * 100,
      size: seededRandom(i * 3.3) * 16 + 8, // 8-24px
      delay: seededRandom(i * 4.4) * 3, // 0-3s delay
      duration: seededRandom(i * 5.5) * 1.5 + 1, // 1-2.5s duration
      color: SPARKLE_COLORS[Math.floor(seededRandom(i * 6.6) * SPARKLE_COLORS.length)],
      rotation: seededRandom(i * 7.7) * 360,
    }));
  }, [count]);

  if (!active || !mounted) return null;

  return (
    <div 
      className={`sparkle-field ${contained ? 'contained' : ''}`}
      style={{ opacity }}
      aria-hidden="true"
    >
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className="sparkle"
          style={{
            left: `${sparkle.x}%`,
            top: `${sparkle.y}%`,
            width: sparkle.size,
            height: sparkle.size,
            animationDelay: `${sparkle.delay}s`,
            animationDuration: `${sparkle.duration}s`,
            transform: `rotate(${sparkle.rotation}deg)`,
          }}
        >
          {/* 4-point star SVG - the classic kawaii sparkle */}
          <svg viewBox="0 0 24 24" style={{ width: '100%', height: '100%' }}>
            <path
              d="M12 0L14 10L24 12L14 14L12 24L10 14L0 12L10 10Z"
              fill={sparkle.color}
              style={{
                filter: `drop-shadow(0 0 ${sparkle.size / 3}px ${sparkle.color})`,
              }}
            />
          </svg>
        </div>
      ))}
    </div>
  );
}

/**
 * Hook to trigger sparkles on demand
 * Usage: const { sparkles, trigger } = useSparkles();
 */
export function useSparkles(duration = 2000) {
  const [active, setActive] = useState(false);

  const trigger = () => {
    setActive(true);
    setTimeout(() => setActive(false), duration);
  };

  return { active, trigger };
}
