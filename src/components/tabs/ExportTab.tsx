import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { sceneManager } from '../../three/sceneManager';
import { useReactionStore } from '../../state/useReactionStore';
import { avatarManager } from '../../three/avatarManager';
import { exportAsWebM, canExportVideo } from '../../export/exportVideo';
import { exportAsGLB } from '../../export/exportGLB';
import { useToastStore } from '../../state/useToastStore';
import { useUIStore } from '../../state/useUIStore';
import { projectManager } from '../../persistence/projectManager';
import { postProcessingManager } from '../../three/postProcessingManager';
import { getPoseLabTimestamp } from '../../utils/exportNaming';
import { serializeAnimationClip } from '../../poses/animationClipSerializer';
import { animationManager } from '../../three/animationManager';
import { useUserStore } from '../../state/useUserStore';
import { useSolanaWallets } from '@privy-io/react-auth';
import { 
  Image, 
  FilmStrip, 
  Cube, 
  Monitor, 
  Square, 
  DeviceMobileCamera,
  Lightbulb,
  FileJs as FileJson,
  Package,
  Aperture,
  FloppyDisk,
  FolderOpen,
  Broadcast,
  DiscordLogo
} from '@phosphor-icons/react';
import { batchConfigs, applyMixamoBuffer, savePoseToDisk } from '../../pose-lab/batchUtils';

interface ExportTabProps {
  mode?: 'reactions' | 'poselab';
}

