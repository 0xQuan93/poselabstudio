import { useUIStore } from '../state/useUIStore';
import { useUserStore } from '../state/useUserStore';
import { useToastStore } from '../state/useToastStore';
import { PresetsTab } from './tabs/PresetsTab';
import { PoseExpressionTab } from './tabs/PoseExpressionTab';
import { SceneTab } from './tabs/SceneTab';
import { ExportTab } from './tabs/ExportTab';
import { PosesTab } from './tabs/PosesTab';
import { MocapTab } from './tabs/MocapTab';
import { DirectorTab } from './tabs/DirectorTab';
import { AnimationsTab } from './tabs/AnimationsTab';
import { TrainingTab } from './tabs/TrainingTab';
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
  GraduationCap
} from '@phosphor-icons/react';

interface ControlPanelProps {
  mode: 'reactions' | 'poselab' | 'studio';
}

export function ControlPanel({ mode }: ControlPanelProps) {
  const { reactionTab, setReactionTab, poseLabTab, setPoseLabTab } = useUIStore();

  const handleTabClick = (tabType: 'reaction' | 'poselab', tabName: any) => {
    if (tabType === 'reaction') {
      setReactionTab(tabName);
    } else {
      setPoseLabTab(tabName);
    }
    
    useUserStore.getState().recordExploration('visit_tabs').then(reward => {
      if (reward > 0) {
        useToastStore.getState().addToast(`+${reward} LP for exploring tabs!`, 'info');
      }
    });
  };

  if (mode === 'studio') return null;

  if (mode === 'reactions') {
    return (
      <aside className="control-panel">
        <div className="control-panel__tabs">
          <button
            className={reactionTab === 'presets' ? 'active' : ''}
            onClick={() => handleTabClick('reaction', 'presets')}
          >
            <Sliders size={16} weight="duotone" />
            <span>Presets</span>
          </button>
          <button
            className={reactionTab === 'pose' ? 'active' : ''}
            onClick={() => handleTabClick('reaction', 'pose')}
          >
            <PersonArmsSpread size={16} weight="duotone" />
            <span>Pose</span>
          </button>
          <button
            className={reactionTab === 'scene' ? 'active' : ''}
            onClick={() => handleTabClick('reaction', 'scene')}
          >
            <Gear size={16} weight="duotone" />
            <span>Scene</span>
          </button>
          <button
            className={reactionTab === 'training' ? 'active' : ''}
            onClick={() => handleTabClick('reaction', 'training')}
          >
            <GraduationCap size={16} weight="duotone" />
            <span>Training</span>
          </button>
          <button
            className={reactionTab === 'export' ? 'active' : ''}
            onClick={() => handleTabClick('reaction', 'export')}
          >
            <Export size={16} weight="duotone" />
            <span>Export</span>
          </button>
        </div>

        <div className="control-panel__content">
          {reactionTab === 'presets' && <PresetsTab />}
          {reactionTab === 'pose' && <PoseExpressionTab />}
          {reactionTab === 'scene' && <SceneTab />}
          {reactionTab === 'training' && <TrainingTab />}
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
          onClick={() => handleTabClick('poselab', 'animations')}
        >
          <Play size={16} weight="duotone" />
          <span>Anims</span>
        </button>
        <button
          className={poseLabTab === 'poses' ? 'active' : ''}
          onClick={() => handleTabClick('poselab', 'poses')}
        >
          <UserFocus size={16} weight="duotone" />
          <span>Poses</span>
        </button>
        <button
          className={poseLabTab === 'mocap' ? 'active' : ''}
          onClick={() => handleTabClick('poselab', 'mocap')}
        >
          <VideoCamera size={16} weight="duotone" />
          <span>Mocap</span>
        </button>
        <button
          className={poseLabTab === 'director' ? 'active' : ''}
          onClick={() => handleTabClick('poselab', 'director')}
        >
          <FilmStrip size={16} weight="duotone" />
          <span>Director</span>
        </button>
        <button
          className={poseLabTab === 'export' ? 'active' : ''}
          onClick={() => handleTabClick('poselab', 'export')}
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

