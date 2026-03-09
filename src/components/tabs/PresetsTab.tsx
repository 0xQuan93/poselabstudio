import { useState } from 'react';
import { useReactionStore } from '../../state/useReactionStore';
import { reactionPresets } from '../../data/reactions';
import { 
  PersonSimpleRun, 
  Smiley, 
  Armchair, 
  CaretDown 
} from '@phosphor-icons/react';

// Preset Categories
const PRESET_CATEGORIES = {
  action: {
    title: 'Action & Motion',
    icon: <PersonSimpleRun size={18} weight="duotone" />,
    ids: ['dawn-runner', 'nebula-drift', 'rope-climb', 'climb-top', 'treading-water']
  },
  emotes: {
    title: 'Emotes & Social',
    icon: <Smiley size={18} weight="duotone" />,
    ids: ['simple-wave', 'point', 'thumbs-up', 'cheering', 'agent-clapping', 'agent-dance', 'silly-agent', 'agent-taunt']
  },
  idle: {
    title: 'Idle & Mood',
    icon: <Armchair size={18} weight="duotone" />,
    ids: ['sunset-call', 'cipher-whisper', 'signal-reverie', 'offensive-idle', 'waking', 'defeat', 'focus']
  }
};

// Collapsible Section
function PresetSection({ 
  title, 
  icon, 
  children, 
  defaultOpen = false 
}: { 
  title: string; 
  icon: React.ReactNode; 
  children: React.ReactNode; 
  defaultOpen?: boolean; 
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: '0.9rem',
          fontWeight: 600,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>{icon}</span>
          <span>{title}</span>
        </span>
        <CaretDown 
          size={16} 
          weight="bold"
          style={{ 
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        />
      </button>
      {isOpen && (
        <div style={{ 
          padding: '0.5rem',
          background: 'rgba(0, 0, 0, 0.2)',
          borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          marginTop: '-4px',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          borderRight: '1px solid rgba(255, 255, 255, 0.1)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '0.5rem'
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function PresetsTab() {
  const { activePreset, setPresetById, isAvatarReady } = useReactionStore();

  const handlePresetClick = (presetId: string) => {
    setPresetById(presetId);
  };

  return (
    <div className="tab-content">
      <div className="tab-section">
        <h3>Reaction Library</h3>
        <p className="muted small">Select a preset to apply pose, expression, and background</p>
      </div>

      <div className="preset-categories">
        {Object.values(PRESET_CATEGORIES).map((category) => (
          <PresetSection 
            key={category.title} 
            title={category.title} 
            icon={category.icon}
            defaultOpen={category.ids.includes(activePreset.id)}
          >
            {category.ids.map(id => {
              const preset = reactionPresets.find(p => p.id === id);
              if (!preset) return null;
              const isActive = activePreset.id === id;
              
              return (
                <button
                  key={id}
                  className={isActive ? 'secondary active' : 'secondary'}
                  onClick={() => handlePresetClick(id)}
                  disabled={!isAvatarReady}
                  style={{ 
                    fontSize: '0.75rem', 
                    padding: '0.6rem 0.5rem', 
                    height: 'auto',
                    textAlign: 'center',
                    justifyContent: 'center',
                    border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
                    background: isActive ? 'rgba(0, 255, 214, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    alignItems: 'center'
                  }}
                  title={preset.description}
                >
                  <span style={{ fontWeight: 600 }}>{preset.label}</span>
                </button>
              );
            })}
          </PresetSection>
        ))}
      </div>
    </div>
  );
}