export function ExportTab({ mode = 'reactions' }: ExportTabProps) {
  const { activePreset, animationMode, isAvatarReady } = useReactionStore();
  const { addToast } = useToastStore();
  const setStreamMode = useUIStore((state) => state.setStreamMode);
  const { user } = useUserStore();
  const { wallets } = useSolanaWallets();
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFormat, setExportFormat] = useState<'png' | 'webm' | 'glb' | 'json'>('png');
  const [resolution, setResolution] = useState<'720p' | '1080p' | 'square' | '4k'>('720p');
  const [includeLogo, setIncludeLogo] = useState(true);
  const [transparentBg, setTransparentBg] = useState(false);
  const [autoFrame, setAutoFrame] = useState(false);

  // Set aspect ratio from sceneManager on mount to ensure consistent state
  useEffect(() => {
    // This just ensures we are aware of the current aspect ratio
    // The actual export uses sceneManager.getAspectRatio() directly
    sceneManager.getAspectRatio();
  }, []);

  const handleProjectSave = () => {
    projectManager.downloadProject("My Project");
    addToast("Project saved", "success");
  };

  const handleProjectLoad = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const result = await projectManager.loadFromFile(file);
    if (result.success) {
        addToast("Project loaded", "success");
        if (result.avatarWarning) {
          setTimeout(() => addToast(result.avatarWarning!, "warning"), 500);
        }
    } else {
        addToast("Failed to load project", "error");
    }
    event.target.value = '';
  };

  const getExportDimensions = (): { width: number; height: number; bitrate: number } => {
    switch (resolution) {
      case '4k':
        return { width: 3840, height: 2160, bitrate: 25000000 }; // 25 Mbps
      case '720p':
        return { width: 1280, height: 720, bitrate: 5000000 }; // 5 Mbps
      case 'square':
        return { width: 1080, height: 1080, bitrate: 8000000 }; // 8 Mbps
      case '1080p': // Re-purposed as Vertical/Mobile
        return { width: 1080, height: 1920, bitrate: 12000000 }; // 12 Mbps
      default:
        return { width: 1920, height: 1080, bitrate: 12000000 };
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if Command/Control + S is pressed
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault(); // Prevent browser save dialog
        if (!isAvatarReady || isExporting) return;
        
        handleExport();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAvatarReady, isExporting, exportFormat, resolution, includeLogo, transparentBg]);

  const handleExportPNG = async () => {
    // Get current aspect ratio to ensure we're using the latest
    const currentAspectRatio = sceneManager.getAspectRatio();
    const dimensions = getExportDimensions();
    
    console.log('[ExportTab] Exporting PNG:', {
      dimensions,
      aspectRatio: currentAspectRatio,
      includeLogo,
      transparentBg
    });
    
    // Ensure camera aspect matches export aspect ratio
    const camera = sceneManager.getCamera();
    if (camera) {
      const exportAspect = dimensions.width / dimensions.height;
      camera.aspect = exportAspect;
      camera.updateProjectionMatrix();
    }
    
    // Use the new captureSnapshot with resolution, logo, and transparency options
    const dataUrl = await sceneManager.captureSnapshot({
      width: dimensions.width,
      height: dimensions.height,
      includeLogo: includeLogo,
      transparentBackground: transparentBg,
      fitToFrame: autoFrame,
    });
    
    if (!dataUrl) return;
    
    // Generate filename with aspect ratio (unless it's the default 16:9 or square resolution)
    // Format: PoseLab_{timestamp}_{preset-id}_{resolution}_{aspect-ratio}.png
    const poseName = activePreset.label.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const aspectSuffix = resolution === 'square' ? '' : currentAspectRatio !== '16:9' ? `_${currentAspectRatio.replace(':', 'x')}` : '';
    const transparentSuffix = transparentBg ? '_transparent' : '';
    const timestamp = getPoseLabTimestamp();
    const filename = `PoseLab_${timestamp}_${poseName}_${resolution}${aspectSuffix}${transparentSuffix}.png`;
    
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    addToast('✅ PNG Saved Successfully!', 'success');
  };

  const handleExportWebM = async () => {
    const canvas = sceneManager.getCanvas();
    if (!canvas) {
      addToast('Canvas not available', 'error');
      return;
    }

    // Check if animation is playing
    // In Pose Lab mode, check avatarManager directly
    // In Reactions mode, check animationMode from store
    const isAnimationPlaying = mode === 'poselab' 
      ? avatarManager.isAnimationPlaying()
      : animationMode !== 'static';

    if (!isAnimationPlaying) {
      if (mode === 'poselab') {
        addToast('Start an animation first (import and play an FBX/GLTF animation in the Animations tab)', 'warning');
      } else {
        addToast('Start an animation first (select Loop or Play Once)', 'warning');
      }
      return;
    }

    if (!canExportVideo()) {
      addToast('Video export not supported in this browser', 'error');
      return;
    }

    // Get current aspect ratio to ensure we're using the latest from Scene tab
    const currentAspectRatio = sceneManager.getAspectRatio();
    const dimensions = getExportDimensions();
    
    console.log('[ExportTab] Exporting WebM:', {
      dimensions,
      aspectRatio: currentAspectRatio,
      resolution
    });

    setIsExporting(true);
    setExportProgress(0);

    try {
      // Save current renderer state
      const renderer = sceneManager.getRenderer();
      if (!renderer) {
        throw new Error('Renderer not available');
      }

      const originalSize = new THREE.Vector2();
      renderer.getSize(originalSize);
      const camera = sceneManager.getCamera();
      const originalAspect = camera ? camera.aspect : undefined;

      // Temporarily resize renderer for high-res export
      // NOTE: We only resize the renderer, NOT the canvas element
      // The renderer will render to its internal buffer at target size
      // and we'll capture from that buffer via the composite canvas
      if (dimensions.width && dimensions.height) {
        // Resize renderer internal buffer (this is what actually renders)
        // The third parameter 'false' means don't update CSS, but it WILL update
        // the canvas element's width/height attributes to match the renderer size
        renderer.setSize(dimensions.width, dimensions.height, false);
        
        // Resize post-processing composer if enabled
        if (postProcessingManager.isEnabled()) {
          postProcessingManager.resize(dimensions.width, dimensions.height);
        }
        
        // Update camera aspect ratio to match target resolution
        if (camera) {
          camera.aspect = dimensions.width / dimensions.height;
          camera.updateProjectionMatrix();
        }
        
        console.log('[ExportTab] Renderer resized to:', dimensions.width, 'x', dimensions.height);
        console.log('[ExportTab] Canvas dimensions (auto-updated by renderer):', canvas.width, 'x', canvas.height);
        console.log('[ExportTab] Camera aspect:', camera?.aspect);
        
        // Force renderer to render at new size
        const scene = sceneManager.getScene();
        if (scene && camera) {
          const composer = postProcessingManager.getComposer();
          if (postProcessingManager.isEnabled() && composer) {
            composer.render();
          } else {
            renderer.render(scene, camera);
          }
        }
        
        // Wait a few frames to ensure renderer has fully rendered at new size
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      try {
        // Generate filename with aspect ratio (unless it's the default 16:9 or square resolution)
        // Format: {preset-id|pose-lab}-{resolution}-{aspect-ratio}.webm
        const aspectSuffix = resolution === 'square' ? '' : currentAspectRatio !== '16:9' ? `_${currentAspectRatio.replace(':', 'x')}` : '';
        const baseName = mode === 'poselab'
          ? `poselab_${resolution}`
          : `${activePreset.id}_${resolution}`;
        const timestamp = getPoseLabTimestamp();
        const filename = `PoseLab_${timestamp}_${baseName}${aspectSuffix}.webm`;

        // Export with target resolution
        await exportAsWebM(
          canvas, 
          3, 
          filename, 
          (progress) => {
            setExportProgress(Math.round(progress * 100));
          },
          { 
            width: dimensions.width, 
            height: dimensions.height, 
            includeLogo,
            videoBitsPerSecond: dimensions.bitrate // Use smart bitrate
          }
        );
        addToast('✅ WebM Exported Successfully!', 'success');
      } finally {
        // Always restore original renderer size and camera aspect
        // The renderer.setSize() will automatically restore canvas element dimensions
        renderer.setSize(originalSize.x, originalSize.y, false);
        
        // Restore post-processing size
        if (postProcessingManager.isEnabled()) {
          postProcessingManager.resize(originalSize.x, originalSize.y);
        }

        if (camera && originalAspect !== undefined) {
          camera.aspect = originalAspect;
          camera.updateProjectionMatrix();
        }
        console.log('[ExportTab] Renderer restored to:', originalSize.x, 'x', originalSize.y);
      }
    } catch (error) {
      console.error('Export failed:', error);
      addToast(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleExportGLB = async () => {
    try {
      setIsExporting(true);
      const poseName = activePreset.label.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const timestamp = getPoseLabTimestamp();
      const filename = `PoseLab_${timestamp}_${poseName}`;
      await exportAsGLB(filename);
      addToast('✅ GLB Exported Successfully!', 'success');
    } catch (error) {
      console.error('GLB Export failed:', error);
      addToast('GLB Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportJSON = async () => {
    try {
      setIsExporting(true);
      const timestamp = getPoseLabTimestamp();
      const isAnimated = animationManager.isPlaying();
      
      let data: any;
      let filename = `PoseLab_${timestamp}`;

      if (isAnimated) {
        // Export Animation Clip
        const action = animationManager.getCurrentAction();
        if (action) {
          const clip = action.getClip();
          data = serializeAnimationClip(clip);
          filename += `_anim_${clip.name}`;
        } else {
            throw new Error('No active animation action found');
        }
      } else {
        // Export Static Pose
        const pose = avatarManager.captureCurrentPose();
        const vrm = avatarManager.getVRM();
        
        data = {
           type: 'VRMPose',
           version: '1.0',
           timestamp,
           vrmPose: pose,
           // Capture scene transform if available
           sceneRotation: vrm ? {
             x: THREE.MathUtils.radToDeg(vrm.scene.rotation.x),
             y: THREE.MathUtils.radToDeg(vrm.scene.rotation.y),
             z: THREE.MathUtils.radToDeg(vrm.scene.rotation.z)
           } : undefined,
           scenePosition: vrm ? {
             x: vrm.scene.position.x,
             y: vrm.scene.position.y,
             z: vrm.scene.position.z
           } : undefined
        };
        filename += `_pose`;
      }
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.json`;
      link.click();
      URL.revokeObjectURL(url);
      
      addToast(`✅ ${isAnimated ? 'Animation' : 'Pose'} JSON Exported!`, 'success');
    } catch (error) {
       console.error('JSON Export failed:', error);
       addToast('JSON Export failed', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleBatchExport = async () => {
    const vrm = avatarManager.getVRM();
    if (!vrm) {
      addToast('Load an avatar first', 'warning');
      return;
    }
    
    if (!confirm('This will overwrite existing pose JSON files in src/poses. Continue?')) {
        return;
    }

    setIsBatchExporting(true);
    addToast('Starting batch export...', 'info');
    
    try {
      const DEFAULT_SCENE_ROTATION = { y: 180 };
      let successCount = 0;
      
      for (const config of batchConfigs) {
        console.log(`Exporting ${config.label}...`);
        
        try {
            const response = await fetch(config.source);
            if (!response.ok) throw new Error(`Failed to fetch ${config.source}`);
            
            const buffer = await response.arrayBuffer();
            const { pose, animationClip } = await applyMixamoBuffer(buffer, config.fileName, vrm);
            
            await savePoseToDisk(config.id, {
              sceneRotation: config.sceneRotation ?? DEFAULT_SCENE_ROTATION,
              vrmPose: pose,
              animationClip,
            });
            successCount++;
        } catch (err) {
            console.error(`Failed to export ${config.label}:`, err);
        }
      }
      addToast(`Batch export complete! (${successCount}/${batchConfigs.length})`, 'success');
    } catch (error) {
      console.error('Batch export failed', error);
      addToast('Batch export failed', 'error');
    } finally {
      setIsBatchExporting(false);
    }
  };

  const handlePublishToDiscord = async () => {
    if (!user) {
      addToast('You must be logged in to publish to Discord Studio', 'warning');
      return;
    }

    setIsPublishing(true);
    addToast('Capturing pose...', 'info');

    try {
      const dimensions = getExportDimensions();
      const camera = sceneManager.getCamera();
      let originalAspect = 1;
      
      if (camera) {
        originalAspect = camera.aspect;
        camera.aspect = dimensions.width / dimensions.height;
        camera.updateProjectionMatrix();
      }

      const dataUrl = await sceneManager.captureSnapshot({
        width: dimensions.width,
        height: dimensions.height,
        includeLogo: includeLogo,
        transparentBackground: false, // Discord embeds don't always like transparent, keep false for thumbnail
        fitToFrame: autoFrame,
      });

      if (camera) {
        camera.aspect = originalAspect;
        camera.updateProjectionMatrix();
      }

      if (!dataUrl) throw new Error("Failed to capture image");

      const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
      const address = wallet ? wallet.address : null;

      addToast('Publishing to Studio...', 'info');
      
      const response = await fetch('/.netlify/functions/publish-pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: dataUrl,
          creatorName: user.username || 'Anonymous Creator',
          creatorId: user.id,
          creatorAddress: address,
          description: `Mode: ${mode === 'poselab' ? 'Pose Lab' : 'Reactions'} | Resolution: ${resolution}`
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to publish');
      }

      addToast('✅ Successfully published to Discord Studio!', 'success');
    } catch (error: any) {
      console.error('Publish error:', error);
      addToast(error.message || 'Failed to publish to Discord', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleExport = () => {
    if (exportFormat === 'png') {
      handleExportPNG();
    } else if (exportFormat === 'webm') {
      handleExportWebM();
    } else if (exportFormat === 'glb') {
      handleExportGLB();
    } else {
      handleExportJSON();
    }
  };

  return (
    <div className="tab-content">
      <div className="tab-section">
        <h3>Format</h3>
        <div className="radio-group" style={{ flexDirection: 'column', gap: '8px' }}>
          <label className="radio-option">
            <input
              type="radio"
              name="format"
              value="png"
              checked={exportFormat === 'png'}
              onChange={(e) => setExportFormat(e.target.value as 'png' | 'webm' | 'glb')}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Image size={16} weight="duotone" />
              PNG (Static Image)
            </span>
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="format"
              value="webm"
              checked={exportFormat === 'webm'}
              onChange={(e) => setExportFormat(e.target.value as 'png' | 'webm' | 'glb')}
              disabled={!canExportVideo()}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FilmStrip size={16} weight="duotone" />
              WebM (Video Animation)
            </span>
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="format"
              value="glb"
              checked={exportFormat === 'glb'}
              onChange={(e) => setExportFormat(e.target.value as 'png' | 'webm' | 'glb')}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cube size={16} weight="duotone" />
              GLB (3D Model + Animation)
            </span>
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="format"
              value="json"
              checked={exportFormat === 'json'}
              onChange={(e) => setExportFormat(e.target.value as any)}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileJson size={16} weight="duotone" />
              JSON (Pose/Animation Data)
            </span>
          </label>
        </div>
      </div>

      <div className="tab-section">
        <h3>Smart Presets</h3>
        {exportFormat === 'glb' ? (
          <p className="muted small">Exports the current avatar mesh with the currently playing animation clip baked in.</p>
        ) : exportFormat === 'json' ? (
             <p className="muted small">Exports raw data: <b>VRMPose</b> (if static) or <b>AnimationClip</b> (if playing). Perfect for sharing!</p>
        ) : (
          <>
            <p className="muted small">Quickly set resolution for common platforms</p>
            <div className="actions" style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                className={resolution === '720p' ? 'secondary active' : 'secondary'}
                onClick={() => setResolution('720p')}
                title="1280x720 (YouTube Thumbnail)"
                style={{ flex: '1 1 100px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <Monitor size={16} weight="duotone" />
                HD
              </button>
              <button
                className={resolution === 'square' ? 'secondary active' : 'secondary'}
                onClick={() => setResolution('square')}
                title="1080x1080 (Instagram/Twitter)"
                style={{ flex: '1 1 100px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <Square size={16} weight="duotone" />
                1:1
              </button>
              <button
                className={resolution === '1080p' ? 'secondary active' : 'secondary'}
                onClick={() => setResolution('1080p')}
                title="1080x1920 (TikTok/Shorts/Reels)"
                style={{ flex: '1 1 100px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <DeviceMobileCamera size={16} weight="duotone" />
                9:16
              </button>
              <button
                className={resolution === '4k' ? 'secondary active' : 'secondary'}
                onClick={() => setResolution('4k')}
                title="3840x2160 (Ultra HD)"
                style={{ flex: '1 1 100px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <Aperture size={16} weight="duotone" />
                4K
              </button>
            </div>
          </>
        )}
      </div>

      <div className="tab-section">
        <h3>Options</h3>
        {exportFormat === 'glb' ? (
           <p className="muted small">GLB export includes standard materials and skeletal animation.</p>
        ) : exportFormat === 'json' ? (
           <p className="muted small">JSON files are lightweight text files containing bone rotations and positions.</p>
        ) : (
          <>
            <label className="checkbox-option">
              <input 
                type="checkbox" 
                checked={includeLogo}
                onChange={(e) => setIncludeLogo(e.target.checked)}
              />
              <span>Include logo overlay</span>
            </label>
            {exportFormat === 'png' && (
              <>
                <label className="checkbox-option">
                  <input 
                    type="checkbox"
                    checked={transparentBg}
                    onChange={(e) => setTransparentBg(e.target.checked)}
                  />
                  <span>Transparent background</span>
                </label>
                <label className="checkbox-option">
                  <input 
                    type="checkbox"
                    checked={autoFrame}
                    onChange={(e) => setAutoFrame(e.target.checked)}
                  />
                  <span>Auto-frame Full Body (Training)</span>
                </label>
              </>
            )}
          </>
        )}
      </div>

      <div className="tab-section">
        {exportFormat === 'png' && (
          <button
            className="secondary full-width large"
            onClick={handlePublishToDiscord}
            disabled={!isAvatarReady || isPublishing || isExporting}
            style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', borderColor: '#5865F2', color: '#5865F2' }}
          >
            {isPublishing ? 'Publishing...' : (
              <>
                <DiscordLogo size={20} weight="fill" />
                Publish to Studio Feed
              </>
            )}
          </button>
        )}

        <button
          className="primary full-width large"
          onClick={handleExport}
          disabled={!isAvatarReady || isExporting}
        >
          {isExporting && exportProgress > 0
            ? `Exporting... ${exportProgress}%`
            : `Export ${exportFormat.toUpperCase()}`}
        </button>
        
        {isExporting && (
          <div className="progress-bar">
            <div className="progress-bar__fill" style={{ width: `${exportProgress}%` }} />
          </div>
        )}
        
        {exportFormat === 'png' && (
          <p className="muted small" style={{ marginTop: '0.75rem', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <Lightbulb size={14} weight="duotone" /> Quick Export: Press <kbd style={{ 
              background: 'rgba(255,255,255,0.1)', 
              padding: '2px 6px', 
              borderRadius: '4px',
              fontFamily: 'monospace'
            }}>P</kbd> to instantly save PNG with current Effects & FX
          </p>
        )}
      </div>

      <div className="tab-section" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
        <h3>Project & System</h3>
        <div className="actions" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <button 
            className="secondary" 
            onClick={handleProjectSave}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            <FloppyDisk size={16} weight="duotone" />
            Save Project
          </button>
          <button 
            className="secondary" 
            onClick={() => projectInputRef.current?.click()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            <FolderOpen size={16} weight="duotone" />
            Load Project
          </button>
          <input
            ref={projectInputRef}
            type="file"
            accept=".pose,.json"
            onChange={handleProjectLoad}
            style={{ display: 'none' }}
          />
        </div>
        <button 
          className="secondary full-width"
          onClick={() => {
            setStreamMode(true);
            addToast("Stream Mode Active (Press Esc to exit)", "info");
          }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <Broadcast size={16} weight="duotone" style={{ color: 'var(--accent)' }} />
          Enter Stream Mode
        </button>
      </div>

      {mode === 'poselab' && (
        <div className="tab-section" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
            <h3>Batch Processing</h3>
            <p className="muted small">Regenerate all pose JSONs from source FBX files.</p>
            <button 
                className="secondary full-width"
                onClick={handleBatchExport}
                disabled={isBatchExporting || !isAvatarReady}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
                {isBatchExporting ? (
                    'Processing...' 
                ) : (
                    <>
                        <Package size={16} weight="duotone" /> 
                        Batch Export All Poses
                    </>
                )}
            </button>
        </div>
      )}
    </div>
  );
}
