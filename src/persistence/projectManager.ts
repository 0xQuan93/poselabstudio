import * as THREE from 'three';
import { useReactionStore } from '../state/useReactionStore';
import { useTimelineStore } from '../state/useTimelineStore';
import { useAvatarSource } from '../state/useAvatarSource';
import { useAvatarListStore } from '../state/useAvatarListStore';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';
import { useUIStore } from '../state/useUIStore';
import { useDirectorStore } from '../state/useDirectorStore';
import type { ReactionTab, PoseLabTab } from '../state/useUIStore';
import { sceneManager } from '../three/sceneManager';
import { avatarManager } from '../three/avatarManager';
import { environmentManager } from '../three/environmentManager';
import { environment3DManager } from '../three/environment3DManager';
import { PROJECT_VERSION, type ProjectState } from '../types/project';

export class ProjectManager {
  /**
   * Serialize the current application state into a Project object
   */
  serializeProject(name: string = 'Untitled Project', includeAssets: boolean = true): ProjectState {
    const reactionState = useReactionStore.getState();
    const timelineState = useTimelineStore.getState();
    const avatarSource = useAvatarSource.getState();
    const sceneSettings = useSceneSettingsStore.getState();
    const uiState = useUIStore.getState();
    const directorState = useDirectorStore.getState();
    
    const camera = sceneManager.getCamera();
    const controls = sceneManager.getControls();
    
    // Get background ID from scene settings or fallback to active preset
    const backgroundId = sceneSettings.currentBackground || reactionState.activePreset.background || 'midnight';

    // Get avatar URL - check if it's a remote URL (not a blob)
    const currentUrl = avatarManager.getCurrentUrl();
    const isRemoteUrl = currentUrl && !currentUrl.startsWith('blob:');
    
    // Get custom environment data
    const customEnv = environmentManager.getCustomData();
    
    // Get 3D environments
    const environments3d = environment3DManager.getSerializeableData().map(env => ({
      ...env,
      data: includeAssets ? env.data : undefined
    }));
    
    // Get overlay info
    const overlay = sceneManager.getOverlayInfo();

    // Get current avatar pose and transform
    const currentPose = avatarManager.captureCurrentPose();
    const currentExpressions = avatarManager.getExpressionWeights();
    const vrm = avatarManager.getVRM();
    const avatarTransform = vrm ? {
        position: { x: vrm.scene.position.x, y: vrm.scene.position.y, z: vrm.scene.position.z },
        rotation: { x: THREE.MathUtils.radToDeg(vrm.scene.rotation.x), y: THREE.MathUtils.radToDeg(vrm.scene.rotation.y), z: THREE.MathUtils.radToDeg(vrm.scene.rotation.z) }
    } : undefined;

    // Handle Live2D assets if active
    let live2dData = undefined;
    if (avatarSource.avatarType === 'live2d' && avatarSource.live2dSource && includeAssets) {
      live2dData = {
        manifestPath: avatarSource.live2dSource.manifestPath,
        assets: avatarSource.live2dSource.assets.map(asset => ({
          name: asset.name,
          mimeType: asset.mimeType,
          data: window.btoa(
            new Uint8Array(asset.buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          )
        }))
      };
    }

    return {
      version: PROJECT_VERSION,
      date: Date.now(),
      metadata: {
        name,
      },
      ui: {
        activeCssOverlay: uiState.activeCssOverlay,
        focusModeActive: uiState.focusModeActive,
        activeTab: uiState.mode === 'reactions' ? uiState.reactionTab : uiState.poseLabTab
      },
      director: {
        currentScript: directorState.currentScript,
      },
      scene: {
        backgroundId,
        customBackgroundData: includeAssets ? sceneSettings.customBackgroundData : undefined,
        customBackgroundType: sceneSettings.customBackgroundType,
        overlay: overlay.url ? { url: overlay.url, opacity: overlay.opacity } : undefined,
        customEnvironmentData: includeAssets ? customEnv.data : undefined,
        customEnvironmentType: customEnv.type,
        environments3d,
        camera: {
          position: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : { x: 0, y: 1.4, z: 1.6 },
          target: controls ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : { x: 0, y: 1.4, z: 0 },
          fov: camera?.fov,
          near: camera?.near,
          far: camera?.far
        },
        lighting: sceneSettings.lighting,
        postProcessing: sceneSettings.postProcessing,
        environmentSettings: sceneSettings.environment,
        material: sceneSettings.material,
      },
      timeline: {
        sequence: timelineState.sequence,
        duration: timelineState.sequence.duration,
      },
      reaction: {
        animationMode: reactionState.animationMode,
        activePresetId: reactionState.activePreset.id,
      },
      avatar: {
        type: avatarSource.avatarType,
        name: avatarSource.sourceLabel || 'Current Avatar',
        url: isRemoteUrl ? currentUrl : undefined,
        pose: currentPose,
        expressions: currentExpressions,
        transform: avatarTransform,
        live2d: live2dData
      }
    };
  }

  /**
   * Restore a project from a ProjectState object
   * @returns Object with load status and any warnings
   */
  async loadProject(project: ProjectState): Promise<{ success: boolean; avatarWarning?: string }> {
    console.log('[ProjectManager] Loading project:', project.metadata.name);
    

    if (project.version > PROJECT_VERSION) {
      console.warn('[ProjectManager] Project version is newer than supported. Some features may break.');
    }

    // 0. Restore UI & Director State
    if (project.ui) {
      const uiStore = useUIStore.getState();
      if (project.ui.activeCssOverlay !== undefined) {
        uiStore.setActiveCssOverlay(project.ui.activeCssOverlay);
      }
      if (project.ui.focusModeActive !== undefined) {
        uiStore.setFocusModeActive(project.ui.focusModeActive);
      }
      if (project.ui.activeTab) {
        if (uiStore.mode === 'reactions') {
          uiStore.setReactionTab(project.ui.activeTab as ReactionTab);
        } else {
          uiStore.setPoseLabTab(project.ui.activeTab as PoseLabTab);
        }
      }
    }

    if (project.director) {
      const directorStore = useDirectorStore.getState();
      directorStore.setScript(project.director.currentScript || null);
    }

    // 1. Restore Scene
    // Set Background
    try {
      const sceneSettings = useSceneSettingsStore.getState();
      
      // Restore Custom HDRI if present
      if (project.scene.customEnvironmentData && project.scene.customEnvironmentType) {
        console.log('[ProjectManager] Restoring custom HDRI');
        environmentManager.setCustomData(
          project.scene.customEnvironmentData,
          project.scene.customEnvironmentType
        );
        
        const binaryString = window.atob(project.scene.customEnvironmentData);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
             bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: project.scene.customEnvironmentType });
        const url = URL.createObjectURL(blob);
        await environmentManager.loadHDRI(url);
      }

      // Restore 3D Environments
      if (project.scene.environments3d && project.scene.environments3d.length > 0) {
        console.log('[ProjectManager] Restoring 3D environments:', project.scene.environments3d.length);
        environment3DManager.removeAll(); // Clear existing
        
        for (const envData of project.scene.environments3d) {
          try {
            await environment3DManager.loadFromData(envData.data, envData.name, envData.settings, envData.url);
          } catch (e) {
            console.error('[ProjectManager] Failed to restore 3D environment:', envData.name, e);
          }
        }
      }

      // Restore Background
      if (project.scene.backgroundId === 'custom' && project.scene.customBackgroundData && project.scene.customBackgroundType) {
        console.log('[ProjectManager] Restoring custom 2D background');
        // Restore custom background
        sceneSettings.setCustomBackground(
          project.scene.customBackgroundData,
          project.scene.customBackgroundType
        );
        // Note: setCustomBackground already sets currentBackground to 'custom' and updates store
        const dataUrl = `data:${project.scene.customBackgroundType};base64,${project.scene.customBackgroundData}`;
        await sceneManager.setBackground(dataUrl, true);
      } else if (project.scene.backgroundId) {
        console.log('[ProjectManager] Restoring background:', project.scene.backgroundId);
        // Restore standard background
        await sceneManager.setBackground(project.scene.backgroundId, true);
        sceneSettings.setCurrentBackground(project.scene.backgroundId);
      }
    } catch (e) {
      console.warn('[ProjectManager] Failed to set background:', e);
    }
    
