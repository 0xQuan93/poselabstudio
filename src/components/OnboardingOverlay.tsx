import { useRef, useEffect } from 'react';
import { useAvatarSource } from '../state/useAvatarSource';
import { useAvatarListStore } from '../state/useAvatarListStore';
import { useToastStore } from '../state/useToastStore';
import { useUIStore } from '../state/useUIStore';
import { Eye, FolderOpen, DiceFive } from '@phosphor-icons/react';

const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to PoseLab',
    description: 'Your creative studio for VRM avatars. Pose, animate, capture—let\'s get you started.',
    targetId: null,
    highlight: false
  },
  {
    id: 'upload',
    title: '1. Load Your Avatar',
    description: 'Upload your own VRM file or click the Dice 🎲 button for a random character. This is your digital canvas.',
    targetId: 'canvas-stage',
    highlight: true
  },
  {
    id: 'modes',
    title: '2. Choose Your Mode',
    description: '"Reactions" gives you instant presets for streaming and content. "Pose Lab" unlocks full creative control.',
    targetId: 'mode-switch',
    highlight: true,
    action: (store: any) => store.setMode('reactions')
  },
  {
    id: 'poselab',
    title: '3. Pose Lab Tools',
    description: 'In Pose Lab, access Animations, Poses, and Mocap tabs for deep customization.',
    targetId: 'mode-switch',
    highlight: true,
    action: (store: any) => store.setMode('poselab')
  },
  {
    id: 'tabs',
    title: '4. Your Toolkit',
    description: 'Anims: play imported animations. Poses: save and load poses. Mocap: use your webcam for motion capture.',
    targetId: 'poselab-tabs',
    highlight: true
  },
  {
    id: 'export',
    title: '5. Export & Save',
    description: 'Export images, videos, or 3D models. Use Ctrl+S to save your project and Ctrl+O to load it later.',
    targetId: 'poselab-tabs',
    highlight: true,
    action: (store: any) => store.setPoseLabTab('export')
  },
  {
    id: 'camera',
    title: '6. Camera & Scene Controls',
    description: (
      <span>
        Use hotkeys <span className="hotkey-hint">1</span> <span className="hotkey-hint">3</span> <span className="hotkey-hint">5</span> <span className="hotkey-hint">7</span> for quick views. 
        Press <span className="hotkey-hint">Space</span> for snapshot. 
        Click <DiceFive size={16} weight="duotone" /> to randomize avatar, or the PoseLab logo to reset the scene.
      </span>
    ),
    targetId: 'canvas-stage',
    highlight: true
  },
  {
    id: 'finish',
    title: 'You\'re Ready!',
    description: 'Explore, create, and share. Check the About (?) for more features. Have fun!',
    targetId: null,
    highlight: false
  }
];

