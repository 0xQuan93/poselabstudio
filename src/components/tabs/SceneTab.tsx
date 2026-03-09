import { useState, useEffect, useRef } from 'react';
import { sceneManager } from '../../three/sceneManager';
import { backgroundOptions } from '../../three/backgrounds';
import { avatarManager } from '../../three/avatarManager';
import { useReactionStore } from '../../state/useReactionStore';
import { useToastStore } from '../../state/useToastStore';
import { useUIStore } from '../../state/useUIStore';
import { useSceneSettingsStore } from '../../state/useSceneSettingsStore';
import { useIntroStore } from '../../state/useIntroStore';
import { useAvatarSource } from '../../state/useAvatarSource';
import { useOnboardingStore } from '../../state/useOnboardingStore';
import { introSequence } from '../../intro/IntroSequence';
import { getOnboardingPersona, ONBOARDING_PERSONAS } from '../../data/onboardingPaths';
import { LIGHT_PRESETS } from '../../three/lightingManager';
import { POST_PRESETS } from '../../three/postProcessingManager';
import { HDRI_PRESETS, environmentManager } from '../../three/environmentManager';
import { MATERIAL_PRESETS, materialManager } from '../../three/materialManager';
import type { BackgroundId } from '../../types/reactions';
import { MultiplayerPanel } from '../MultiplayerPanel';
import { notifySceneChange } from '../../multiplayer/avatarBridge';
import { live2dManager } from '../../live2d/live2dManager';
import { AvatarLibraryModal } from '../AvatarLibraryModal';
import { 
  User, 
  Lightbulb, 
  Palette, 
  Sparkle, 
  Image, 
  FilmStrip, 
  Globe, 
  FilmSlate,
  CaretDown,
  ArrowsClockwise,
  Package,
  Lock,
  LockOpen,
  UploadSimple,
  Plus,
  FrameCorners,
  Play,
  Sun,
  MagnifyingGlass,
  Cube,
  Eye,
  EyeSlash,
  Trash,
} from '@phosphor-icons/react';
import { environment3DManager, type LoadedEnvironment } from '../../three/environment3DManager';
import { useEnvironmentLibraryStore } from '../../state/useEnvironmentLibraryStore';

type AspectRatio = '16:9' | '1:1' | '9:16';

// Collapsible Section Component
function Section({ 
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
    <div className="tab-section" style={{ marginBottom: '0.5rem' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1rem',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: '0.95rem',
          fontWeight: 600,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', color: 'var(--accent, #00ffd6)' }}>{icon}</span>
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
          padding: '1rem',
          background: 'var(--glass-bg)',
          borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          marginTop: '-4px',
          borderLeft: '1px solid var(--glass-border)',
          borderRight: '1px solid var(--glass-border)',
          borderBottom: '1px solid var(--glass-border)',
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Slider Component
function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        marginBottom: '0.25rem',
        fontSize: '0.8rem',
        color: 'var(--text-secondary)'
      }}>
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          height: '6px',
          borderRadius: '3px',
          background: 'var(--color-surface)',
          outline: 'none',
          cursor: 'pointer',
        }}
      />
    </div>
  );
}

// Toggle Component
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox-option" style={{ marginBottom: '0.5rem' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

// Preset Buttons
function PresetButtons({
  presets,
  activePreset,
  onSelect,
}: {
  presets: Record<string, { name: string }>;
  activePreset: string;
  onSelect: (preset: string) => void;
}) {
  return (
    <div style={{ 
      display: 'flex', 
      flexWrap: 'wrap', 
      gap: '4px',
      marginBottom: '1rem'
    }}>
      {Object.entries(presets).map(([id, preset]) => (
        <button
          key={id}
          className={activePreset === id ? 'secondary active' : 'secondary'}
          onClick={() => onSelect(id)}
          style={{ 
            flex: '1 1 calc(50% - 4px)', 
            fontSize: '0.75rem',
            padding: '0.5rem 0.75rem'
          }}
        >
          {preset.name}
        </button>
      ))}
    </div>
  );
}

