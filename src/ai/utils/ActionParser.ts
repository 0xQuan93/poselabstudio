import * as THREE from 'three';
import { avatarManager } from "../../three/avatarManager";
import { sceneManager } from "../../three/sceneManager";
import { useAvatarSource } from "../../state/useAvatarSource";
import { useAIStore } from "../../state/useAIStore";
import { useSceneSettingsStore } from "../../state/useSceneSettingsStore";
import { useAvatarListStore } from "../../state/useAvatarListStore";
import { useUIStore } from "../../state/useUIStore";
import { useReactionStore } from "../../state/useReactionStore";
import { useDirectorStore } from "../../state/useDirectorStore";
import { useTimelineStore } from "../../state/useTimelineStore";
import { useSettingsStore } from "../../state/useSettingsStore";
import { useMusicStore } from "../../state/useMusicStore";
import { lightingManager } from "../../three/lightingManager";
import { postProcessingManager } from "../../three/postProcessingManager";
import { environmentManager } from "../../three/environmentManager";
import { directorManager } from "../../three/DirectorManager";
import { agentManager } from "../AgentManager";
import { exportAsWebM, exportOfflineWebM } from "../../export/exportVideo";
import { getMocapManager } from "../../utils/mocapInstance";
import { geminiService } from "../../services/gemini";
import { avatarController, type GestureType, type EmotionState } from "../AvatarController";
import type { PoseId } from "../../types/reactions";
import { GESTURE_LIBRARY } from "../../data/gestures";

// Valid pose IDs that exist in the pose library
import { poseLibrary } from "../../poses";
const VALID_POSE_IDS: PoseId[] = Object.keys(poseLibrary) as PoseId[];

// Map AI commands to actual pose IDs
const POSE_COMMAND_MAP: Record<string, PoseId> = {
  'wave': 'emote-wave',
  'dance': 'agent-dance',
  'point': 'emote-point',
  'victory': 'emote-cheer',
  'celebrate': 'emote-cheer',
  'think': 'cipher-whisper',
  'ponder': 'cipher-whisper',
  'angry': 'idle-offensive',
  'taunt': 'emote-taunt',
  'clap': 'emote-clap',
  'silly': 'emote-dance-silly',
  'walk': 'locomotion-walk',
  'run': 'locomotion-run',
  'jog': 'locomotion-jog',
  'sit': 'sit-chair',
  'sad_sit': 'sit-sad',
  'bow': 'emote-bow',
  'thumbsup': 'emote-thumbsup',
  'swim': 'action-swim',
  'focus': 'action-focus',
  // New poses from the library
  'crouch_walk': 'locomotion-crouch-walk',
  'turn_left': 'locomotion-turn-left',
  'turn_right': 'locomotion-turn-right',
  'stop': 'locomotion-stop',
  'neutral_idle': 'idle-neutral',
  'happy_idle': 'idle-happy',
  'breathing_idle': 'idle-breathing',
  'nervous_idle': 'idle-nervous',
  'floor_sit': 'sit-floor',
  'typing_sit': 'sit-typing',
  'stand_to_sit': 'transition-stand-to-sit',
  'sit_to_stand': 'transition-sit-to-stand',
  'floor_to_stand': 'transition-floor-to-stand',
  'cheer': 'emote-cheer',
  'dance_silly': 'emote-dance-silly',
  'bored': 'emote-bored',
  'defeat': 'action-defeat',
  'rope_climb': 'action-rope-climb',
  'climb_top': 'action-climb-top',
  'waking': 'action-waking',
};

// Map AI commands to gestures (new system)
const GESTURE_COMMAND_MAP: Record<string, GestureType> = Object.keys(GESTURE_LIBRARY).reduce((acc, key) => {
  acc[key.toLowerCase()] = key as GestureType;
  return acc;
}, {} as Record<string, GestureType>);

// Map AI commands to emotions
const EMOTION_COMMAND_MAP: Record<string, EmotionState> = {
  'happy': 'happy',
  'joy': 'happy',
  'sad': 'sad',
  'angry': 'angry',
  'surprised': 'surprised',
  'thinking': 'thinking',
  'excited': 'excited',
  'tired': 'tired',
  'nervous': 'nervous',
  'neutral': 'neutral',
  'calm': 'neutral',
};

