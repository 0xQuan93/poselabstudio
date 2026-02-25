import { useUIStore } from '../state/useUIStore';
import { PresetsTab } from './tabs/PresetsTab';
import { PoseExpressionTab } from './tabs/PoseExpressionTab';
import { SceneTab } from './tabs/SceneTab';
import { ExportTab } from './tabs/ExportTab';
import { PosesTab } from './tabs/PosesTab';
import { MocapTab } from './tabs/MocapTab';
import { DirectorTab } from './tabs/DirectorTab';
import { AnimationsTab } from './tabs/AnimationsTab';
import { TrainingTab } from './tabs/TrainingTab';
import { CreatorFeed } from './feed/CreatorFeed';
import { 
  Sliders, 
  PersonArmsSpread, 
  Gear, 
  Export,
  Play,
  UserFocus,
  VideoCamera,
  FloppyDisk,
  FilmStrip,
  Users
} from '@phosphor-icons/react';

interface ControlPanelProps {
  mode: 'reactions' | 'poselab';
}

export function ControlPanel({ mode }: ControlPanelProps) {
  const { reactionTab, setReactionTab, poseLabTab, setPoseLabTab } = useUIStore();

  if (mode === 'reactions') {
    return (
      <aside className="control-panel">
        <div className="control-panel__tabs">
          <button
            className={reactionTab === 'presets' ? 'active' : ''}
            onClick={() => setReactionTab('presets')}
          >
            <Sliders size={16} weight="duotone" />
            <span>Presets</span>
          </button>
          <button
            className={reactionTab === 'pose' ? 'active' : ''}
            onClick={() => setReactionTab('pose')}
          >
            <PersonArmsSpread size={16} weight="duotone" />
            <span>Pose</span>
          </button>
          <button
            className={reactionTab === 'scene' ? 'active' : ''}
            onClick={() => setReactionTab('scene')}
          >
            <Gear size={16} weight="duotone" />
            <span>Scene</span>
          </button>
          <button
            className={reactionTab === 'feed' ? 'active' : ''}
            onClick={() => setReactionTab('feed')}
            style={{ color: reactionTab === 'feed' ? 'inherit' : '#5865F2' }}
          >
            <Users size={16} weight="duotone" />
            <span>Feed</span>
          </button>
          <button
            className={reactionTab === 'export' ? 'active' : ''}
            onClick={() => setReactionTab('export')}
          >
            <Export size={16} weight="duotone" />
            <span>Export</span>
          </button>
        </div>

        <div className="control-panel__content" style={{ padding: reactionTab === 'feed' ? 0 : undefined }}>
          {reactionTab === 'presets' && <PresetsTab />}
          {reactionTab === 'pose' && <PoseExpressionTab />}
          {reactionTab === 'scene' && <SceneTab />}
          {reactionTab === 'training' && <TrainingTab />}
          {reactionTab === 'feed' && <CreatorFeed />}
          {reactionTab === 'export' && <ExportTab />}
        </div>
      </aside>
    );
  }

  // Pose Lab mode
  return (
    <aside className="control-panel">
      <div className="control-panel__tabs" data-tutorial-id="poselab-tabs">
        <button
          className={poseLabTab === 'animations' ? 'active' : ''}
          onClick={() => setPoseLabTab('animations')}
        >
          <Play size={16} weight="duotone" />
          <span>Anims</span>
        </button>
        <button
          className={poseLabTab === 'poses' ? 'active' : ''}
          onClick={() => setPoseLabTab('poses')}
        >
          <UserFocus size={16} weight="duotone" />
          <span>Poses</span>
        </button>
        <button
          className={poseLabTab === 'mocap' ? 'active' : ''}
          onClick={() => setPoseLabTab('mocap')}
        >
          <VideoCamera size={16} weight="duotone" />
          <span>Mocap</span>
        </button>
        <button
          className={poseLabTab === 'director' ? 'active' : ''}
          onClick={() => setPoseLabTab('director')}
        >
          <FilmStrip size={16} weight="duotone" />
          <span>Director</span>
        </button>
        <button
          className={poseLabTab === 'export' ? 'active' : ''}
          onClick={() => setPoseLabTab('export')}
        >
          <FloppyDisk size={16} weight="duotone" />
          <span>Save</span>
        </button>
      </div>

      <div className="control-panel__content">
        {poseLabTab === 'animations' && <AnimationsTab />}
        {poseLabTab === 'poses' && <PosesTab />}
        {poseLabTab === 'mocap' && <MocapTab />}
        {poseLabTab === 'director' && <DirectorTab />}
        {poseLabTab === 'export' && <ExportTab mode="poselab" />}
      </div>
    </aside>
  );
}