    // Restore Lighting
    if (project.scene.lighting) {
        const sceneSettings = useSceneSettingsStore.getState();
        sceneSettings.setLighting(project.scene.lighting);
    }

    // Restore Post-Processing
    if (project.scene.postProcessing) {
        const sceneSettings = useSceneSettingsStore.getState();
        sceneSettings.setPostProcessing(project.scene.postProcessing);
    }

    // Restore Environment Settings
    if (project.scene.environmentSettings) {
        const sceneSettings = useSceneSettingsStore.getState();
        sceneSettings.setEnvironment(project.scene.environmentSettings);
    }

    // Restore Material Settings
    if (project.scene.material) {
        const sceneSettings = useSceneSettingsStore.getState();
        sceneSettings.setMaterial(project.scene.material);
    }
    
    // Restore overlay
    if (project.scene.overlay) {
      sceneManager.setOverlay(project.scene.overlay.url || null, project.scene.overlay.opacity);
    }
    // Set Camera
    const camera = sceneManager.getCamera();
    const controls = sceneManager.getControls();
    if (camera && controls) {
      if (project.scene.camera?.position) {
        camera.position.set(
          project.scene.camera.position.x,
          project.scene.camera.position.y,
          project.scene.camera.position.z
        );
      }
      if (project.scene.camera?.target) {
        controls.target.set(
          project.scene.camera.target.x,
          project.scene.camera.target.y,
          project.scene.camera.target.z
        );
      }
      if (project.scene.camera?.fov !== undefined) {
        camera.fov = project.scene.camera.fov;
      }
      if (project.scene.camera?.near !== undefined) {
        camera.near = project.scene.camera.near;
      }
      if (project.scene.camera?.far !== undefined) {
        camera.far = project.scene.camera.far;
      }
      camera.updateProjectionMatrix();
      controls.update();
    }

