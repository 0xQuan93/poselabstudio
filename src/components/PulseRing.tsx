/* eslint-disable react-refresh/only-export-components */
/**
 * PulseRing - Expanding ring feedback effect
 * ═══════════════════════════════════════════════════════════════════════════
 * Ported from poselab-demo Remotion project
 * Perfect for click feedback, avatar load complete, action confirmation
 */

import { useState, useCallback } from 'react';
import './PulseRing.css';

interface PulseRingProps {
  /** Color variant */
  variant?: 'cyan' | 'violet' | 'solar' | 'white';
  /** Number of rings to show */
  ringCount?: number;
  /** Size of the ring container */
  size?: number | string;
  /** Whether the pulse is active */
  active?: boolean;
  /** Children to wrap */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
}

export function PulseRing({
  variant = 'cyan',
  ringCount = 2,
  size = '100%',
  active = false,
  children,
  className = '',
}: PulseRingProps) {
  return (
    <div 
      className={`pulse-ring-wrapper pulse-ring-${variant} ${active ? 'pulse-active' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      {children}
      {Array.from({ length: ringCount }).map((_, i) => (
        <span 
          key={i} 
          className="pulse-ring-element"
          style={{ animationDelay: `${i * 0.1}s` }}
        />
      ))}
    </div>
  );
}

/**
 * Hook to trigger pulse effect on demand
 * Usage: const { active, trigger, PulseWrapper } = usePulse();
 */
export function usePulse(duration = 600) {
  const [active, setActive] = useState(false);

  const trigger = useCallback(() => {
    setActive(true);
    setTimeout(() => setActive(false), duration);
  }, [duration]);

  const PulseWrapper = useCallback(({ 
    children, 
    variant = 'cyan',
    className = '',
  }: { 
    children: React.ReactNode;
    variant?: 'cyan' | 'violet' | 'solar' | 'white';
    className?: string;
  }) => (
    <PulseRing active={active} variant={variant} className={className}>
      {children}
    </PulseRing>
  ), [active]);

  return { active, trigger, PulseWrapper };
}
