import { useEffect, useState } from 'react';
import { useTimelineStore } from '../../state/useTimelineStore';
import { avatarManager } from '../../three/avatarManager';
import { timelineToAnimationClip } from '../../utils/timelineToAnimation';
import * as THREE from 'three';
import { useReactionStore } from '../../state/useReactionStore';
import { Play, Pause, Stop, Plus, FloppyDisk, ArrowsClockwise } from '@phosphor-icons/react';
import { getPoseLabTimestamp } from '../../utils/exportNaming';
import { useSceneSettingsStore } from '../../state/useSceneSettingsStore';

export function TimelineTab() {
  const { 
    sequence, 
    currentTime, 
    isPlaying, 
    addKeyframe, 
    removeKeyframe,
    setDuration, 
    setCurrentTime, 
    setIsPlaying,
    selectedKeyframeId,
    selectKeyframe,
    updateKeyframe
  } = useTimelineStore();

  const { isAvatarReady } = useReactionStore();
  const rotationLocked = useSceneSettingsStore((state) => state.rotationLocked);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, setClip] = useState<THREE.AnimationClip | null>(null);

  // Reset animation speed on unmount to prevent "stuck" playback speed
  useEffect(() => {
    // When navigating away from Timeline
    return () => {
      // 1. Restore global animation speed
      avatarManager.setAnimationSpeed(1); 
      
      // 2. Keep the current scrubber pose
      avatarManager.freezeCurrentPose();
      
      console.log('[TimelineTab] Unmounting - State reset');
    };
  }, []);

  // Re-generate clip when sequence changes
  useEffect(() => {
    const vrm = avatarManager.getVRM();
    if (!vrm) return;

    if (sequence.keyframes.length === 0) {
      // Freeze current pose instead of resetting to T-pose
      // This prevents the "T-Pose lock" when switching to an empty timeline
      avatarManager.freezeCurrentPose();
      setClip(null);
      return;
    }

    try {
      const newClip = timelineToAnimationClip(sequence, vrm);
      setClip(newClip);
      
      // If we have a clip, update the avatar manager
      if (newClip) {
        // Play with 0 fade for instant update
        avatarManager.playAnimationClip(newClip, rotationLocked, false, 0);
        // Pause the internal mixer progression so TimelineTab controls time 100%
        avatarManager.setAnimationSpeed(0);
        // Force seek to current time immediately to prevent jump to 0
        avatarManager.seekAnimation(currentTime);
      }
    } catch (e) {
      console.error('Failed to generate animation clip:', e);
    }
  }, [sequence, isAvatarReady]);

  // Handle visibility changes to auto-pause/resume
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (isPlaying) setIsPlaying(false);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying, setIsPlaying]);

  // Handle Playback Loop
  useEffect(() => {
    let animationFrame: number;
    let lastTime = performance.now();

    const loop = () => {
      if (isPlaying) {
        const now = performance.now();
        const delta = (now - lastTime) / 1000;
        lastTime = now;

        let newTime = currentTime + delta;
        if (newTime >= sequence.duration) {
          newTime = 0; // Loop
        }
        
        setCurrentTime(newTime);
      } else {
        lastTime = performance.now();
      }
      animationFrame = requestAnimationFrame(loop);
    };

    if (isPlaying) {
      loop();
    }

    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, currentTime, sequence.duration, setCurrentTime]);

  // Sync Mixer to Current Time
  useEffect(() => {
    avatarManager.seekAnimation(currentTime);
  }, [currentTime]);

  const handleCaptureKeyframe = () => {
    const vrm = avatarManager.getVRM();
    if (!vrm || !vrm.humanoid) return;

    // Capture current pose
    const pose = vrm.humanoid.getNormalizedPose();
    
    addKeyframe({
      time: currentTime,
      pose: pose,
      label: `Frame ${sequence.keyframes.length + 1}`
    });
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * sequence.duration;
    setCurrentTime(newTime);
    setIsPlaying(false);
  };

  return (
    <div className="tab-content">
      <div className="tab-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <h3>Timeline Editor</h3>
           <div className="badge">Beta</div>
        </div>

        <div className="timeline-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <button 
            className={`secondary ${isPlaying ? 'active' : ''}`}
            onClick={() => setIsPlaying(!isPlaying)}
            style={{ flex: '1 1 120px' }}
          >
            {isPlaying ? <><Pause size={16} weight="fill" /> Pause</> : <><Play size={16} weight="fill" /> Play</>}
          </button>
          
           <button 
            className="secondary"
            onClick={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            style={{ width: '40px', flexShrink: 0 }}
            title="Stop & Rewind"
          >
            <Stop size={16} weight="fill" />
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0 0.5rem', borderRadius: 'var(--radius-md)', flex: '1 1 auto' }}>
             <span className="small muted" style={{ fontSize: '0.75rem' }}>DUR:</span>
             <input 
               type="number" 
               value={sequence.duration} 
               onChange={(e) => setDuration(parseFloat(e.target.value))}
               step="0.1"
               style={{ width: '45px', padding: '4px', background: 'transparent', border: 'none', color: '#fff', textAlign: 'right' }}
             />
             <span className="small muted">s</span>
          </div>
        </div>

        {/* Timeline Track */}
        <div 
          className="timeline-track-container" 
          style={{ 
            height: '60px', 
            background: 'rgba(0,0,0,0.3)', 
            borderRadius: 'var(--radius-md)',
            position: 'relative',
            cursor: 'pointer',
            marginBottom: '1rem',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)'
          }}
          onClick={handleTimelineClick}
        >
          {/* Time Markers */}
          {Array.from({ length: Math.ceil(sequence.duration) + 1 }).map((_, i) => (
             <div key={i} style={{ 
               position: 'absolute', 
               left: `${(i / sequence.duration) * 100}%`, 
               bottom: '0', 
               height: '100%', 
               width: '1px', 
               background: 'rgba(255,255,255,0.05)',
               pointerEvents: 'none'
             }}>
               <span style={{ 
                 position: 'absolute', 
                 bottom: '2px', 
                 left: '2px', 
                 fontSize: '0.6rem', 
                 color: 'rgba(255,255,255,0.3)' 
               }}>{i}s</span>
             </div>
          ))}

          {/* Keyframes */}
          {sequence.keyframes.map((kf) => (
            <div
              key={kf.id}
              onClick={(e) => {
                e.stopPropagation();
                selectKeyframe(kf.id);
                setCurrentTime(kf.time);
              }}
              style={{
                position: 'absolute',
                left: `${(kf.time / sequence.duration) * 100}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: selectedKeyframeId === kf.id ? '#00ffd6' : '#ffffff',
                border: '2px solid #2a2a2a',
                zIndex: 10,
                cursor: 'pointer',
                boxShadow: selectedKeyframeId === kf.id ? '0 0 10px rgba(0,255,214,0.5)' : 'none',
                transition: 'all 0.2s ease'
              }}
              title={kf.label || `Keyframe at ${kf.time.toFixed(2)}s`}
            />
          ))}

          {/* Scrubber Head */}
          <div
            style={{
              position: 'absolute',
              left: `${(currentTime / sequence.duration) * 100}%`,
              top: 0,
              bottom: 0,
              width: '2px',
              background: '#ff0055',
              pointerEvents: 'none',
              zIndex: 15,
              boxShadow: '0 0 8px #ff0055'
            }}
          />
        </div>
        
        <div className="action-row" style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
                className="primary full-width"
                onClick={handleCaptureKeyframe}
                disabled={!isAvatarReady}
            >
                <Plus size={16} weight="bold" /> Add Keyframe at {currentTime.toFixed(2)}s
            </button>
            <button 
                className="secondary"
                onClick={() => {
                  const clip = timelineToAnimationClip(sequence, avatarManager.getVRM()!);
                  const animData = {
                    name: clip.name,
                    duration: clip.duration,
                    tracks: THREE.AnimationClip.toJSON(clip).tracks,
                  };
                  const blob = new Blob([JSON.stringify(animData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  const timestamp = getPoseLabTimestamp();
                  a.download = `PoseLab_${timestamp}_sequence.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                disabled={sequence.keyframes.length === 0}
                title="Export Sequence JSON"
            >
                <FloppyDisk size={16} weight="duotone" /> Export
            </button>
        </div>
      </div>

      {selectedKeyframeId && (
        <div className="tab-section" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem', animation: 'fadeIn 0.3s ease' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <h4 style={{ margin: 0, color: '#00ffd6' }}>Keyframe Options</h4>
             <button 
               className="danger small"
               onClick={() => removeKeyframe(selectedKeyframeId)}
               style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'rgba(255, 50, 50, 0.2)', color: '#ff5555', border: '1px solid rgba(255, 50, 50, 0.3)', borderRadius: '6px' }}
             >
               Delete
             </button>
           </div>
           
           <div style={{ marginTop: '0.5rem' }}>
              <button 
                className="secondary full-width"
                onClick={() => {
                    const vrm = avatarManager.getVRM();
                    if (vrm && vrm.humanoid) {
                        const pose = vrm.humanoid.getNormalizedPose();
                        updateKeyframe(selectedKeyframeId, { pose });
                    }
                }}
              >
                <ArrowsClockwise size={16} weight="duotone" /> Update with Current Pose
              </button>
              <p className="muted small" style={{ marginTop: '0.5rem', textAlign: 'center' }}>
                Set character pose first, then click Update
              </p>
           </div>
        </div>
      )}
    </div>
  );
}