    // 2. Restore Timeline
    const timelineStore = useTimelineStore.getState();
    timelineStore.clearTimeline();
    // Set the full sequence state
    useTimelineStore.setState({
      sequence: project.timeline.sequence,
    });
    timelineStore.setDuration(project.timeline.duration);

    // 3. Restore Reaction State
    const reactionStore = useReactionStore.getState();
    reactionStore.setAnimationMode(project.reaction.animationMode);
    reactionStore.setPresetById(project.reaction.activePresetId);

    // 4. Avatar - Try to load if we have a valid URL
    let avatarWarning: string | undefined;
    if (project.avatar?.url) {
      try {
        const avatarSource = useAvatarSource.getState();
        avatarSource.setRemoteUrl(project.avatar.url, project.avatar.name || 'Project Avatar');
        console.log('[ProjectManager] Attempting to load avatar from:', project.avatar.url);
        
        // Note: Avatar load is async. We might want to wait for it if we want to apply the pose immediately.
        // However, useAvatarSource triggers a load in AvatarManager.
        // We can hook into the completion or just try to apply it later.
        // For now, we rely on the user or the store logic.
        // BUT, since we have pose data, we should probably try to apply it after load.
      } catch (e) {
        console.warn('[ProjectManager] Failed to load avatar:', e);
        avatarWarning = 'Could not load avatar. Please reload it manually.';
      }
    } else if (project.avatar?.name) {
      // Fallback: Check if this is a known library avatar
      console.log('[ProjectManager] Avatar URL missing, checking library for:', project.avatar.name);
      
      try {
          const avatarListStore = useAvatarListStore.getState();
          // Ensure avatars are loaded
          if (avatarListStore.avatars.length === 0) {
              console.log('[ProjectManager] Avatar library empty, fetching...');
              await avatarListStore.fetchAvatars();
          }
          
          // Look for match
          const match = useAvatarListStore.getState().avatars.find(a => a.name === project.avatar.name);
          
          if (match) {
              console.log('[ProjectManager] Found library match for avatar:', match.name);
              const avatarSource = useAvatarSource.getState();
              avatarSource.setRemoteUrl(match.model_file_url, match.name);
          } else {
              // Avatar was local file, can't restore
              avatarWarning = `Avatar "${project.avatar.name}" was a local file and needs to be reloaded.`;
              console.log('[ProjectManager] Avatar was local file, cannot auto-restore:', project.avatar.name);
          }
      } catch (e) {
           console.warn('[ProjectManager] Error searching avatar library:', e);
           avatarWarning = `Avatar "${project.avatar.name}" could not be restored.`;
      }
    }

    // Restore Live2D avatar if present
    if (project.avatar?.type === 'live2d' && project.avatar.live2d) {
      console.log('[ProjectManager] Restoring Live2D avatar');
      const avatarSource = useAvatarSource.getState();
      const live2dAssets = project.avatar.live2d.assets.map(asset => {
        const binaryString = window.atob(asset.data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new File([bytes], asset.name, { type: asset.mimeType });
      });
      avatarSource.setLive2dSource(live2dAssets, project.avatar.live2d.manifestPath);
    }

    // We register it as pending in AvatarManager so it applies as soon as the load finishes
    // We intentionally do not restore the Y position, so the avatar snaps to the ground of the loaded environment
    const transformWithoutY = project.avatar.transform ? {
      ...project.avatar.transform,
      position: {
        x: project.avatar.transform.position.x,
        y: project.avatar.transform.position.y, // We let the grounding logic handle the Y position
        z: project.avatar.transform.position.z,
      }
    } : undefined;

    avatarManager.setPendingProjectState(
        project.avatar.pose,
        project.avatar.expressions,
        transformWithoutY
    );

    console.log('[ProjectManager] Project loaded successfully:', project.metadata.name);
    return { success: true, avatarWarning };
  }

  /**
   * Export project to JSON file
   */
  downloadProject(name: string) {
    const project = this.serializeProject(name);
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/\s+/g, '_').toLowerCase()}.pose`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Parse a file input and load the project
   * @returns Object with success status and optional avatar warning
   */
  async loadFromFile(file: File): Promise<{ success: boolean; avatarWarning?: string }> {
    try {
      const text = await file.text();
      const project = JSON.parse(text) as ProjectState;
      const result = await this.loadProject(project);
      return result;
    } catch (e) {
      console.error('[ProjectManager] Failed to load project file:', e);
      return { success: false };
    }
  }
}

export const projectManager = new ProjectManager();