export class ActionParser {
  static async execute(response: string, speak: (text: string) => void) {
    console.log("🤖 AI Response:", response);
    
    // 0. Safety check - ensure VRM is loaded
    if (!avatarManager.getVRM()) {
      console.warn("[ActionParser] No VRM loaded - skipping avatar commands");
      const cleanText = response.replace(/\[.*?\]/g, '');
      speak(cleanText);
      return;
    }
    
    // 1. Extract and speak text (removing all bracketed commands)
    const cleanText = response.replace(/\[.*?\]/g, '').trim();
    if (cleanText) {
      speak(cleanText);
    }
    
    // 2. Parse all commands using regex
    // Format: [COMMAND: value] or [COMMAND]
    const commandRegex = /\[(\w+)(?::\s*(.*?))?\]/g;
    let match;
    let actionTaken = false;

    while ((match = commandRegex.exec(response)) !== null) {
      const command = match[1].toUpperCase();
      const value = match[2]?.trim().toLowerCase() || "";

      console.log(`[ActionParser] Processing command: ${command} with value: ${value}`);

      try {
        switch (command) {
          case 'REACT':
            await avatarController.react(value);
            actionTaken = true;
            break;

          case 'GESTURE': {
            const gesture = GESTURE_COMMAND_MAP[value];
            if (gesture) {
              await avatarController.performGesture(gesture);
              actionTaken = true;
            }
            break;
          }

          case 'EMOTION':
          case 'EXPRESSION': {
            const emotion = EMOTION_COMMAND_MAP[value];
            if (emotion) {
              await avatarController.setEmotion(emotion);
              actionTaken = true;
            } else if (['joy', 'surprise', 'calm'].includes(value)) {
              avatarManager.applyExpression(value as any);
              actionTaken = true;
            }
            break;
          }

          case 'POSE': {
            const mappedPoseId = POSE_COMMAND_MAP[value];
            const finalPoseId = mappedPoseId || (VALID_POSE_IDS.includes(value as any) ? value : null);
            if (finalPoseId) {
              // Enable root motion for locomotion poses to prevent "moonwalking"
              const rootMotion = finalPoseId.includes('locomotion') || ['run', 'walk', 'jog'].includes(value);
              await this.applyPresetPose(finalPoseId as PoseId, rootMotion);
              actionTaken = true;
            }
            break;
          }

          case 'BACKGROUND':
            await sceneManager.setBackground(value);
            actionTaken = true;
            break;

          case 'SCENE_ROTATION': {
            const deg = parseInt(value);
            const vrm = avatarManager.getVRM();
            const rotationLocked = useSceneSettingsStore.getState().rotationLocked;
            const isManualPosing = avatarManager.isManualPosingEnabled();
            if (vrm && !rotationLocked && !isManualPosing && !isNaN(deg)) {
              vrm.scene.rotation.y = THREE.MathUtils.degToRad(deg);
              actionTaken = true;
            }
            break;
          }

          case 'LIGHTING':
            {
              lightingManager.applyPreset(value);
              actionTaken = true;
            }
            break;

          case 'EFFECTS':
            {
              postProcessingManager.applyPreset(value);
              actionTaken = true;
            }
            break;

          case 'EFFECTS_CONFIG':
            try {
              const config = JSON.parse(value);
              if (config && typeof config === 'object') {
                const current = postProcessingManager.getSettings();
                // Deep merge for nested settings
                const categories = [
                  'bloom', 'colorGrading', 'vignette', 'filmGrain', 
                  'hueSaturation', 'pixelate', 'chromaticAberration', 'glitch'
                ];
                
                const newSettings = { ...current };
                if (config.enabled !== undefined) newSettings.enabled = config.enabled;

                categories.forEach(cat => {
                  if (config[cat] && typeof config[cat] === 'object') {
                    // @ts-ignore
                    newSettings[cat] = { ...newSettings[cat], ...config[cat] };
                  }
                });

                postProcessingManager.applySettings(newSettings);
                actionTaken = true;
              }
            } catch (e) {
              console.warn("[ActionParser] Invalid JSON for EFFECTS_CONFIG", e);
            }
            break;

          case 'CAMERA':
            sceneManager.setCameraPreset(value as any);
            actionTaken = true;
            break;

          case 'CAMERA_CONFIG':
            try {
              const config = JSON.parse(value);
              if (config && typeof config === 'object') {
                const { position, target } = config;
                if (position && target) {
                  const pos = new THREE.Vector3(position.x ?? 0, position.y ?? 0, position.z ?? 0);
                  const tgt = new THREE.Vector3(target.x ?? 0, target.y ?? 0, target.z ?? 0);
                  // Basic validation to prevent NaNs
                  if (!pos.toArray().some(isNaN) && !tgt.toArray().some(isNaN)) {
                    sceneManager.transitionCameraTo(pos, tgt, 1.0);
                    actionTaken = true;
                  }
                }
              }
            } catch (e) {
              console.warn("[ActionParser] Invalid JSON for CAMERA_CONFIG", e);
            }
            break;

          case 'LIGHT_CONFIG':
            try {
              const config = JSON.parse(value);
              
              const validTypes = ['keyLight', 'fillLight', 'rimLight', 'ambient'];
              
              if (config && typeof config === 'object') {
                Object.keys(config).forEach(lightType => {
                  if (!validTypes.includes(lightType)) return;
                  
                  const settings = config[lightType];
                  if (settings && typeof settings === 'object') {
                    Object.keys(settings).forEach(prop => {
                      lightingManager.updateLight(lightType as any, prop, settings[prop]);
                    });
                  }
                });
                actionTaken = true;
              }
            } catch (e) {
              console.warn("[ActionParser] Invalid JSON for LIGHT_CONFIG", e);
            }
            break;

          case 'ENV_CONFIG':
            try {
              const config = JSON.parse(value);
              if (config && typeof config === 'object') {
                const current = environmentManager.getSettings();
                environmentManager.applySettings({ ...current, ...config });
                actionTaken = true;
              }
            } catch (e) {
              console.warn("[ActionParser] Invalid JSON for ENV_CONFIG", e);
            }
            break;

          case 'MUSIC':
            try {
              const store = useMusicStore.getState();
              const args = value.split(' ');
              const action = args[0];
              
              switch (action) {
                case 'play': store.play(); break;
                case 'pause': store.pause(); break;
                case 'stop': store.pause(); break;
                case 'next': store.next(); break;
                case 'prev': store.prev(); break;
                case 'mute': store.toggleMute(); break;
                case 'shuffle': store.toggleShuffle(); break;
                case 'volume': 
                case 'vol':
                  const vol = parseFloat(args[1]);
                  if (!isNaN(vol)) store.setVolume(vol);
                  break;
              }
              actionTaken = true;
            } catch (e) {
              console.warn("[ActionParser] Music control failed", e);
            }
            break;

          case 'AVATAR':
            try {
              useAIStore.getState().setThought("Searching Avatar...");
              
              const listStore = useAvatarListStore.getState();
              // Ensure list is loaded
              if (listStore.avatars.length === 0) {
                await listStore.fetchAvatars();
              }
              
              const term = value.toLowerCase();
              let found;

              if (term === 'random') {
                found = listStore.getRandomAvatar();
              } else {
                found = listStore.avatars.find(a => 
                  a.name.toLowerCase().includes(term) || 
                  a.id.toLowerCase() === term ||
                  (a.description && a.description.toLowerCase().includes(term))
                );
              }
              
              if (found) {
                useAIStore.getState().setThought(`Loading ${found.name}...`);
                useAvatarSource.getState().setRemoteUrl(found.model_file_url, found.name);
                actionTaken = true;
              } else {
                console.warn(`[ActionParser] Avatar not found: ${value}`);
              }
              useAIStore.getState().setThought(null);
            } catch (e) {
              console.warn("[ActionParser] Avatar load failed", e);
              useAIStore.getState().setThought(null);
            }
            break;

          case 'UI':
            try {
              const ui = useUIStore.getState();
              
              if (value === 'clean' || value === 'stream') {
                ui.setStreamMode(true);
              } else if (value === 'default' || value === 'normal') {
                ui.setStreamMode(false);
                ui.setActiveCssOverlay(null);
              } else if (value.startsWith('overlay_')) {
                ui.setActiveCssOverlay(value.replace('_', '-')); // fix potential ai typo overlay_glitch -> overlay-glitch
              } else if (value === 'scanlines') {
                ui.setActiveCssOverlay('overlay-scanlines');
              } else if (value === 'glitch') {
                ui.setActiveCssOverlay('overlay-glitch');
              } else if (value === 'vignette') {
                ui.setActiveCssOverlay('overlay-vignette');
              } else if (value === 'crt') {
                ui.setActiveCssOverlay('overlay-crt');
              }
              actionTaken = true;
            } catch (e) {
              console.warn("[ActionParser] UI control failed", e);
            }
            break;

          case 'EXPORT':
            if (value === 'png' || value === 'photo') {
              const dataUrl = await sceneManager.captureSnapshot();
              if (dataUrl) {
                const link = document.createElement('a');
                link.download = `poselab-ai-snapshot-${Date.now()}.png`;
                link.href = dataUrl;
                link.click();
                actionTaken = true;
              }
            } else if (value === 'video') {
              const canvas = sceneManager.getCanvas();
              if (canvas) {
                useAIStore.getState().setThought("Recording Video...");
                // 5 second default duration for AI-triggered video
                await exportAsWebM(canvas, 5, `poselab-ai-video-${Date.now()}.webm`);
                useAIStore.getState().setThought(null);
                actionTaken = true;
              }
            } else if (value === 'render') {
              useAIStore.getState().setThought("Rendering High-Quality Video...");
              // 5 second default duration
              await exportOfflineWebM({ duration: 5 });
              useAIStore.getState().setThought(null);
              actionTaken = true;
            }
            break;

          case 'VMC':
            {
              const { setVmcEnabled } = useReactionStore.getState();
              if (value === 'connect' || value === 'on') setVmcEnabled(true);
              else if (value === 'disconnect' || value === 'off') setVmcEnabled(false);
              actionTaken = true;
            }
            break;

          case 'LOOK_AT_USER':
            {
              useAIStore.getState().setThought("Watching...");
              const manager = getMocapManager();
              if (manager) {
                await manager.aiInterpret("The user wants you to look at them and interpret their state.");
                actionTaken = true;
              }
              useAIStore.getState().setThought(null);
            }
            break;

          case 'GENERATE_POSE':
            {
              useAIStore.getState().setThought("Generating Pose...");
              if (geminiService.isReady()) {
                const result = await geminiService.generatePose(value);
                if (result?.vrmPose) {
                  const rotLocked = useSceneSettingsStore.getState().rotationLocked;
                  await avatarManager.applyRawPose({
                    vrmPose: result.vrmPose,
                    sceneRotation: result.sceneRotation
                  }, rotLocked, 'static');
                  if ((result as any).background) {
                    await sceneManager.setBackground((result as any).background);
                  }
                  actionTaken = true;
                }
              }
              useAIStore.getState().setThought(null);
            }
            break;

          case 'DIRECTOR':
            {
              useAIStore.getState().setThought("Directing Sequence...");
              const script = await agentManager.generateDirectorScript(value);
              if (script) {
                // 1. Set the script in the store so it's visible/editable
                useDirectorStore.getState().setScript(script);
                
                // 2. Switch UI to Director tab
                useUIStore.getState().setPoseLabTab('director');
                
                // 3. Play the script
                await directorManager.playScript(script);
                actionTaken = true;
              }
              useAIStore.getState().setThought(null);
            }
            break;

          case 'TIMELINE':
            {
              const tl = useTimelineStore.getState();
              const tlArgs = value.split(' ');
              const tlAction = tlArgs[0];
              
              if (tlAction === 'play') tl.setIsPlaying(true);
              else if (tlAction === 'pause') tl.setIsPlaying(false);
              else if (tlAction === 'stop') { tl.setIsPlaying(false); tl.setCurrentTime(0); }
              else if (tlAction === 'clear') tl.clearTimeline();
              else if (tlAction === 'time' && tlArgs[1]) tl.setCurrentTime(parseFloat(tlArgs[1]));
              else if (tlAction === 'keyframe') {
                const pose = avatarManager.captureCurrentPose();
                if (pose && Object.keys(pose).length > 0) {
                    tl.addKeyframe({ 
                        time: tl.currentTime, 
                        pose: pose, 
                        easing: 'linear'
                    });
                    console.log("[ActionParser] Timeline keyframe added at", tl.currentTime);
                    useAIStore.getState().setThought("Added Keyframe");
                }
              }
              actionTaken = true;
            }
            break;

          case 'SETTINGS':
            {
              const setStore = useSettingsStore.getState();
              const setArgs = value.split(' ');
              const setType = setArgs[0];
              const setVal = setArgs[1];

              if (setType === 'quality') setStore.setQuality(setVal as any);
              else if (setType === 'shadows') setStore.setShadows(setVal === 'on' || setVal === 'true');
              else if (setType === 'theme') setStore.setTheme(setVal as any);
              else if (setType === 'viewport') setStore.setViewportStyle(setVal as any);
              actionTaken = true;
            }
            break;

          case 'CALIBRATE':
            {
              const mManager = getMocapManager();
              if (mManager) {
                  mManager.calibrate();
                  useAIStore.getState().setThought("Calibrated Mocap");
                  actionTaken = true;
              }
            }
            break;
            
          case 'RESET_CAMERA':
             sceneManager.setCameraPreset('headshot');
             actionTaken = true;
             break;
        }
      } catch (e) {
        console.error(`[ActionParser] Failed to execute command ${command}:`, e);
      }
    }

    // 3. If no action was taken, ensure we look alive
    if (!actionTaken) {
      avatarController.startIdleAnimation();
    }
  }

  private static async applyPresetPose(poseId: PoseId, rootMotion = false): Promise<boolean> {
    try {
      const rotationLocked = useSceneSettingsStore.getState().rotationLocked;
      await avatarManager.applyPose(poseId, rotationLocked, true, 'loop', rootMotion);
      return true;
    } catch (e) {
      console.error(`[ActionParser] Failed to apply pose ${poseId}:`, e);
      return false;
    }
  }
}