export function SceneTab() {
  const { isAvatarReady, setAvatarReady } = useReactionStore();
  const { avatarType, sourceLabel, setFileSource, setLive2dSource } = useAvatarSource();
  const { addToast } = useToastStore();
  const { activeCssOverlay, setActiveCssOverlay } = useUIStore();
  const sceneSettings = useSceneSettingsStore();
  const { 
    backgroundLocked, 
    setBackgroundLocked,
    setCurrentBackground,
    setCustomBackground: setCustomBackgroundStore,
    setCustomBackgroundUrl,
    currentBackground: storeBackground,
    customBackgroundData,
    customBackgroundUrl,
    rotationLocked,
    setRotationLocked,
  } = useSceneSettingsStore();
  
  const [selectedBackground, setSelectedBackground] = useState(storeBackground || 'midnight-circuit');
  const [customBackground, setCustomBackground] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [isLoadingHdri, setIsLoadingHdri] = useState(false);
  const [isAvatarLibraryOpen, setIsAvatarLibraryOpen] = useState(false);
  
  // Filter presets into Default (Old) and Custom (New)
  const defaultEnvKeys = ['none', 'studio', 'outdoor', 'sunset', 'night', 'urban'];
  const defaultEnvironments = Object.fromEntries(
    Object.entries(HDRI_PRESETS).filter(([key]) => defaultEnvKeys.includes(key))
  );
  const customEnvironments = Object.fromEntries(
    Object.entries(HDRI_PRESETS).filter(([key]) => !defaultEnvKeys.includes(key))
  );
  
  const vrmInputRef = useRef<HTMLInputElement>(null);
  const live2dInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const hdriInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  
  // 3D Environment state
  const [loaded3DEnvironments, setLoaded3DEnvironments] = useState<LoadedEnvironment[]>([]);
  const [isLoading3DEnv, setIsLoading3DEnv] = useState(false);
  const [live2dExpression, setLive2dExpression] = useState('');
  const [live2dExpressionWeight, setLive2dExpressionWeight] = useState(0.8);
  const [live2dPhysicsEnabled, setLive2dPhysicsEnabled] = useState(true);
  const [live2dEyeTrackingEnabled, setLive2dEyeTrackingEnabled] = useState(true);
  const { selectedPersonaId, completedSteps, setPersona, toggleStep, resetPersona } = useOnboardingStore();
  const { 
    projects, 
    selectedProjectId, 
    assets: libraryAssets, 
    isLoadingProjects, 
    isLoadingAssets, 
    fetchProjects, 
    selectProject 
  } = useEnvironmentLibraryStore();

  const activePersona = getOnboardingPersona(selectedPersonaId) ?? ONBOARDING_PERSONAS[0];
  const personaCompletedSteps = completedSteps[activePersona.id] ?? [];
  const personaStepIds = new Set(activePersona.steps.map((step) => step.id));
  const personaCompletedCount = personaCompletedSteps.filter((stepId) => personaStepIds.has(stepId)).length;

  // Restore custom background from store on mount
  useEffect(() => {
    const storedUrl = customBackgroundUrl
      ?? (customBackgroundData
        ? `data:${useSceneSettingsStore.getState().customBackgroundType || 'image/png'};base64,${customBackgroundData}`
        : null);
    if (storedUrl) {
      setCustomBackground(storedUrl);
      if (storeBackground === 'custom') {
        sceneManager.setBackground(storedUrl);
      }
    }
  }, [customBackgroundData, customBackgroundUrl, storeBackground]);

  useEffect(() => {
    const currentRatio = sceneManager.getAspectRatio();
    setAspectRatio(currentRatio);
  }, []);

  useEffect(() => {
    if (!getOnboardingPersona(selectedPersonaId) && ONBOARDING_PERSONAS.length > 0) {
      setPersona(ONBOARDING_PERSONAS[0].id);
    }
  }, [selectedPersonaId, setPersona]);

  // Subscribe to 3D environment changes
  useEffect(() => {
    const unsubscribe = environment3DManager.onChange(() => {
      setLoaded3DEnvironments(environment3DManager.getAll());
    });
    // Initialize with current state
    setLoaded3DEnvironments(environment3DManager.getAll());
    
    // Fetch online library
    fetchProjects();
    
    return unsubscribe;
  }, [fetchProjects]);

  const handleVRMUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAvatarReady(false);
    try {
      setFileSource(file);
      addToast('Loading VRM avatar...', 'info');
    } catch (error) {
      console.error('Failed to load VRM:', error);
      addToast('Failed to load VRM file', 'error');
    }
  };

  const handleLive2DUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length) return;
    event.target.value = '';

    try {
      const zipFile = selectedFiles.length === 1 && selectedFiles[0].name.toLowerCase().endsWith('.zip');
      if (zipFile) {
        addToast('ZIP bundles are not supported yet. Please select the .model3.json and texture files directly.', 'warning');
        return;
      }

      setAvatarReady(false);
      const files = selectedFiles;
      const label = files.find((file) => file.name.toLowerCase().endsWith('.model3.json'))?.name ?? 'Live2D Avatar';
      await setLive2dSource(files, label);
      addToast('Live2D avatar loaded successfully', 'success');
    } catch (error) {
      console.error('Failed to load Live2D:', error);
      addToast(error instanceof Error ? error.message : 'Failed to load Live2D assets', 'error');
    }
  };

  const handleBackgroundUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      addToast('Please select an image or video file', 'warning');
      return;
    }

    const url = URL.createObjectURL(file);
    const typeUrl = `${url}#type=${file.type}`;
    
    setCustomBackground(typeUrl);
    setSelectedBackground('custom');
    await sceneManager.setBackground(typeUrl);
    setCustomBackgroundUrl(typeUrl);
    
    // Store base64 for persistence and multiplayer sync
    // Only for images that aren't too large (under 20MB for persistence, but we warn if > 5MB for sync)
    if (file.type.startsWith('image/') && file.size < 20 * 1024 * 1024) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        setCustomBackgroundStore(base64, file.type);
        
        // Notify multiplayer (will be handled by sync manager)
        if (file.size < 5 * 1024 * 1024) {
          notifySceneChange({ background: 'custom' });
        } else {
          addToast('Background saved to project (too large for live sync)', 'info');
        }
      };
      reader.readAsDataURL(file);
    } else {
      // Just update local state for large files or videos
      setCurrentBackground('custom');
      setBackgroundLocked(true);
      addToast('Background set (too large for multiplayer sync)', 'info');
    }
  };

  const handleHdriUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.hdr') && !file.name.toLowerCase().endsWith('.exr')) {
      addToast('Please select an HDR or EXR file', 'warning');
      return;
    }

    setIsLoadingHdri(true);
    try {
      await environmentManager.loadHDRIFromFile(file);
      sceneSettings.setEnvironment({ enabled: true });
      sceneSettings.setEnvironmentPreset('custom');
      addToast('HDRI loaded successfully', 'success');
    } catch (error) {
      console.error('Failed to load HDRI:', error);
      addToast('Failed to load HDRI file', 'error');
    } finally {
      setIsLoadingHdri(false);
    }
  };

  const handleGLBUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = ''; // Reset input

    if (!file.name.toLowerCase().endsWith('.glb')) {
      addToast('Please select a GLB file', 'warning');
      return;
    }

    setIsLoading3DEnv(true);
    try {
      const env = await environment3DManager.loadFromFile(file);
      addToast(`3D Environment "${env.name}" loaded`, 'success');
    } catch (error) {
      console.error('Failed to load 3D environment:', error);
      addToast('Failed to load 3D environment', 'error');
    } finally {
      setIsLoading3DEnv(false);
    }
  };

  const handle3DEnvScaleChange = (id: string, scale: number) => {
    environment3DManager.updateSettings(id, { scale });
  };

  const handle3DEnvPositionChange = (id: string, axis: 'x' | 'y' | 'z', value: number) => {
    const env = environment3DManager.get(id);
    if (env) {
      environment3DManager.updateSettings(id, {
        position: { ...env.settings.position, [axis]: value }
      });
    }
  };

  const handle3DEnvRotationChange = (id: string, axis: 'x' | 'y' | 'z', value: number) => {
    const env = environment3DManager.get(id);
    if (env) {
      environment3DManager.updateSettings(id, {
        rotation: { ...env.settings.rotation, [axis]: value }
      });
    }
  };

  const handleLibraryAssetSelect = async (asset: any) => {
    const url = asset.file || asset.url;
    if (!url) {
        addToast('No download URL for this asset', 'error');
        return;
    }
    
    setIsLoading3DEnv(true);
    addToast(`Downloading ${asset.name}...`, 'info');
    
    try {
      // Use proxy if needed for CORS? Assuming direct access for now or user provided CORS-enabled URL
      const env = await environment3DManager.loadFromUrl(url, asset.name);
      addToast(`Loaded ${env.name}`, 'success');
    } catch (error) {
      console.error('Failed to load asset:', error);
      addToast(`Failed to load ${asset.name}`, 'error');
    } finally {
      setIsLoading3DEnv(false);
    }
  };

  const handleBackgroundSelect = async (backgroundId: string) => {
    setSelectedBackground(backgroundId);
    setCurrentBackground(backgroundId);
    
    if (backgroundId === 'custom' && customBackground) {
      await sceneManager.setBackground(customBackground);
    } else {
      await sceneManager.setBackground(backgroundId as BackgroundId);
    }
    
    // Notify multiplayer peers if we're the host
    notifySceneChange({ background: backgroundId });
  };

  const handleEnvironmentSelect = async (envId: string) => {
    setSelectedBackground(envId);
    setCurrentBackground(envId);
    setIsLoadingHdri(true);
    addToast('Downloading 360° Environment...', 'info');
    
    try {
      // Enable environment and set preset
      await sceneSettings.setEnvironmentPreset(envId);
      sceneSettings.setEnvironment({ enabled: true });
      
      addToast('Environment loaded', 'success');
      
      // Notify multiplayer
      notifySceneChange({ background: envId });
    } catch (e) {
      console.error(e);
      addToast('Failed to load environment', 'error');
    } finally {
      setIsLoadingHdri(false);
    }
  };

  const handleAspectRatioChange = (ratio: AspectRatio) => {
    setAspectRatio(ratio);
    sceneManager.setAspectRatio(ratio);
    
    // Notify multiplayer peers if we're the host
    notifySceneChange({ aspectRatio: ratio });
  };

  const handleHdriPreset = async (presetId: string) => {
    setIsLoadingHdri(true);
    try {
      await sceneSettings.setEnvironmentPreset(presetId);
      if (presetId !== 'none') {
        addToast('Environment loaded', 'success');
      }
    } catch {
      addToast('Failed to load environment', 'error');
    } finally {
      setIsLoadingHdri(false);
    }
  };

  const vrmReady = avatarType === 'vrm' && isAvatarReady;

  return (
    <div className="tab-content" style={{ gap: '0.5rem' }}>
      {/* Avatar Section */}
      <Section title="Avatar" icon={<User size={18} weight="duotone" />} defaultOpen={!isAvatarReady}>
        <p className="muted small">Load or change the VRM or Live2D avatar</p>
        <button
          className={vrmReady ? 'secondary full-width' : 'primary full-width'}
          onClick={() => vrmInputRef.current?.click()}
        >
          {vrmReady ? <><ArrowsClockwise size={16} weight="duotone" /> Change Avatar</> : <><Package size={16} weight="duotone" /> Load VRM Avatar</>}
        </button>

        <button
          className="secondary full-width"
          onClick={() => setIsAvatarLibraryOpen(true)}
          style={{ marginTop: '0.5rem' }}
        >
          <Globe size={16} weight="duotone" /> Browse Avatar Library
        </button>

        <button
          className="secondary full-width"
          onClick={() => live2dInputRef.current?.click()}
          style={{ marginTop: '0.5rem' }}
        >
          {avatarType === 'live2d' ? <><ArrowsClockwise size={16} weight="duotone" /> Change Live2D Avatar</> : <><UploadSimple size={16} weight="duotone" /> Load Live2D Avatar</>}
        </button>
        
        {vrmReady && (
          <>
            <button
              className="secondary full-width"
              onClick={() => {
                const vrm = avatarManager.getVRM();
                if (vrm) sceneManager.frameObject(vrm.scene);
              }}
              style={{ marginTop: '0.5rem' }}
            >
              <MagnifyingGlass size={16} weight="duotone" /> Fit Avatar to Screen
            </button>
            
            {/* Rotation lock toggle */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginTop: '0.75rem',
              padding: '0.5rem 0.75rem',
              background: rotationLocked ? 'rgba(255, 193, 7, 0.1)' : 'rgba(255, 255, 255, 0.05)',
              borderRadius: '6px',
              border: rotationLocked ? '1px solid rgba(255, 193, 7, 0.3)' : '1px solid transparent',
            }}>
              <span className="small" style={{ color: rotationLocked ? '#ffc107' : 'var(--text-muted)' }}>
                {rotationLocked ? <><Lock size={14} weight="fill" /> Rotation locked</> : <><LockOpen size={14} weight="duotone" /> Rotation unlocked</>}
              </span>
              <button
                className={`secondary small ${rotationLocked ? 'active' : ''}`}
                onClick={() => {
                  const newLocked = !rotationLocked;
                  setRotationLocked(newLocked);
                  // Clear locked Hips rotation when unlocking
                  if (!newLocked) {
                    avatarManager.clearLockedHipsRotation();
                  }
                }}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                title={rotationLocked ? 'Unlock rotation (will change with poses)' : 'Lock rotation (won\'t change with poses)'}
              >
                {rotationLocked ? 'Unlock' : 'Lock'}
              </button>
            </div>
          </>
        )}

        {avatarType === 'live2d' && (
          <div style={{ marginTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.75rem' }}>
            <p className="muted small" style={{ marginBottom: '0.5rem' }}>
              Live2D Controls ({sourceLabel})
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input
                type="text"
                value={live2dExpression}
                onChange={(e) => setLive2dExpression(e.target.value)}
                placeholder="Expression name"
                style={{
                  flex: 1,
                  padding: '0.4rem 0.6rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-default)',
                  background: 'var(--color-surface)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                className="secondary small"
                onClick={() => live2dManager.setExpression(live2dExpression || 'neutral', live2dExpressionWeight)}
              >
                Apply
              </button>
            </div>
            <Slider
              label="Expression Weight"
              value={live2dExpressionWeight}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) => setLive2dExpressionWeight(value)}
            />
            <Toggle
              label="Physics Enabled"
              checked={live2dPhysicsEnabled}
              onChange={(enabled) => {
                setLive2dPhysicsEnabled(enabled);
                live2dManager.setPhysicsEnabled(enabled);
              }}
            />
            <Toggle
              label="Eye Tracking"
              checked={live2dEyeTrackingEnabled}
              onChange={(enabled) => {
                setLive2dEyeTrackingEnabled(enabled);
                live2dManager.setEyeTrackingEnabled(enabled);
              }}
            />
          </div>
        )}
        
        <input
          ref={vrmInputRef}
          type="file"
          accept=".vrm"
          onChange={handleVRMUpload}
          style={{ display: 'none' }}
        />
        <input
          ref={live2dInputRef}
          type="file"
          accept=".model3.json,.zip,.moc3,.json,image/*"
          multiple
          onChange={handleLive2DUpload}
          style={{ display: 'none' }}
        />
      </Section>

      <Section title="Creator Path" icon={<User size={18} weight="duotone" />} defaultOpen>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Choose a persona to get an evergreen checklist tailored to your workflow.
            </span>
            <select
              value={activePersona.id}
              onChange={(event) => setPersona(event.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                background: 'var(--color-surface)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
              }}
            >
              {ONBOARDING_PERSONAS.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {activePersona.description}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
              Progress: {personaCompletedCount}/{activePersona.steps.length}
            </span>
            <button
              className="secondary"
              onClick={() => resetPersona(activePersona.id)}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}
            >
              Reset
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {activePersona.steps.map((step) => {
              const isComplete = personaCompletedSteps.includes(step.id);
              return (
                <label
                  key={step.id}
                  style={{
                    display: 'flex',
                    gap: '0.6rem',
                    alignItems: 'flex-start',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.6rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isComplete}
                    onChange={() => toggleStep(activePersona.id, step.id)}
                    style={{ marginTop: '0.2rem', accentColor: 'var(--accent)' }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {step.title}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {step.description}
                    </span>
                    {step.cta && (
                      <span style={{ fontSize: '0.75rem', color: 'rgba(0, 255, 214, 0.8)' }}>
                        {step.cta}
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Lighting Section */}
      <Section title="Lighting" icon={<Lightbulb size={18} weight="duotone" />} defaultOpen={false}>
        <p className="muted small" style={{ marginBottom: '0.75rem' }}>
          3-point lighting presets for professional renders
        </p>
        
        <PresetButtons
          presets={LIGHT_PRESETS}
          activePreset={sceneSettings.lightingPreset}
          onSelect={(preset) => sceneSettings.setLightingPreset(preset)}
        />
        
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.75rem' }}>
          <Toggle
            label="Key Light (Main)"
            checked={sceneSettings.lighting.keyLight.enabled}
            onChange={(enabled) => sceneSettings.setLighting({ keyLight: { ...sceneSettings.lighting.keyLight, enabled } })}
          />
          {sceneSettings.lighting.keyLight.enabled && (
            <Slider
              label="Intensity"
              value={sceneSettings.lighting.keyLight.intensity}
              min={0}
              max={3}
              onChange={(intensity) => sceneSettings.setLighting({ keyLight: { ...sceneSettings.lighting.keyLight, intensity } })}
            />
          )}
          
          <Toggle
            label="Fill Light"
            checked={sceneSettings.lighting.fillLight.enabled}
            onChange={(enabled) => sceneSettings.setLighting({ fillLight: { ...sceneSettings.lighting.fillLight, enabled } })}
          />
          
          <Toggle
            label="Rim Light"
            checked={sceneSettings.lighting.rimLight.enabled}
            onChange={(enabled) => sceneSettings.setLighting({ rimLight: { ...sceneSettings.lighting.rimLight, enabled } })}
          />
          
          <Toggle
            label="Ambient Light"
            checked={sceneSettings.lighting.ambient.enabled}
            onChange={(enabled) => sceneSettings.setLighting({ ambient: { ...sceneSettings.lighting.ambient, enabled } })}
          />
        </div>
      </Section>

      {/* Material/Toon Shader Section */}
      <Section title="Toon Shader" icon={<Palette size={18} weight="duotone" />} defaultOpen={false}>
        <p className="muted small" style={{ marginBottom: '0.75rem' }}>
          VRM material and outline customization
        </p>
        
        <PresetButtons
          presets={MATERIAL_PRESETS}
          activePreset={sceneSettings.materialPreset}
          onSelect={(preset) => {
            sceneSettings.setMaterialPreset(preset);
            // Force reapply if avatar is loaded
            if (isAvatarReady) {
              materialManager.onVRMLoaded();
            }
          }}
        />
        
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.75rem' }}>
          <Toggle
            label="Outline Enabled"
            checked={sceneSettings.material.outline.enabled}
            onChange={(enabled) => sceneSettings.setMaterial({ outline: { ...sceneSettings.material.outline, enabled } })}
          />
          {sceneSettings.material.outline.enabled && (
            <Slider
              label="Outline Width"
              value={sceneSettings.material.outline.widthFactor}
              min={0}
              max={3}
              onChange={(widthFactor) => sceneSettings.setMaterial({ outline: { ...sceneSettings.material.outline, widthFactor } })}
            />
          )}
          
          <Slider
            label="Emissive Glow"
            value={sceneSettings.material.material.emissiveIntensity}
            min={0}
            max={3}
            onChange={(emissiveIntensity) => sceneSettings.setMaterial({ material: { ...sceneSettings.material.material, emissiveIntensity } })}
          />
          
          <Slider
            label="Rim Intensity"
            value={sceneSettings.material.shading.rimIntensity}
            min={0}
            max={1}
            onChange={(rimIntensity) => sceneSettings.setMaterial({ shading: { ...sceneSettings.material.shading, rimIntensity } })}
          />
          
          <button
            className="secondary full-width"
            onClick={() => materialManager.debugMaterials()}
            style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}
          >
            <MagnifyingGlass size={16} weight="duotone" /> Debug Materials (Console)
          </button>
        </div>
      </Section>

      {/* Post-Processing Section */}
      <Section title="Effects" icon={<Sparkle size={18} weight="duotone" />} defaultOpen={false}>
        <p className="muted small" style={{ marginBottom: '0.75rem' }}>
          Post-processing effects for cinematic looks
        </p>
        
        <PresetButtons
          presets={POST_PRESETS}
          activePreset={sceneSettings.postPreset}
          onSelect={(preset) => sceneSettings.setPostPreset(preset)}
        />
        
        {sceneSettings.postProcessing.enabled && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.75rem' }}>
            <Toggle
              label="Bloom"
              checked={sceneSettings.postProcessing.bloom.enabled}
              onChange={(enabled) => sceneSettings.setPostProcessing({ bloom: { ...sceneSettings.postProcessing.bloom, enabled } })}
            />
            {sceneSettings.postProcessing.bloom.enabled && (
              <>
                <Slider
                  label="Bloom Intensity"
                  value={sceneSettings.postProcessing.bloom.intensity}
                  min={0}
                  max={2}
                  onChange={(intensity) => sceneSettings.setPostProcessing({ bloom: { ...sceneSettings.postProcessing.bloom, intensity } })}
                />
                <Slider
                  label="Bloom Threshold"
                  value={sceneSettings.postProcessing.bloom.threshold}
                  min={0}
                  max={1}
                  onChange={(threshold) => sceneSettings.setPostProcessing({ bloom: { ...sceneSettings.postProcessing.bloom, threshold } })}
                />
              </>
            )}
            
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
              <Slider
                label="Brightness"
                value={sceneSettings.postProcessing.colorGrading.brightness}
                min={-0.5}
                max={0.5}
                onChange={(brightness) => sceneSettings.setPostProcessing({ colorGrading: { ...sceneSettings.postProcessing.colorGrading, brightness } })}
              />
              <Slider
                label="Contrast"
                value={sceneSettings.postProcessing.colorGrading.contrast}
                min={0.5}
                max={2}
                onChange={(contrast) => sceneSettings.setPostProcessing({ colorGrading: { ...sceneSettings.postProcessing.colorGrading, contrast } })}
              />
              <Slider
                label="Saturation"
                value={sceneSettings.postProcessing.colorGrading.saturation}
                min={0}
                max={2}
                onChange={(saturation) => sceneSettings.setPostProcessing({ colorGrading: { ...sceneSettings.postProcessing.colorGrading, saturation } })}
              />
            </div>
            
            <Toggle
              label="Vignette"
              checked={sceneSettings.postProcessing.vignette.enabled}
              onChange={(enabled) => sceneSettings.setPostProcessing({ vignette: { ...sceneSettings.postProcessing.vignette, enabled } })}
            />
            
            <Toggle
              label="Film Grain"
              checked={sceneSettings.postProcessing.filmGrain.enabled}
              onChange={(enabled) => sceneSettings.setPostProcessing({ filmGrain: { ...sceneSettings.postProcessing.filmGrain, enabled } })}
            />

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
              <Toggle
                label="Hue Shift"
                checked={sceneSettings.postProcessing.hueSaturation?.enabled ?? false}
                onChange={(enabled) => sceneSettings.setPostProcessing({ hueSaturation: { ...sceneSettings.postProcessing.hueSaturation, enabled } })}
              />
              {sceneSettings.postProcessing.hueSaturation?.enabled && (
                <>
                  <Slider
                    label="Hue"
                    value={sceneSettings.postProcessing.hueSaturation?.hue ?? 0}
                    min={-1}
                    max={1}
                    onChange={(hue) => sceneSettings.setPostProcessing({ hueSaturation: { ...sceneSettings.postProcessing.hueSaturation, hue } })}
                  />
                  <Slider
                    label="Saturation"
                    value={sceneSettings.postProcessing.hueSaturation?.saturation ?? 0}
                    min={-1}
                    max={1}
                    onChange={(saturation) => sceneSettings.setPostProcessing({ hueSaturation: { ...sceneSettings.postProcessing.hueSaturation, saturation } })}
                  />
                </>
              )}

              <Toggle
                label="Chromatic Aberration"
                checked={sceneSettings.postProcessing.chromaticAberration?.enabled ?? false}
                onChange={(enabled) => sceneSettings.setPostProcessing({ chromaticAberration: { ...sceneSettings.postProcessing.chromaticAberration, enabled } })}
              />
              {sceneSettings.postProcessing.chromaticAberration?.enabled && (
                <Slider
                  label="Amount"
                  value={sceneSettings.postProcessing.chromaticAberration?.amount ?? 0}
                  min={0}
                  max={0.05}
                  step={0.001}
                  onChange={(amount) => sceneSettings.setPostProcessing({ chromaticAberration: { ...sceneSettings.postProcessing.chromaticAberration, amount } })}
                />
              )}

              <Toggle
                label="Pixelate"
                checked={sceneSettings.postProcessing.pixelate?.enabled ?? false}
                onChange={(enabled) => sceneSettings.setPostProcessing({ pixelate: { ...sceneSettings.postProcessing.pixelate, enabled } })}
              />
              {sceneSettings.postProcessing.pixelate?.enabled && (
                <Slider
                  label="Pixel Size"
                  value={sceneSettings.postProcessing.pixelate?.pixelSize ?? 6}
                  min={1}
                  max={32}
                  step={1}
                  onChange={(pixelSize) => sceneSettings.setPostProcessing({ pixelate: { ...sceneSettings.postProcessing.pixelate, pixelSize } })}
                />
              )}

              <Toggle
                label="Glitch"
                checked={sceneSettings.postProcessing.glitch?.enabled ?? false}
                onChange={(enabled) => sceneSettings.setPostProcessing({ glitch: { ...sceneSettings.postProcessing.glitch, enabled } })}
              />
              {sceneSettings.postProcessing.glitch?.enabled && (
                <Toggle
                  label="Wild Mode"
                  checked={sceneSettings.postProcessing.glitch?.wild ?? false}
                  onChange={(wild) => sceneSettings.setPostProcessing({ glitch: { ...sceneSettings.postProcessing.glitch, wild } })}
                />
              )}
            </div>
          </div>
        )}
      </Section>

      {/* Environment/HDRI Section */}
      <Section title="Environment" icon={<Sun size={18} weight="duotone" />} defaultOpen={false}>
        <p className="muted small" style={{ marginBottom: '0.75rem' }}>
          HDRI environment maps for realistic lighting and reflections
        </p>
        
        <PresetButtons
          presets={defaultEnvironments}
          activePreset={sceneSettings.environmentPreset}
          onSelect={handleHdriPreset}
        />
        
        {isLoadingHdri && (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#00ffd6' }}>
            Loading environment...
          </div>
        )}
        
        <button
          className="secondary full-width"
          onClick={() => hdriInputRef.current?.click()}
          disabled={isLoadingHdri}
        >
          <UploadSimple size={16} weight="duotone" /> Upload Custom HDR
        </button>
        <input
          ref={hdriInputRef}
          type="file"
          accept=".hdr,.exr"
          onChange={handleHdriUpload}
          style={{ display: 'none' }}
        />
        
        {sceneSettings.environment.enabled && (
          <div style={{ marginTop: '0.75rem' }}>
            <Slider
              label="Environment Intensity"
              value={sceneSettings.environment.intensity}
              min={0}
              max={3}
              onChange={(intensity) => sceneSettings.setEnvironment({ intensity })}
            />
            <Slider
              label="Background Blur"
              value={sceneSettings.environment.backgroundBlur}
              min={0}
              max={1}
              onChange={(backgroundBlur) => sceneSettings.setEnvironment({ backgroundBlur })}
            />
            <Slider
              label="Rotation"
              value={sceneSettings.environment.rotation}
              min={0}
              max={360}
              step={1}
              onChange={(rotation) => sceneSettings.setEnvironment({ rotation })}
            />
          </div>
        )}
      </Section>

      {/* 3D Environments Section */}
      <Section title="3D Environments" icon={<Cube size={18} weight="duotone" />} defaultOpen={false}>
        <p className="muted small" style={{ marginBottom: '0.75rem' }}>
          Load 3D GLB environments to create immersive scenes
        </p>
        
        <button
          className="primary full-width"
          onClick={() => glbInputRef.current?.click()}
          disabled={isLoading3DEnv}
        >
          {isLoading3DEnv ? (
            <>Loading...</>
          ) : (
            <><UploadSimple size={16} weight="duotone" /> Upload GLB Environment</>
          )}
        </button>
        <input
          ref={glbInputRef}
          type="file"
          accept=".glb"
          onChange={handleGLBUpload}
          style={{ display: 'none' }}
        />
        
        {loaded3DEnvironments.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ 
              fontSize: '0.8rem', 
              color: 'var(--text-secondary)', 
              marginBottom: '0.5rem',
              fontWeight: 600
            }}>
              Loaded Environments ({loaded3DEnvironments.length})
            </div>
            
            {loaded3DEnvironments.map((env) => (
              <div 
                key={env.id}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem',
                  marginBottom: '0.5rem',
                }}
              >
                {/* Header */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  marginBottom: '0.5rem'
                }}>
                  <span style={{ 
                    fontSize: '0.85rem', 
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <Cube size={14} weight="duotone" style={{ color: 'var(--accent)' }} />
                    {env.name}
                  </span>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button
                      className="secondary small"
                      onClick={() => environment3DManager.toggleVisible(env.id)}
                      title={env.settings.visible ? 'Hide' : 'Show'}
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      {env.settings.visible ? <Eye size={14} /> : <EyeSlash size={14} />}
                    </button>
                    <button
                      className="secondary small"
                      onClick={() => environment3DManager.remove(env.id)}
                      title="Remove"
                      style={{ padding: '0.25rem 0.5rem', color: '#ff6b6b' }}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
                
                {/* Controls */}
                <Slider
                  label="Scale"
                  value={env.settings.scale}
                  min={0.01}
                  max={10}
                  step={0.01}
                  onChange={(value) => handle3DEnvScaleChange(env.id, value)}
                />
                
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(3, 1fr)', 
                  gap: '0.5rem',
                  marginTop: '0.5rem'
                }}>
                  <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Pos X</label>
                    <input
                      type="number"
                      value={env.settings.position.x.toFixed(2)}
                      onChange={(e) => handle3DEnvPositionChange(env.id, 'x', parseFloat(e.target.value) || 0)}
                      step="0.1"
                      style={{
                        width: '100%',
                        padding: '0.3rem',
                        borderRadius: '4px',
                        border: '1px solid var(--border-default)',
                        background: 'var(--color-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '0.75rem'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Pos Y</label>
                    <input
                      type="number"
                      value={env.settings.position.y.toFixed(2)}
                      onChange={(e) => handle3DEnvPositionChange(env.id, 'y', parseFloat(e.target.value) || 0)}
                      step="0.1"
                      style={{
                        width: '100%',
                        padding: '0.3rem',
                        borderRadius: '4px',
                        border: '1px solid var(--border-default)',
                        background: 'var(--color-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '0.75rem'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Pos Z</label>
                    <input
                      type="number"
                      value={env.settings.position.z.toFixed(2)}
                      onChange={(e) => handle3DEnvPositionChange(env.id, 'z', parseFloat(e.target.value) || 0)}
                      step="0.1"
                      style={{
                        width: '100%',
                        padding: '0.3rem',
                        borderRadius: '4px',
                        border: '1px solid var(--border-default)',
                        background: 'var(--color-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '0.75rem'
                      }}
                    />
                  </div>
                </div>
                
                <Slider
                  label="Rotation Y"
                  value={env.settings.rotation.y}
                  min={0}
                  max={360}
                  step={1}
                  onChange={(value) => handle3DEnvRotationChange(env.id, 'y', value)}
                />
                
                <Toggle
                  label="Receive Shadows"
                  checked={env.settings.receiveShadow}
                  onChange={(checked) => environment3DManager.updateSettings(env.id, { receiveShadow: checked })}
                />
              </div>
            ))}
            
            {loaded3DEnvironments.length > 1 && (
              <button
                className="secondary full-width"
                onClick={() => environment3DManager.removeAll()}
                style={{ 
                  marginTop: '0.5rem',
                  color: '#ff6b6b',
                  borderColor: 'rgba(255, 107, 107, 0.3)'
                }}
              >
                <Trash size={14} /> Remove All Environments
              </button>
            )}
          </div>
        )}
        
        {loaded3DEnvironments.length === 0 && (
          <p className="muted small" style={{ marginTop: '0.75rem', textAlign: 'center', opacity: 0.6 }}>
            No 3D environments loaded. Upload a GLB file to get started.
          </p>
        )}
      </Section>

      {/* Online Library Section - Temporarily Disabled */}
      {false && (
      <Section title="Online Library" icon={<Globe size={18} weight="duotone" />} defaultOpen={false}>
        <p className="muted small" style={{ marginBottom: '0.75rem' }}>
          Browse and download free 3D environments from the community
        </p>

        {isLoadingProjects ? (
             <div style={{ textAlign: 'center', padding: '1rem', color: '#00ffd6' }}>
                Loading library...
             </div>
        ) : (
             <>
                 <select 
                    value={selectedProjectId || ''} 
                    onChange={(e) => selectProject(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '0.5rem',
                        marginBottom: '1rem',
                        background: 'var(--color-surface)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-default)',
                        borderRadius: '6px'
                    }}
                 >
                    <option value="" disabled>Select a Collection</option>
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                 </select>

                 {selectedProjectId && (
                     <>
                        {isLoadingAssets ? (
                            <div style={{ textAlign: 'center', padding: '1rem', color: '#00ffd6' }}>
                                Loading assets...
                            </div>
                        ) : libraryAssets.length > 0 ? (
                            <div className="background-grid">
                                {libraryAssets.map(asset => (
                                    <button
                                        key={asset.id || asset.name}
                                        className="background-thumbnail"
                                        onClick={() => handleLibraryAssetSelect(asset)}
                                        title={asset.description || asset.name}
                                    >
                                        <div className="background-thumbnail__preview" style={{
                                            backgroundImage: asset.thumbnail ? `url(${asset.thumbnail})` : 'none',
                                            backgroundColor: '#2a2a2a',
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            {!asset.thumbnail && <Cube size={24} weight="duotone" style={{ opacity: 0.5 }} />}
                                        </div>
                                        <span className="background-thumbnail__name">{asset.name}</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '1rem', opacity: 0.6 }}>
                                No assets found in this collection.
                            </div>
                        )}
                     </>
                 )}
             </>
        )}
      </Section>
      )}

      {/* Backgrounds Section */}
      <Section title="Backgrounds" icon={<Image size={18} weight="duotone" />} defaultOpen={false}>
        {/* Lock toggle */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
          padding: '0.5rem 0.75rem',
          background: backgroundLocked ? 'rgba(255, 193, 7, 0.1)' : 'rgba(255, 255, 255, 0.05)',
          borderRadius: '6px',
          border: backgroundLocked ? '1px solid rgba(255, 193, 7, 0.3)' : '1px solid transparent',
        }}>
          <span className="small" style={{ color: backgroundLocked ? '#ffc107' : 'var(--text-muted)' }}>
            {backgroundLocked ? <><Lock size={14} weight="fill" /> Background locked</> : <><LockOpen size={14} weight="duotone" /> Background unlocked</>}
          </span>
          <button
            className={`secondary small ${backgroundLocked ? 'active' : ''}`}
            onClick={() => setBackgroundLocked(!backgroundLocked)}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            title={backgroundLocked ? 'Unlock background (will change with poses)' : 'Lock background (won\'t change with poses)'}
          >
            {backgroundLocked ? 'Unlock' : 'Lock'}
          </button>
        </div>
        
        <div className="background-grid">
          <button
            className={`background-thumbnail ${selectedBackground === 'custom' ? 'active' : ''}`}
            onClick={() => customBackground ? handleBackgroundSelect('custom') : bgInputRef.current?.click()}
            title="Upload Custom Background"
          >
            <div className="background-thumbnail__preview" style={{
              backgroundImage: customBackground ? `url(${customBackground})` : 'none',
              backgroundColor: '#2a2a2a',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {!customBackground && <Plus size={24} weight="bold" />}
            </div>
            <span className="background-thumbnail__name">Custom</span>
          </button>

          {backgroundOptions.map((bg) => (
            <button
              key={bg.id}
              className={`background-thumbnail ${selectedBackground === bg.id ? 'active' : ''}`}
              onClick={() => handleBackgroundSelect(bg.id)}
              title={bg.label}
            >
              <div className="background-thumbnail__preview" style={{
                backgroundImage: bg.image ? `url(${bg.image})` : 'none',
                backgroundColor: bg.image ? 'transparent' : String(bg.color),
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }} />
              <span className="background-thumbnail__name">{bg.label}</span>
            </button>
          ))}
        </div>

        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem', 
          margin: '1rem 0 0.5rem', 
          color: 'var(--text-tertiary)', 
          fontSize: '0.8rem', 
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          <span style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }}></span>
          <Sun size={14} weight="duotone" /> 360° Environments
          <span style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }}></span>
        </div>

        <div className="background-grid">
           {Object.entries(customEnvironments).map(([id, preset]) => (
            <button
              key={id}
              className={`background-thumbnail ${selectedBackground === id ? 'active' : ''}`}
              onClick={() => handleEnvironmentSelect(id)}
              title={preset.name}
            >
              <div className="background-thumbnail__preview" style={{
                backgroundImage: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem'
              }}>
                <Globe size={24} weight="duotone" style={{ opacity: 0.5, color: '#00ffd6' }} />
              </div>
              <span className="background-thumbnail__name">{preset.name}</span>
            </button>
           ))}
        </div>
        
        {HDRI_PRESETS[selectedBackground] && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '1rem', 
            background: 'rgba(255, 255, 255, 0.03)', 
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)'
          }}>
            <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sun size={16} weight="duotone" /> Environment Settings
            </div>
            <Slider
              label="Rotation"
              value={sceneSettings.environment.rotation}
              min={0}
              max={360}
              step={1}
              onChange={(rotation) => sceneSettings.setEnvironment({ rotation })}
            />
            <Slider
              label="Blur"
              value={sceneSettings.environment.backgroundBlur}
              min={0}
              max={1}
              onChange={(backgroundBlur) => sceneSettings.setEnvironment({ backgroundBlur })}
            />
            <Slider
              label="Intensity"
              value={sceneSettings.environment.intensity}
              min={0}
              max={3}
              onChange={(intensity) => sceneSettings.setEnvironment({ intensity })}
            />
          </div>
        )}

        <button 
          className="secondary full-width"
          onClick={() => bgInputRef.current?.click()}
          style={{ marginTop: '0.75rem' }}
        >
          <UploadSimple size={16} weight="duotone" /> Upload Background
        </button>
        <input
          ref={bgInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={handleBackgroundUpload}
          style={{ display: 'none' }}
        />
      </Section>

      {/* FX Overlays */}
      <Section title="FX Overlays" icon={<FilmStrip size={18} weight="duotone" />} defaultOpen={false}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {['overlay-scanlines', 'overlay-vignette', 'overlay-glitch', 'overlay-crt'].map((overlay) => (
            <button
              key={overlay}
              className={activeCssOverlay === overlay ? 'secondary active' : 'secondary'}
              onClick={() => setActiveCssOverlay(activeCssOverlay === overlay ? null : overlay)}
              style={{ flex: '1 1 calc(50% - 4px)', fontSize: '0.75rem' }}
            >
              {overlay.replace('overlay-', '').charAt(0).toUpperCase() + overlay.replace('overlay-', '').slice(1)}
            </button>
          ))}
        </div>
      </Section>

      {/* Aspect Ratio */}
      <Section title="Aspect Ratio" icon={<FrameCorners size={18} weight="duotone" />} defaultOpen={false}>
        <div className="button-group" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {(['16:9', '1:1', '9:16'] as AspectRatio[]).map((ratio) => (
            <button
              key={ratio}
              className={aspectRatio === ratio ? 'secondary active' : 'secondary'}
              onClick={() => handleAspectRatioChange(ratio)}
              style={{ flex: '1 1 80px' }}
            >
              {ratio}
            </button>
          ))}
        </div>
      </Section>

      {/* Intro Sequence */}
      <IntroSection />

      {/* Co-op / Multiplayer */}
      <Section title="Co-op Session" icon={<Globe size={18} weight="duotone" />} defaultOpen={false}>
        <MultiplayerPanel />
      </Section>

      {isAvatarLibraryOpen && <AvatarLibraryModal onClose={() => setIsAvatarLibraryOpen(false)} />}
    </div>
  );
}

