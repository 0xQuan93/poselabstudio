import { useState, useEffect } from 'react';
import { geminiService } from '../../services/gemini';
import { useCustomPoseStore } from '../../state/useCustomPoseStore';
import { useToastStore } from '../../state/useToastStore';
import { avatarManager } from '../../three/avatarManager';
import { apiKeyStorage } from '../../utils/secureStorage';
import type { VRMPose } from '@pixiv/three-vrm';
import { useSceneSettingsStore } from '../../state/useSceneSettingsStore';
import { 
  Robot, 
  Sparkle, 
  MagnifyingGlass, 
  FloppyDisk, 
  DownloadSimple, 
  UploadSimple, 
  Trash, 
  Check,
  Lock,
  ArrowClockwise,
  CaretDown
} from '@phosphor-icons/react';
import { Button } from '../../design-system/Button';
import { Input } from '../../design-system/Input';
import { Panel } from '../../design-system/Panel';

export function AIGeneratorTab() {
  const { addCustomPose, customPoses, removeCustomPose, importPoses } = useCustomPoseStore();
  const { addToast } = useToastStore();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedPose, setGeneratedPose] = useState<VRMPose | null>(null);
  const [generatedAnimation, setGeneratedAnimation] = useState<{ data: any; loop: boolean } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash');
  const [customModelInput, setCustomModelInput] = useState('');
  const [useLimits, setUseLimits] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isLoop, setIsLoop] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [rawResponse, setRawResponse] = useState('');
  const rotationLocked = useSceneSettingsStore((state) => state.rotationLocked);
  
  // Use environment variable for API Key (highest priority)
  const envApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  
  // State for user-provided API key (secure storage)
  const [userApiKey, setUserApiKey] = useState('');

  // Effective API key (env takes priority)
  const apiKey = envApiKey || userApiKey;

  // On mount, migrate and load stored key
  useEffect(() => {
    apiKeyStorage.migrate();
    const storedKey = apiKeyStorage.get();
    if (storedKey) {
      setUserApiKey(storedKey);
    }
  }, []);

  useEffect(() => {
    if (apiKey) {
      geminiService.initialize(apiKey);
    }
  }, [apiKey]);

  const handleSaveKey = (key: string) => {
    apiKeyStorage.set(key, true); // Persistent for this tab since it's a power-user feature
    setUserApiKey(key);
  };

  const handleClearKey = () => {
    apiKeyStorage.remove();
    setUserApiKey('');
  };

  const handleCheckModels = async () => {
    try {
      if (!apiKey) throw new Error('No API Key');
      const models = await geminiService.listAvailableModels();
      setAvailableModels(models);
      setShowModels(true);
      if (models.length > 0 && !models.includes(selectedModel)) {
        // If current default isn't in list, switch to first available
        setSelectedModel(models[0]);
        geminiService.setModel(models[0]);
      }
    } catch (err: any) {
      setError('Failed to list models: ' + err.message);
    }
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    setSelectedModel(model);
    if (model !== 'custom') {
      geminiService.setModel(model);
    }
  };
  
  const handleCustomModelBlur = () => {
    if (customModelInput.trim()) {
      geminiService.setModel(customModelInput.trim());
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    setGeneratedPose(null);
    setGeneratedAnimation(null);
    
    try {
      if (!apiKey) {
        throw new Error('API Key is missing. Please check your .env file.');
      }
      
      // Ensure service is initialized and model set
      if (selectedModel === 'custom' && customModelInput.trim()) {
         geminiService.setModel(customModelInput.trim());
      } else {
         geminiService.setModel(selectedModel);
      }
      
      const result = await geminiService.generatePose(prompt, useLimits, isAnimating, isLoop);
      
      if (result && (result.vrmPose || (result as any).tracks)) {
        if ((result as any).tracks) {
           setGeneratedAnimation({ data: result, loop: isLoop });
           await avatarManager.applyRawPose(result, rotationLocked, isLoop ? 'loop' : 'once'); // Play animation
        } else if (result.vrmPose) {
           setGeneratedPose(result.vrmPose);
           await avatarManager.applyRawPose({ vrmPose: result.vrmPose, expressions: result.expressions, sceneRotation: result.sceneRotation }, rotationLocked, 'static');
        }

        // Apply background if returned
        if ((result as any).background) {
           await (await import('../../three/sceneManager')).sceneManager.setBackground((result as any).background);
           addToast(`AI set background to: ${(result as any).background}`, 'info');
        }

        setRawResponse(result.rawJson || '');
      } else {
        throw new Error('Invalid response format from AI');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    if (!generatedPose) return;
    
    // Create a default name from prompt
    const defaultName = prompt.split(' ').slice(0, 4).join(' ') + (prompt.split(' ').length > 4 ? '...' : '');
    const name = window.prompt('Name this pose:', defaultName);
    
    if (name) {
      addCustomPose({
        name,
        description: prompt,
        poseData: { vrmPose: generatedPose }
      });
      setGeneratedPose(null);
      setPrompt('');
    }
  };

  const handleApplySaved = (poseData: { vrmPose: VRMPose }) => {
    avatarManager.applyRawPose(poseData, rotationLocked, 'static');
  };

  const handleExportPose = (pose: any) => {
    const dataStr = JSON.stringify(pose.poseData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pose.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportLibrary = () => {
    const dataStr = JSON.stringify(customPoses, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poselab-library-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportLibrary = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (Array.isArray(json)) {
            importPoses(json);
            addToast(`Successfully imported ${json.length} poses!`, 'success');
        } else {
            addToast('Invalid file format: Expected an array of poses.', 'error');
        }
      } catch (err) {
        console.error(err);
        addToast('Failed to parse JSON file.', 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  if (!apiKey) {
    return (
      <div className="tab-content">
        <Panel title="AI Setup Required">
          <div style={{ padding: '4px' }}>
            <p className="muted small" style={{ marginBottom: '16px' }}>
              To use the AI generator, you need a Google Gemini API Key. This enables advanced pose generation and animation capabilities.
            </p>
            
            <div style={{ marginBottom: '16px' }}>
              <Input
                label="Gemini API Key"
                type="password"
                placeholder="AIzaSy..."
                value={userApiKey}
                onChange={(e) => setUserApiKey(e.target.value)}
                leftIcon={<Lock size={16} weight="duotone" />}
              />
              <Button 
                variant="primary"
                style={{ width: '100%', marginTop: '12px' }}
                onClick={() => handleSaveKey(userApiKey)}
                disabled={!userApiKey.trim()}
                leftIcon={<Check size={16} weight="bold" />}
              >
                Initialize Brain
              </Button>
            </div>
            
            <p className="small muted" style={{ fontSize: '0.75rem' }}>
              Your key is stored locally and sent directly to Google.
              <br />
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                Get a free key at Google AI Studio
              </a>
            </p>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="tab-section" style={{ background: 'var(--glass-bg)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', border: '1px solid var(--border-subtle)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', textTransform: 'uppercase', fontSize: 'var(--text-sm)', letterSpacing: '0.1em' }}>
            AI Pose Synthesis
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="status-indicator" style={{ background: 'rgba(0, 255, 214, 0.1)', padding: '2px 8px', borderRadius: 'var(--radius-full)', border: '1px solid rgba(0, 255, 214, 0.2)' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 'bold' }}>
                {envApiKey ? 'SYSTEM' : `LOCAL: ...${apiKey.slice(-4)}`}
              </span>
            </div>
            {!envApiKey && (
              <button 
                className="icon-button"
                onClick={handleClearKey}
                title="Change API Key"
                style={{ width: '24px', height: '24px' }}
              >
                <ArrowClockwise size={14} weight="bold" />
              </button>
            )}
          </div>
        </div>

        {/* Model Selection */}
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Neural Model</label>
            <div className="select-wrapper" style={{ position: 'relative' }}>
              <select 
                className="text-input" 
                value={selectedModel} 
                onChange={handleModelChange}
                style={{ width: '100%', paddingRight: '30px' }}
              >
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fast)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Powerful)</option>
                <option value="gemini-pro">Gemini Pro Legacy</option>
                {availableModels.map(m => (
                   !['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'].includes(m) && 
                   <option key={m} value={m}>{m}</option>
                ))}
                <option value="custom">Custom ID...</option>
              </select>
              <CaretDown size={14} weight="bold" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.5 }} />
            </div>
          </div>
          {selectedModel === 'custom' && (
            <div style={{ flex: 1 }}>
              <Input
                type="text"
                placeholder="e.g. gemini-1.0-pro"
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                onBlur={handleCustomModelBlur}
              />
            </div>
          )}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Creative Prompt</label>
          <textarea
            className="text-input"
            placeholder="Describe a pose or action... (e.g. 'Superhero landing with glowing hands')"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{ minHeight: '100px', resize: 'vertical', width: '100%', marginBottom: '12px' }}
            disabled={isGenerating}
          />
          
          {error && (
            <div className="error-message" style={{ color: 'var(--error)', fontSize: '0.8rem', marginBottom: '12px', padding: '8px', background: 'rgba(255, 51, 102, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255, 51, 102, 0.2)' }}>
              Sequence Error: {error}
            </div>
          )}

          <Button
            variant="primary"
            style={{ width: '100%' }}
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            leftIcon={isGenerating ? <ArrowClockwise size={18} weight="bold" className="spin" /> : <Sparkle size={18} weight="fill" />}
          >
            {isGenerating ? 'Synthesizing...' : 'Generate Neural Pose'}
          </Button>
        </div>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-lg)' }}>
          <label className="ai-remember-key" style={{ margin: 0 }}>
            <input type="checkbox" checked={useLimits} onChange={(e) => setUseLimits(e.target.checked)} />
            <span>Bio-Limits</span>
          </label>
          
          <label className="ai-remember-key" style={{ margin: 0 }}>
            <input type="checkbox" checked={isAnimating} onChange={(e) => setIsAnimating(e.target.checked)} />
            <span>Animate</span>
          </label>

          {isAnimating && (
            <label className="ai-remember-key" style={{ margin: 0 }}>
              <input type="checkbox" checked={isLoop} onChange={(e) => setIsLoop(e.target.checked)} />
              <span>Loop</span>
            </label>
          )}
          
          <button 
            className="text-accent small" 
            onClick={() => setShowDebug(!showDebug)}
            style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 'bold', marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}
          >
            {showDebug ? '[ Hide Debug ]' : '[ Show Debug ]'}
          </button>
        </div>

        {showDebug && (
          <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(0,0,0,0.4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
            <Button 
              variant="secondary"
              size="small"
              style={{ width: '100%', marginBottom: '12px' }}
              onClick={handleCheckModels}
              leftIcon={<MagnifyingGlass size={14} weight="bold" />}
            >
              Scan Model Capability
            </Button>

            {showModels && (
              <div className="code-block" style={{ fontSize: '0.7rem', maxHeight: '100px', overflowY: 'auto', marginBottom: '12px', padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: '4px' }}>AVAILABLE ENDPOINTS:</div>
                {availableModels.length > 0 ? (
                  availableModels.map(m => <div key={m} style={{ opacity: 0.8 }}>• {m}</div>)
                ) : (
                  <div style={{ opacity: 0.5 }}>No response from gateway.</div>
                )}
              </div>
            )}
            
            {rawResponse && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '0.7rem', marginBottom: '4px' }}>RAW TELEMETRY:</div>
                <pre style={{ fontSize: '0.65rem', maxHeight: '150px', overflow: 'auto', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', margin: 0, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>
                  {rawResponse}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {(generatedPose || generatedAnimation) && (
        <div className="tab-section" style={{ border: '1px solid var(--accent)', background: 'linear-gradient(135deg, rgba(0, 255, 214, 0.1) 0%, transparent 100%)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, right: 0, padding: '4px 12px', background: 'var(--accent)', color: 'var(--color-abyss)', fontSize: '0.6rem', fontWeight: 'bold', textTransform: 'uppercase', borderBottomLeftRadius: 'var(--radius-md)' }}>
            Preview Active
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkle size={20} weight="fill" color="var(--accent)" />
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'bold' }}>
                {generatedAnimation ? 'Dynamic Animation' : 'Static Pose'} Synthesized
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button 
                variant="secondary" 
                size="small" 
                onClick={() => {
                  if (generatedAnimation) {
                    avatarManager.applyRawPose(generatedAnimation.data, rotationLocked, generatedAnimation.loop ? 'loop' : 'once');
                  } else {
                    avatarManager.applyRawPose({ vrmPose: generatedPose! }, rotationLocked, 'static');
                  }
                }}
                leftIcon={<ArrowClockwise size={14} weight="bold" />}
              >
                Replay
              </Button>
              {generatedPose && (
                <Button variant="primary" size="small" onClick={handleSave} leftIcon={<FloppyDisk size={14} weight="fill" />}>
                  Archive
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="tab-section" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', textTransform: 'uppercase', fontSize: 'var(--text-sm)', letterSpacing: '0.1em' }}>
            Pose Archive ({customPoses.length})
          </h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <label className="btn btn--secondary btn--small" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', height: '32px' }}>
              <UploadSimple size={16} weight="bold" />
              <span>Load</span>
              <input type="file" accept=".json" onChange={handleImportLibrary} style={{ display: 'none' }} />
            </label>
            <Button 
              variant="secondary" 
              size="small" 
              onClick={handleExportLibrary} 
              disabled={customPoses.length === 0}
              leftIcon={<DownloadSimple size={16} weight="bold" />}
            >
              Export All
            </Button>
          </div>
        </div>
        
        {customPoses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', border: '2px dashed rgba(255,255,255,0.05)', borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)' }}>
            <Robot size={32} weight="duotone" style={{ opacity: 0.3, marginBottom: '12px' }} />
            <div className="small">Neural archive empty. Generate or load data.</div>
          </div>
        ) : (
          <div className="pose-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {customPoses.map((pose) => (
              <div key={pose.id} className="pose-item" style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 'bold', fontSize: 'var(--text-sm)', marginBottom: '2px' }} className="truncate">{pose.name}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }} className="truncate">{pose.description}</div>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <button className="icon-button" onClick={() => handleApplySaved(pose.poseData)} title="Recall Pose">
                    <Check size={16} weight="bold" color="var(--accent)" />
                  </button>
                  <button className="icon-button" onClick={() => handleExportPose(pose)} title="Download Telemetry">
                    <DownloadSimple size={16} weight="bold" />
                  </button>
                  <button className="icon-button" onClick={() => removeCustomPose(pose.id)} title="Purge Data">
                    <Trash size={16} weight="bold" color="var(--error)" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
