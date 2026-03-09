import type { Action } from "kbar";
import { useToast } from "./Toast";
import { sceneManager } from "../three/sceneManager";
import { avatarManager } from "../three/avatarManager";
import { animationManager } from "../three/animationManager";
import { interactionManager } from "../three/interactionManager";
import { projectManager } from "../persistence/projectManager";
import { getPoseLabTimestamp } from "../utils/exportNaming";
import { useSceneSettingsStore } from "../state/useSceneSettingsStore";
import { useMultiplayerStore } from "../state/useMultiplayerStore";
import { multiAvatarManager } from "../three/multiAvatarManager";

// Helper to access store outside of component
const getToast = () => useToast.getState();

export const commands: Action[] = [
  {
    id: "project-save",
    name: "Project: Save (.pose)",
    shortcut: ["ctrl+s"],
    keywords: "save export project",
    section: "Session",
    perform: () => {
        projectManager.downloadProject("My Project");
        getToast().addToast("Project saved", "success");
    }
  },
  {
    id: "project-load",
    name: "Project: Load (.pose)",
    shortcut: ["ctrl+o"],
    keywords: "load open import project",
    section: "Session",
    perform: () => {
        // Create a hidden file input to trigger upload
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pose,.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const result = await projectManager.loadFromFile(file);
                if (result.success) {
                    getToast().addToast("Project loaded", "success");
                    if (result.avatarWarning) {
                        setTimeout(() => getToast().addToast(result.avatarWarning!, "warning"), 500);
                    }
                } else {
                    getToast().addToast("Failed to load project", "error");
                }
            }
        };
        input.click();
    }
  },
  { 
      id: "export-png", 
      name: "Export PNG (with Effects)", 
      shortcut: ["p"], 
      keywords: "save image screenshot effects fx",
      perform: async () => {
          // Smart Resolution: Use the user's full screen resolution for maximum quality
          // This ensures crisp exports even if the browser window is small
          const targetWidth = window.screen.width * window.devicePixelRatio;
          const targetHeight = window.screen.height * window.devicePixelRatio;
          
          getToast().addToast(`Capturing High-Res (${targetWidth}x${targetHeight})...`, 'info');

          // Use captureSnapshot to include CSS overlays (scanlines, glitch, etc.) and logo
          const dataUrl = await sceneManager.captureSnapshot({
              width: targetWidth,
              height: targetHeight,
              includeLogo: true,
              transparentBackground: false,
              fitToFrame: false // Maintain current framing logic, just upscale
          });
          
          if (!dataUrl) {
              getToast().addToast('Failed to capture screenshot', 'error');
              return;
          }
          
          const link = document.createElement('a');
          link.href = dataUrl;
          const timestamp = getPoseLabTimestamp();
          link.download = `PoseLab_${timestamp}_highres.png`;
          link.click();
          getToast().addToast('📸 High-Res PNG Saved', 'success');
      } 
  },
  { 
      id: "camera-headshot", 
      name: "Camera: Headshot", 
      shortcut: ["1"], 
      keywords: "view front headshot portrait",
      perform: () => {
          sceneManager.setCameraPreset('headshot');
          getToast().addToast('Camera: Headshot [1]', 'info');
      } 
  },
  { 
      id: "camera-quarter", 
      name: "Camera: 3/4 View", 
      shortcut: ["3"], 
      keywords: "view quarter angle",
      perform: () => {
          sceneManager.setCameraPreset('quarter');
          getToast().addToast('Camera: 3/4 View [3]', 'info');
      } 
  },
  { 
      id: "camera-side", 
      name: "Camera: Side View", 
      shortcut: ["5"], 
      keywords: "view side profile",
      perform: () => {
          sceneManager.setCameraPreset('side');
          getToast().addToast('Camera: Side View [5]', 'info');
      } 
  },
  { 
      id: "camera-home", 
      name: "Camera: Home", 
      shortcut: ["7"], 
      keywords: "view home reset default",
      perform: () => {
          sceneManager.resetCamera();
          getToast().addToast('Camera: Home [7]', 'info');
      } 
  },
  { 
      id: "gizmo-rotate", 
      name: "Gizmo: Rotate (Manual Posing)", 
      shortcut: ["2"], 
      keywords: "rotate tool manual posing gizmo",
      perform: () => {
         const mpState = useMultiplayerStore.getState();
         const isInMultiplayer = mpState.isConnected && mpState.localPeerId;
         
         if (interactionManager.enabled) {
             // Disabling manual posing
             interactionManager.toggle(false);
             
             // Capture final pose state
             avatarManager.freezeCurrentPose();
             avatarManager.setManualPosing(false);
             
             // Update multiplayer state if connected
             if (isInMultiplayer && mpState.localPeerId) {
                 multiAvatarManager.setInteraction(false);
                 multiAvatarManager.freezeCurrentPose(mpState.localPeerId);
             }
             
             getToast().addToast('Manual Posing Disabled [2]', 'success');
         } else {
             // Enabling manual posing
             // 1. Freeze the pose first so it's already static when helpers appear
             avatarManager.freezeCurrentPose();
             
             // 2. Also freeze in multiAvatarManager if in multiplayer
             if (isInMultiplayer && mpState.localPeerId) {
                 multiAvatarManager.setInteraction(true);
                 multiAvatarManager.freezeCurrentPose(mpState.localPeerId);
             }
             
             // 3. Enable interaction tools
             interactionManager.toggle(true);
             interactionManager.setGizmoMode('rotate');
             avatarManager.setManualPosing(true);
             
             // 4. Auto-lock rotation so manual adjustments persist through animation changes
             useSceneSettingsStore.getState().setRotationLocked(true);
             
             // 5. Save current Hips rotation to enforce it while locked
             avatarManager.saveLockedHipsRotation();
             
             getToast().addToast('Manual Posing Enabled (rotation locked) [2]', 'info');
         }
      } 
  },
  {
      id: "reset-pose",
      name: "Reset Pose",
      shortcut: ["r"],
      keywords: "tpose clear",
      perform: () => {
          avatarManager.resetPose();
          getToast().addToast('Pose Reset', 'info');
      }
  },
  {
      id: "stop-anim",
      name: "Stop Animation",
      shortcut: ["s"],
      keywords: "pause halt",
      perform: () => {
          animationManager.stopAnimation();
          getToast().addToast('Animation Stopped', 'info');
      }
  }
];