/** Intro Sequence Settings Section */
function IntroSection() {
  const { 
    enabled, 
    sequenceId, 
    autoCapture, 
    isPlaying,
    randomSnapshotInterval,
    autoCaptures,
    setEnabled, 
    setSequenceId, 
    setAutoCapture,
    setRandomSnapshotInterval,
    clearAutoCaptures,
    downloadAutoCapture,
  } = useIntroStore();
  
  const isAvatarReady = useReactionStore((s) => s.isAvatarReady);
  const addToast = useToastStore((s) => s.addToast);
  
  const sequenceIds = introSequence.getSequenceIds();
  
  const handlePlayNow = async () => {
    if (!isAvatarReady) {
      addToast('Load an avatar first!', 'warning');
      return;
    }
    
    useIntroStore.getState().setPlaying(true);
    await introSequence.play(sequenceId);
    useIntroStore.getState().setPlaying(false);
  };
  
  return (
    <Section title="Sequence" icon={<FilmSlate size={18} weight="duotone" />} defaultOpen={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Enable Toggle */}
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.75rem',
          cursor: 'pointer'
        }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
          />
          <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
            Play intro on avatar load
          </span>
        </label>
        
        {/* Sequence Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Intro Style
          </label>
          <select
            value={sequenceId}
            onChange={(e) => setSequenceId(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              background: 'var(--color-surface)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
            }}
          >
            {sequenceIds.map((id) => {
              const info = introSequence.getSequenceInfo(id);
              return (
                <option key={id} value={id}>
                  {info?.name || id} ({info?.duration}s)
                </option>
              );
            })}
          </select>
        </div>
        
        {/* Auto-Capture Toggle */}
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.75rem',
          cursor: 'pointer'
        }}>
          <input
            type="checkbox"
            checked={autoCapture}
            onChange={(e) => setAutoCapture(e.target.checked)}
            style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
          />
          <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
            Auto-capture at key moments
          </span>
        </label>
        
        {/* Random Snapshot Interval */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Random Auto-Snapshot ({randomSnapshotInterval === 0 ? 'Off' : `Every ${randomSnapshotInterval}s`})
          </label>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={randomSnapshotInterval}
            onChange={(e) => setRandomSnapshotInterval(parseInt(e.target.value))}
            style={{ accentColor: 'var(--accent)' }}
          />
        </div>
        
        {/* Play Now Button */}
        <button
          onClick={handlePlayNow}
          disabled={!isAvatarReady || isPlaying}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-md)',
            background: isPlaying 
              ? 'rgba(255, 255, 255, 0.1)' 
              : 'linear-gradient(135deg, rgba(0, 255, 214, 0.2), rgba(0, 200, 180, 0.15))',
            border: '1px solid rgba(0, 255, 214, 0.3)',
            color: '#00ffd6',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: isAvatarReady && !isPlaying ? 'pointer' : 'not-allowed',
            opacity: isAvatarReady ? 1 : 0.5,
          }}
        >
          {isPlaying ? <><FilmSlate size={16} weight="duotone" /> Playing...</> : <><Play size={16} weight="fill" /> Play Intro Now</>}
        </button>
        
        {/* Auto-Captured Gallery */}
        {autoCaptures.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '0.5rem' 
            }}>
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)' }}>
                Auto-Captured ({autoCaptures.length})
              </span>
              <button
                onClick={clearAutoCaptures}
                style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  background: 'rgba(255, 100, 100, 0.2)',
                  border: '1px solid rgba(255, 100, 100, 0.3)',
                  color: '#ff8888',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                Clear All
              </button>
            </div>
            <div style={{ 
              display: 'flex', 
              gap: '0.5rem', 
              overflowX: 'auto',
              padding: '0.25rem 0',
            }}>
              {autoCaptures.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Capture ${i + 1}`}
                  onClick={() => downloadAutoCapture(i)}
                  style={{
                    width: '60px',
                    height: '60px',
                    objectFit: 'cover',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  title="Click to download"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
