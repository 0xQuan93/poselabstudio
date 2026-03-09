import { useEffect, useState } from 'react';
import './TickerTape.css';

import { useAvatarSource } from '../state/useAvatarSource';
import { useTimelineStore } from '../state/useTimelineStore';
import { useReactionStore } from '../state/useReactionStore';
import { Info, Lightning, User, PlayCircle, FilmStrip } from '@phosphor-icons/react';

export function TickerTape() {
  const [status, setStatus] = useState({ text: "SYSTEM ACTIVE", icon: <Lightning weight="fill" /> });
  
  // Real-time hooks for the status
  const sourceLabel = useAvatarSource(state => state.sourceLabel);
  const isPlaying = useTimelineStore(state => state.isPlaying);
  const isAvatarReady = useReactionStore(state => state.isAvatarReady);
  const activePreset = useReactionStore(state => state.activePreset);

  useEffect(() => {
    if (isAvatarReady && sourceLabel && sourceLabel !== 'No avatar loaded') {
      setStatus({ text: `AVATAR LOADED: ${sourceLabel.toUpperCase()}`, icon: <User weight="fill" /> });
    }
  }, [isAvatarReady, sourceLabel]);

  useEffect(() => {
    if (isPlaying) {
      setStatus({ text: "TIMELINE PLAYBACK ACTIVE", icon: <PlayCircle weight="fill" /> });
    } else {
      setStatus({ text: "TIMELINE IDLE", icon: <Info weight="fill" /> });
    }
  }, [isPlaying]);

  useEffect(() => {
    if (activePreset && activePreset.label) {
      setStatus({ text: `PRESET: ${activePreset.label.toUpperCase()}`, icon: <FilmStrip weight="fill" /> });
    }
  }, [activePreset]);

  return (
    <div className="ticker-tape-container">
      <div className="status-bar-content">
        <span className="status-icon">{status.icon}</span>
        <span className="status-text">{status.text}</span>
      </div>
    </div>
  );
}