export function OnboardingOverlay() {
  const { avatarType, setFileSource, setRemoteUrl } = useAvatarSource();
  const { fetchAvatars, getRandomAvatar, isLoading: isAvatarListLoading } = useAvatarListStore();
  const { addToast } = useToastStore();
  const { 
    isTutorialActive, 
    currentTutorialStep, 
    startTutorial, 
    endTutorial, 
    nextTutorialStep,
    prevTutorialStep,
    setMode,
    setPoseLabTab
  } = useUIStore();
  
  const vrmInputRef = useRef<HTMLInputElement>(null);
  const prevStepRef = useRef(currentTutorialStep);

  // Auto-start tutorial if no avatar is loaded
  useEffect(() => {
    // Pre-fetch avatar list on mount
    fetchAvatars();
    
    if (avatarType === 'none' && !isTutorialActive) {
      startTutorial();
    }
  }, [avatarType, isTutorialActive, startTutorial, fetchAvatars]);

  // Handle step actions
  useEffect(() => {
    if (!isTutorialActive) return;
    
    const step = TUTORIAL_STEPS[currentTutorialStep];
    const isMovingBackwards = currentTutorialStep < prevStepRef.current;
    prevStepRef.current = currentTutorialStep;

    if (step && step.action) {
      step.action({ setMode, setPoseLabTab });
    }

    // specific check for upload step completion
    // Only auto-advance if we're not moving backwards (e.g. user clicked "Back")
    if (step && step.id === 'upload' && avatarType !== 'none' && !isMovingBackwards) {
       nextTutorialStep();
    }

  }, [currentTutorialStep, isTutorialActive, avatarType, nextTutorialStep, setMode, setPoseLabTab]);

  // Clean up highlights
  useEffect(() => {
    // Remove all highlights first
    document.querySelectorAll('.tutorial-highlight').forEach(el => {
      el.classList.remove('tutorial-highlight');
    });

    if (!isTutorialActive) return;

    const step = TUTORIAL_STEPS[currentTutorialStep];
    if (step && step.highlight && step.targetId) {
      const el = document.querySelector(`[data-tutorial-id="${step.targetId}"]`);
      if (el) {
        el.classList.add('tutorial-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTutorialStep, isTutorialActive]);

  const handleVRMUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.vrm')) {
      addToast('Invalid data signature. Please provide a .vrm file.', 'error');
      return;
    }
    
    setFileSource(file);
  };

  const loadSampleAvatar = async () => {
    try {
      if (isAvatarListLoading) {
        addToast('Establishing connection to avatar matrix...', 'info');
        return;
      }
      
      const randomAvatar = getRandomAvatar();
      
      if (randomAvatar) {
        setRemoteUrl(randomAvatar.model_file_url, randomAvatar.name);
        addToast(`${randomAvatar.name} materialized.`, 'success');
      } else {
        // Fallback to local default if API fails
        const response = await fetch('/vrm/VIPE_Hero_2851-default.vrm');
        const blob = await response.blob();
        const file = new File([blob], 'default-avatar.vrm', { type: 'model/gltf-binary' });
        setFileSource(file);
        addToast('Default avatar loaded (Offline Mode).', 'success');
      }
    } catch (error) {
      console.error('Failed to load sample avatar:', error);
      addToast('Transmission failed. Please upload your own avatar.', 'error');
    }
  };

  const handleSkip = () => {
    endTutorial();
  };
  
  const handleNext = () => {
    if (currentTutorialStep < TUTORIAL_STEPS.length - 1) {
        nextTutorialStep();
    } else {
        endTutorial();
    }
  };

  const handleBack = () => {
    if (currentTutorialStep > 0) {
      prevTutorialStep();
    }
  };

  // If tutorial is not active and avatar is loaded, show nothing
  if (!isTutorialActive && avatarType !== 'none') return null;

  // Initial Load Screen
  const isInitialLoad = avatarType === 'none';
  const step = TUTORIAL_STEPS[currentTutorialStep];

  if (isInitialLoad && (!isTutorialActive || currentTutorialStep <= 1)) {
     return (
        <div className="onboarding-overlay">
          <div className="onboarding-card">
              <div className="onboarding-icon onboarding-item"><Eye size={64} weight="duotone" /></div>
              
              <h2 className="onboarding-item delay-1">Welcome to PoseLab</h2>
              <p className="onboarding-item delay-2">
                Your professional studio for 3D avatars. <br/>
                Pose, animate, and capture in seconds.
              </p>
              
              <div className="onboarding-actions onboarding-item delay-3">
                <button 
                    className="onboarding-btn primary"
                    onClick={() => vrmInputRef.current?.click()}
                >
                    <FolderOpen size={20} weight="duotone" /> Load Custom VRM
                </button>
                
                <div className="onboarding-divider onboarding-item delay-4">or</div>

                <button 
                    className="onboarding-btn secondary onboarding-item delay-4"
                    onClick={loadSampleAvatar}
                    disabled={isAvatarListLoading}
                >
                    <DiceFive size={20} weight="duotone" /> 
                    {isAvatarListLoading ? 'Summoning...' : 'Load Random Avatar'}
                </button>
              </div>

              <input
                ref={vrmInputRef}
                type="file"
                accept=".vrm"
                onChange={handleVRMUpload}
                style={{ display: 'none' }}
              />
          </div>
        </div>
     );
  }

  // Standard Tutorial Overlay
  if (!isTutorialActive) return null;

  return (
    <div className="tutorial-overlay-container">
      <div className="tutorial-card">
        <div className="tutorial-progress-container">
          {TUTORIAL_STEPS.map((_, index) => (
            <div 
              key={index} 
              className={`tutorial-progress-dot ${index <= currentTutorialStep ? 'active' : ''}`}
            />
          ))}
        </div>

        <div className="tutorial-header">
            <span className="tutorial-step-indicator">
                Phase {currentTutorialStep + 1} / {TUTORIAL_STEPS.length}
            </span>
            <button className="tutorial-skip-btn" onClick={handleSkip}>
                Exit Loop
            </button>
        </div>
        
        <h3>{step.title}</h3>
        <p>{step.description}</p>
        
        <div className="tutorial-footer">
            <div className="tutorial-nav-buttons">
              {currentTutorialStep > 0 && (
                <button 
                  className="secondary small" 
                  onClick={handleBack}
                >
                  ⇠ Back
                </button>
              )}
            </div>
            
            <button 
                className="primary" 
                onClick={handleNext}
                style={{ padding: '0.6rem 2rem' }}
            >
                {currentTutorialStep === TUTORIAL_STEPS.length - 1 ? 'Start Creating ⇢' : 'Next Step ⇢'}
            </button>
        </div>
      </div>
    </div>
  );
}
