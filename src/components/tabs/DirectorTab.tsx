import { useState } from 'react';
import { directorManager } from '../../three/DirectorManager';
import { useDirectorStore } from '../../state/useDirectorStore';
import { useToastStore } from '../../state/useToastStore';
import { exportAsWebM } from '../../export/exportVideo';
import { useSettingsStore } from '../../state/useSettingsStore';
import { 
  Play, 
  Stop, 
  Trash, 
  Plus,
  VideoCamera,
  CaretUp,
  CaretDown,
  Copy,
  Layout,
  PencilSimple,
  X,
  Clock,
  CheckCircle,
  Spinner
} from '@phosphor-icons/react';
import type { PoseId, ExpressionId, BackgroundId } from '../../types/reactions';
import type { CameraPreset, Shot } from '../../types/director';
import { Panel } from '../../design-system/Panel';
import { Button } from '../../design-system/Button';
import { Input } from '../../design-system/Input';
import './DirectorTab.css';

export function DirectorTab() {
  const { addToast } = useToastStore();
  const { 
    currentScript, 
    updateScriptTitle,
    updateShot,
    addShot,
    removeShot,
    duplicateShot,
    reorderShots,
    setScript
  } = useDirectorStore();
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');

  const handlePlayScript = async () => {
    if (!currentScript || currentScript.shots.length === 0) {
      addToast('Add at least one shot to play!', 'warning');
      return;
    }
    setIsPlaying(true);
    await directorManager.playScript(currentScript);
    setIsPlaying(false);
  };

  const handleStopScript = () => {
    directorManager.stop();
    setIsPlaying(false);
  };

  const handleExportScript = async () => {
    if (!currentScript || currentScript.shots.length === 0) {
      addToast('Add at least one shot to export!', 'warning');
      return;
    }

    if (isExporting) return;

    try {
      setIsExporting(true);
      setExportProgress(0);
      addToast('Starting recording...', 'info');

      // 1. Get Canvas
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Canvas not found');

      // 2. Start the script
      await directorManager.playScript(currentScript);
      
      // 3. Start Real-time Recording
      // We use exportAsWebM directly instead of exportOfflineWebM
      // primarily because DirectorManager relies on setTimeout/wall-clock time
      // which gets broken by the offline renderer's manual time stepping.
      
      // Check global quality setting to determine export resolution
      // If Ultra, use 4K. Otherwise default to 1080p High Quality.
      const quality = useSettingsStore.getState().quality;
      const isUltra = quality === 'ultra';
      
      const width = isUltra ? 3840 : 1920;
      const height = isUltra ? 2160 : 1080;
      const bitrate = isUltra ? 25000000 : 12000000; // 25 Mbps vs 12 Mbps
      
      addToast(isUltra ? 'Exporting in 4K UHD...' : 'Exporting in 1080p HD...', 'info');

      await exportAsWebM(
        canvas,
        currentScript.totalDuration + 0.5, // Add slight buffer
        `Director_Sequence_${Date.now()}.webm`,
        (p) => setExportProgress(p * 100),
        { 
            width, 
            height,
            includeLogo: true,
            fps: 60,
            videoBitsPerSecond: bitrate
        }
      );

      addToast('Export completed successfully!', 'success');
    } catch (error) {
      console.error('Export failed:', error);
      addToast('Export failed. Check console for details.', 'error');
    } finally {
      directorManager.stop();
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleAddDefaultShot = () => {
    addShot({
      id: `shot-${Date.now()}`,
      name: `Shot ${currentScript ? currentScript.shots.length + 1 : 1}`,
      poseId: 'idle-neutral',
      expressionId: 'calm',
      backgroundId: 'synthwave-grid',
      cameraPreset: 'medium',
      duration: 3,
      transition: 'smooth',
      animated: true,
      rootMotion: false
    });
  };

  const handleClearScript = () => {
    if (confirm('Are you sure you want to clear the entire script?')) {
      setScript(null);
    }
  };

  const handleStartEditTitle = () => {
    setTempTitle(currentScript?.title || 'New Script');
    setIsEditingTitle(true);
  };

  const handleSaveTitle = () => {
    updateScriptTitle(tempTitle || 'Untitled Script');
    setIsEditingTitle(false);
  };

  // Lists for selects
  const cameraPresets: CameraPreset[] = [
    'headshot', 'portrait', 'medium', 'full-body', 'wide', 
    'low-angle', 'high-angle', 'over-shoulder', 
    'orbit-slow', 'orbit-fast', 'dolly-in', 'dolly-out'
  ];

  const expressions: ExpressionId[] = ['calm', 'joy', 'surprise'];

  const backgrounds: BackgroundId[] = [
    'synthwave-grid', 'neural-circuit', 'neon-waves', 'quantum-particles', 
    'signal-glitch', 'cyber-hexagons', 'protocol-gradient', 'void-minimal',
    'green-screen', 'lush-forest', 'volcano', 'deep-sea', 
    'glass-platform', 'hacker-room', 'industrial', 'rooftop-garden', 'shinto-shrine'
  ];

  const poseGroups = {
    Locomotion: ['locomotion-walk', 'locomotion-run', 'locomotion-jog', 'locomotion-crouch-walk', 'locomotion-turn-left', 'locomotion-turn-right', 'locomotion-stop'],
    Idle: ['idle-neutral', 'idle-happy', 'idle-breathing', 'idle-nervous', 'idle-offensive'],
    Sitting: ['sit-chair', 'sit-floor', 'sit-sad', 'sit-typing', 'transition-stand-to-sit', 'transition-sit-to-stand', 'transition-floor-to-stand'],
    Social: ['emote-wave', 'emote-point', 'emote-clap', 'emote-cheer', 'emote-thumbsup', 'emote-bow', 'emote-dance-silly', 'emote-taunt', 'emote-bored'],
    Action: ['action-defeat', 'action-focus', 'action-rope-climb', 'action-climb-top', 'action-swim', 'action-waking'],
    Classic: ['dawn-runner', 'sunset-call', 'cipher-whisper', 'nebula-drift', 'signal-reverie', 'agent-taunt', 'agent-dance', 'agent-clapping', 'silly-agent', 'simple-wave', 'point', 'defeat', 'focus', 'rope-climb', 'climb-top', 'thumbs-up', 'offensive-idle', 'waking', 'treading-water', 'cheering']
  };

  return (
    <div className="tab-content">
      <Panel className="director-header">
        <div className="director-header__content">
          <div className="director-header__info">
            {isEditingTitle ? (
              <div className="director-header__title-edit">
                <Input 
                  type="text" 
                  className="small" 
                  value={tempTitle}
                  onChange={(e) => setTempTitle(e.target.value)}
                  autoFocus
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                />
                <Button variant="ghost" size="small" onClick={handleSaveTitle} aria-label="Save Title">
                  <CheckCircle size={18} weight="fill" />
                </Button>
              </div>
            ) : (
              <div className="director-header__title-display">
                <h2 className="director-header__title">{currentScript?.title || 'Director Script'}</h2>
                <Button variant="ghost" size="small" onClick={handleStartEditTitle} aria-label="Edit Title">
                  <PencilSimple size={14} />
                </Button>
              </div>
            )}
            <div className="director-header__stats">
              <span className="muted tiny uppercase bold director-header__stat-item">
                <Layout size={12} /> {currentScript?.shots.length || 0} shots
              </span>
              <span className="muted tiny uppercase bold director-header__stat-item">
                <Clock size={12} /> {currentScript?.totalDuration.toFixed(1) || 0}s
              </span>
            </div>
          </div>
          
          <div className="director-header__actions">
            <Button variant="primary" size="small" onClick={handleAddDefaultShot} leftIcon={<Plus size={16} weight="bold" />}>
              Add Shot
            </Button>
            <Button variant="ghost" onClick={handleClearScript} title="Clear Script" aria-label="Clear Script">
              <Trash size={18} weight="duotone" />
            </Button>
          </div>
        </div>
      </Panel>

      <div className="tab-section">
        {currentScript && currentScript.shots.length > 0 ? (
          <div className="shot-list-container">
            {currentScript.shots.map((shot, index) => (
              <Panel key={shot.id} className="shot-item-card">
                <div className="shot-item__header">
                  <div className="shot-item__name-group">
                    <span className="tiny bold muted shot-item__index">#{index + 1}</span>
                    <Input 
                      type="text" 
                      className="shot-item__name-input" 
                      value={shot.name}
                      placeholder="Shot Name..."
                      onChange={(e) => updateShot(shot.id, { name: e.target.value })}
                    />
                  </div>
                  
                  <div className="shot-item__actions">
                    <Button variant="ghost" size="small" onClick={() => index > 0 && reorderShots(index, index - 1)} disabled={index === 0} aria-label="Move Up">
                      <CaretUp size={14} />
                    </Button>
                    <Button variant="ghost" size="small" onClick={() => index < currentScript.shots.length - 1 && reorderShots(index, index + 1)} disabled={index === currentScript.shots.length - 1} aria-label="Move Down">
                      <CaretDown size={14} />
                    </Button>
                    <Button variant="ghost" size="small" onClick={() => duplicateShot(shot.id)} title="Duplicate" aria-label="Duplicate">
                      <Copy size={14} />
                    </Button>
                    <Button variant="ghost" size="small" className="danger-hover" onClick={() => removeShot(shot.id)} aria-label="Remove Shot">
                      <X size={14} />
                    </Button>
                  </div>
                </div>

                <div className="shot-item__controls">
                  <div className="shot-item__field">
                    <label className="tiny muted uppercase bold shot-item__field-label">Animation</label>
                    <select 
                      className="shot-item__select"
                      value={shot.poseId}
                      onChange={(e) => updateShot(shot.id, { poseId: e.target.value as PoseId })}
                    >
                      {Object.entries(poseGroups).map(([group, poses]) => (
                        <optgroup key={group} label={group}>
                          {poses.map(pose => (
                            <option key={pose} value={pose}>{pose.replace(/-/g, ' ')}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className="shot-item__field">
                    <label className="tiny muted uppercase bold shot-item__field-label">Camera View</label>
                    <select 
                      className="shot-item__select"
                      value={shot.cameraPreset}
                      onChange={(e) => updateShot(shot.id, { cameraPreset: e.target.value as CameraPreset })}
                    >
                      {cameraPresets.map(preset => (
                        <option key={preset} value={preset}>{preset.replace(/-/g, ' ')}</option>
                      ))}
                    </select>
                  </div>

                  <div className="shot-item__field">
                    <label className="tiny muted uppercase bold shot-item__field-label">Background</label>
                    <select 
                      className="shot-item__select"
                      value={shot.backgroundId}
                      onChange={(e) => updateShot(shot.id, { backgroundId: e.target.value as BackgroundId })}
                    >
                      {backgrounds.map(bg => (
                        <option key={bg} value={bg}>{bg.replace(/-/g, ' ')}</option>
                      ))}
                    </select>
                  </div>

                  <div className="shot-item__field">
                    <label className="tiny muted uppercase bold shot-item__field-label">Duration</label>
                    <div className="shot-item__duration-group">
                      <input 
                        type="range"
                        min="0.5"
                        max="15"
                        step="0.5"
                        value={shot.duration}
                        onChange={(e) => updateShot(shot.id, { duration: parseFloat(e.target.value) })}
                        className="shot-item__duration-range"
                      />
                      <span className="small mono bold shot-item__duration-label">{shot.duration}s</span>
                    </div>
                  </div>

                  <div className="shot-item__field">
                    <label className="tiny muted uppercase bold shot-item__field-label">Expression</label>
                    <select 
                      className="shot-item__select"
                      value={shot.expressionId}
                      onChange={(e) => updateShot(shot.id, { expressionId: e.target.value as ExpressionId })}
                    >
                      {expressions.map(exp => (
                        <option key={exp} value={exp}>{exp}</option>
                      ))}
                    </select>
                  </div>

                  <div className="shot-item__field">
                    <label className="tiny muted uppercase bold shot-item__field-label">Transition</label>
                    <select 
                      className="shot-item__select"
                      value={shot.transition}
                      onChange={(e) => updateShot(shot.id, { transition: e.target.value as Shot['transition'] })}
                    >
                      <option value="smooth">Smooth Flow</option>
                      <option value="cut">Hard Cut</option>
                      <option value="fade">Cross Fade</option>
                    </select>
                  </div>

                  <div className="shot-item__checkbox-fields">
                    <label className="shot-item__checkbox-label">
                      <input 
                        type="checkbox" 
                        checked={shot.animated !== false}
                        onChange={(e) => updateShot(shot.id, { animated: e.target.checked })}
                        className="shot-item__checkbox"
                      />
                      <span className="tiny muted uppercase bold">Enable Bone Animation</span>
                    </label>

                    <label className="shot-item__checkbox-label">
                      <input 
                        type="checkbox" 
                        checked={shot.rootMotion === true}
                        onChange={(e) => updateShot(shot.id, { rootMotion: e.target.checked })}
                        className="shot-item__checkbox"
                        disabled={!shot.animated}
                      />
                      <span className={`tiny uppercase bold ${!shot.animated ? 'muted-dark' : 'muted'}`}>Root Motion (Walk in Shot)</span>
                    </label>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state__icon-container">
              <Layout size={32} weight="thin" className="empty-state__icon" />
            </div>
            <h3 className="empty-state__title">No Script Active</h3>
            <p className="muted small empty-state__text">
              Create a cinematic sequence by adding your first shot manually.
            </p>
            <Button variant="primary" onClick={handleAddDefaultShot} leftIcon={<Plus size={18} weight="bold" />}>
              Start New Script
            </Button>
          </div>
        )}
      </div>

      {currentScript && currentScript.shots.length > 0 && (
        <div className="director-actions-footer">
          <div className="director-actions-footer__grid">
            {isPlaying ? (
              <Button variant="secondary" size="large" className="full-width pulse danger" onClick={handleStopScript} leftIcon={<Stop size={22} weight="fill" />}>
                Stop Preview
              </Button>
            ) : (
              <Button variant="primary" size="large" className="full-width" onClick={handlePlayScript} leftIcon={<Play size={22} weight="fill" />}>
                Play Script
              </Button>
            )}
            
            {isExporting ? (
              <Button variant="secondary" size="large" className="full-width" disabled>
                <Spinner size={22} className="spin" /> 
                {exportProgress > 0.5 
                  ? `Stitching... ${Math.round((exportProgress - 0.5) * 200)}%` 
                  : `Rendering... ${Math.round(exportProgress * 200)}%`
                }
              </Button>
            ) : (
              <Button variant="secondary" size="large" className="full-width" onClick={handleExportScript} leftIcon={<VideoCamera size={22} weight="duotone" />}>
                Export WebM
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
