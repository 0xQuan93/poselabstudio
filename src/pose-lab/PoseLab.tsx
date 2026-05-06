import { useEffect, useRef, useState } from 'react';
import './pose-lab.css';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { BatchFBXConverter } from './BatchFBXConverter';
import { useAvatarSource } from '../state/useAvatarSource';
import { 
  batchConfigs, 
  applyMixamoBuffer, 
  savePoseToDisk 
} from './batchUtils';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 1.4, 2.3);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(640, 640);

const hemi = new THREE.HemisphereLight(0xffffff, 0x080820, 1.2);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1);
dir.position.set(0, 4, 2);
scene.add(dir);

// OrbitControls (initialized in useEffect)
let controls: OrbitControls | null = null;

// Animation mixer for playback
let mixer: THREE.AnimationMixer | null = null;
let currentAction: THREE.AnimationAction | null = null;

function PoseLab() {
  const { currentUrl, avatarType } = useAvatarSource();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const animationClipRef = useRef<THREE.AnimationClip | null>(null);
  const [currentVrm, setCurrentVrm] = useState<VRM | null>(null);
  const [status, setStatus] = useState('🎭 Drag & drop a VRM file to begin');
  const [isVRMLoaded, setIsVRMLoaded] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [isDraggingVRM, setIsDraggingVRM] = useState(false);
  const [isDraggingFBX, setIsDraggingFBX] = useState(false);
  const [currentAnimationClip, setCurrentAnimationClip] = useState<THREE.AnimationClip | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const clockRef = useRef(new THREE.Clock());
  const isPlayingRef = useRef(false); // Ref for render loop access

  const loadVRM = async (source: File | string) => {
    setStatus('Loading VRM…');
    
    // Dispose of old VRM if exists
    if (vrmRef.current) {
      console.log('[PoseLab] Disposing old VRM');
      scene.remove(vrmRef.current.scene);
      vrmRef.current.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((mat) => mat.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
      vrmRef.current = null;
      setCurrentVrm(null);
      setIsVRMLoaded(false);
    }
    
    let arrayBuffer: ArrayBuffer;
    if (typeof source === 'string') {
      const res = await fetch(source);
      arrayBuffer = await res.arrayBuffer();
    } else {
      arrayBuffer = await source.arrayBuffer();
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(arrayBuffer, '');
    const vrm = gltf.userData.vrm as VRM;
    vrmRef.current = vrm;
    setCurrentVrm(vrm);
    setIsVRMLoaded(true);
    
    // Rotate VRM to face camera (VRM models load facing backwards by default)
    vrm.scene.rotation.set(0, THREE.MathUtils.degToRad(180), 0);
    
    scene.add(vrm.scene);
    setStatus('✅ VRM loaded! Now drop an FBX/GLTF animation.');
    renderer.render(scene, camera);
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    canvasRef.current.innerHTML = '';
    canvasRef.current.appendChild(renderer.domElement);
    
    // Initialize OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.4, 0);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 1.2;
    controls.maxDistance = 3;
    
    // Start render loop
    const animate = () => {
      const delta = clockRef.current.getDelta();
      controls?.update();
      
      // Update VRM
      if (vrmRef.current) {
        vrmRef.current.update(delta);
      }
      
      // Update animation mixer
      if (mixer && isPlayingRef.current) {
        mixer.update(delta);
      }
      
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();
    
    return () => {
      controls?.dispose();
    };
  }, []);

  // Auto-load avatar from main app
  useEffect(() => {
    if (avatarType === 'vrm' && currentUrl && !isVRMLoaded) {
      void loadVRM(currentUrl);
    }
  }, [avatarType, currentUrl, isVRMLoaded]);



  const retarget = async (file: File) => {
    if (!isVRMLoaded) {
      setStatus('Load a VRM first.');
      return;
    }

    setStatus('Loading Mixamo pose…');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { animationClip } = await applyMixamoBuffer(arrayBuffer, file.name, vrmRef.current!);
      animationClipRef.current = animationClip;
      setCurrentAnimationClip(animationClip);
      
      // Initialize mixer and start playing
      initializeAnimation(animationClip);
      
      setStatus('✅ Animation loaded! Use controls to preview.');
    } catch (error) {
      console.error('Retarget error:', error);
      setStatus(`Retarget failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const initializeAnimation = (clip: THREE.AnimationClip) => {
    const vrm = vrmRef.current;
    if (!vrm) {
      console.error('[PoseLab] Cannot initialize animation: VRM not loaded');
      return;
    }

    console.log('[PoseLab] Initializing animation:', clip.name, 'duration:', clip.duration);

    // Create or reset mixer
    if (mixer) {
      mixer.stopAllAction();
    }
    mixer = new THREE.AnimationMixer(vrm.scene);
    
    // Create action
    currentAction = mixer.clipAction(clip);
    currentAction.loop = isLooping ? THREE.LoopRepeat : THREE.LoopOnce;
    currentAction.clampWhenFinished = true;
    currentAction.play();
    
    console.log('[PoseLab] Animation started, isPlaying:', true);
    
    isPlayingRef.current = true;
    setIsPlaying(true);
  };

  const handlePlayPause = () => {
    if (!currentAction) return;
    
    if (isPlaying) {
      currentAction.paused = true;
      isPlayingRef.current = false;
      setIsPlaying(false);
      setStatus('⏸️ Animation paused');
    } else {
      currentAction.paused = false;
      isPlayingRef.current = true;
      setIsPlaying(true);
      setStatus('▶️ Animation playing');
    }
  };

  const handleStop = () => {
    if (!currentAction) return;
    
    currentAction.stop();
    currentAction.reset();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setStatus('⏹️ Animation stopped');
  };

  const handleRestart = () => {
    if (!currentAction) return;
    
    currentAction.stop();
    currentAction.reset();
    currentAction.play();
    isPlayingRef.current = true;
    setIsPlaying(true);
    setStatus('🔄 Animation restarted');
  };

  const handleToggleLoop = () => {
    const newLooping = !isLooping;
    setIsLooping(newLooping);
    
    if (currentAction) {
      currentAction.loop = newLooping ? THREE.LoopRepeat : THREE.LoopOnce;
    }
    
    setStatus(newLooping ? '🔁 Loop enabled' : '1️⃣ Play once');
  };

  const exportPose = async () => {
    const vrm = vrmRef.current;
    if (!vrm) {
      setStatus('Load a VRM before exporting.');
      return;
    }
    vrm.update(0);
    const pose = vrm.humanoid?.getNormalizedPose?.();
    if (!pose) {
      setStatus('Failed to extract pose.');
      return;
    }
    const payload = {
      sceneRotation: { y: 180 },
      vrmPose: pose,
    };
    
    // Export pose JSON
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pose.json';
    anchor.click();
    URL.revokeObjectURL(url);

    // Export animation clip if available
    if (animationClipRef.current) {
      const { serializeAnimationClip } = await import('../poses/animationClipSerializer');
      const serialized = serializeAnimationClip(animationClipRef.current);
      const animBlob = new Blob([JSON.stringify(serialized, null, 2)], { type: 'application/json' });
      const animUrl = URL.createObjectURL(animBlob);
      const animAnchor = document.createElement('a');
      animAnchor.href = animUrl;
      animAnchor.download = 'pose-animation.json';
      animAnchor.click();
      URL.revokeObjectURL(animUrl);
      setStatus('✅ Exported 2 files! Rename: pose.json → {id}.json, pose-animation.json → {id}-animation.json');
    } else {
      setStatus('Exported pose.json (no animation). Rename to {id}.json');
    }
  };

  const batchExport = async () => {
    if (!isVRMLoaded) {
      setStatus('Load a VRM before running batch export.');
      return;
    }
    setIsBatchExporting(true);
    try {
      const DEFAULT_SCENE_ROTATION = { y: 180 };
      for (const config of batchConfigs) {
        setStatus(`Exporting ${config.label}…`);
        const response = await fetch(config.source);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${config.label} (${response.status})`);
        }
        const buffer = await response.arrayBuffer();
        const { pose, animationClip } = await applyMixamoBuffer(buffer, config.fileName, vrmRef.current!);
        await savePoseToDisk(config.id, {
          sceneRotation: config.sceneRotation ?? DEFAULT_SCENE_ROTATION,
          vrmPose: pose,
          animationClip, // Include animation clip
        });
      }
      setStatus('Batch export complete! Updated files in src/poses.');
    } catch (error) {
      console.error('Batch export failed', error);
      setStatus(`Batch export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsBatchExporting(false);
    }
  };

  const handleVRMDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingVRM(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.vrm')) {
      await loadVRM(file);
    } else {
      setStatus('❌ Please drop a VRM file here.');
    }
  };

  const handleFBXDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFBX(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (/\.(fbx|gltf|glb)$/i.test(file.name)) {
      await retarget(file);
    } else {
      setStatus('Please drop an FBX, GLTF, or GLB file here.');
    }
  };

  return (
    <div className="pose-lab">
      <header className="pose-lab__header">
        <h1>🎭 Pose Lab</h1>
        <p className="muted">Retarget Mixamo animations to VRM format</p>
      </header>

      <div className="pose-lab__workflow">
        {/* Step 1: VRM Drop Zone */}
        <div className="pose-lab__step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h3>Load VRM Avatar</h3>
            <div
              className={`drop-zone ${isDraggingVRM ? 'drop-zone--active' : ''} ${isVRMLoaded ? 'drop-zone--loaded' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingVRM(true);
              }}
              onDragLeave={() => setIsDraggingVRM(false)}
              onDrop={handleVRMDrop}
              onClick={() => document.getElementById('vrm-upload')?.click()}
            >
              <div className="drop-zone__icon">📦</div>
              <div className="drop-zone__text">
                {isVRMLoaded ? (
                  <>
                    <strong>✅ VRM Loaded</strong>
                    <span>Drop another to replace</span>
                  </>
                ) : (
                  <>
                    <strong>Drag & Drop VRM File Here</strong>
                    <span>or click to browse</span>
                  </>
                )}
              </div>
              <input
                type="file"
                id="vrm-upload"
                accept=".vrm"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && loadVRM(e.target.files[0])}
              />
            </div>
          </div>
        </div>

        {/* Step 2: FBX Drop Zone */}
        <div className="pose-lab__step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h3>Load Mixamo Animation</h3>
            <div
              className={`drop-zone ${isDraggingFBX ? 'drop-zone--active' : ''} ${currentAnimationClip ? 'drop-zone--loaded' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFBX(true);
              }}
              onDragLeave={() => setIsDraggingFBX(false)}
              onDrop={handleFBXDrop}
              onClick={() => document.getElementById('fbx-upload')?.click()}
            >
              <div className="drop-zone__icon">🎬</div>
              <div className="drop-zone__text">
                {currentAnimationClip ? (
                  <>
                    <strong>✅ Animation Loaded</strong>
                    <span>Drop another to replace</span>
                  </>
                ) : (
                  <>
                    <strong>Drag & Drop FBX/GLTF File Here</strong>
                    <span>or click to browse</span>
                  </>
                )}
              </div>
              <input
                type="file"
                id="fbx-upload"
                accept=".fbx,.gltf,.glb"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && retarget(e.target.files[0])}
              />
            </div>
          </div>
        </div>

        {/* Step 3: Preview Canvas */}
        <div className="pose-lab__step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h3>Preview & Export</h3>
            <div ref={canvasRef} className="pose-lab__canvas" />
          </div>
        </div>
      </div>

      {/* Status Message */}
      <div className="status-card">
        <p className="status-message">{status}</p>
      </div>

      {/* Animation Controls */}
      {currentAnimationClip && (
        <div className="pose-lab__animation-controls">
          <h3>🎬 Animation Preview</h3>
          <div className="pose-lab__actions">
            <button type="button" onClick={handlePlayPause}>
              {isPlaying ? '⏸️ Pause' : '▶️ Play'}
            </button>
            <button type="button" onClick={handleStop}>
              ⏹️ Stop
            </button>
            <button type="button" onClick={handleRestart}>
              🔄 Restart
            </button>
            <button 
              type="button" 
              onClick={handleToggleLoop}
              className={isLooping ? 'active' : ''}
            >
              {isLooping ? '🔁 Loop' : '1️⃣ Once'}
            </button>
          </div>
        </div>
      )}

      {/* Export Actions */}
      <div className="pose-lab__actions">
        <button type="button" onClick={exportPose} disabled={!isVRMLoaded}>
          💾 Export Pose JSON
        </button>
        <button type="button" onClick={batchExport} disabled={!isVRMLoaded || isBatchExporting}>
          {isBatchExporting ? 'Processing...' : '📦 Batch Export All Poses'}
        </button>
      </div>

      {/* Batch FBX Converter */}
      {isVRMLoaded && currentVrm ? <BatchFBXConverter vrm={currentVrm} /> : null}
    </div>
  );
}

export default PoseLab;
