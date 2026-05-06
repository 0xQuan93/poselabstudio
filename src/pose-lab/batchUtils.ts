import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type VRM } from '@pixiv/three-vrm';
import { getMixamoAnimation } from './getMixamoAnimation';
import { poseFromClip } from './poseFromClip';
import { convertAnimationToScenePaths } from './convertAnimationToScenePaths';
import type { PoseId } from '../types/reactions';

function retargetWithWorker(vrmBuffer: ArrayBuffer, animationBuffer: ArrayBuffer, animationFileName: string): Promise<THREE.AnimationClip> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./retarget.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      if (event.data.success) {
        const clip = THREE.AnimationClip.parse(event.data.animationClip);
        resolve(clip);
      } else {
        reject(new Error(event.data.error));
      }
      worker.terminate();
    };

    worker.onerror = (error) => {
      reject(error);
      worker.terminate();
    };

    worker.postMessage({ vrmBuffer, animationBuffer, animationFileName }, [vrmBuffer, animationBuffer]);
  });
}

const DEFAULT_SCENE_ROTATION = { y: 180 };

export const mixamoSources = {
  pointing: '/poses/fbx/Pointing.fbx',
  thumbsUp: '/poses/fbx/Standing Thumbs Up.fbx',
  waking: '/poses/fbx/Waking.fbx',
  cheering: '/poses/fbx/Cheering.fbx',
  clapping: '/poses/fbx/Clapping.fbx',
  happyIdle: '/poses/fbx/Happy Idle.fbx',
  offensiveIdle: '/poses/fbx/Offensive Idle.fbx',
  focus: '/poses/fbx/Focus.fbx',
  ropeClimb: '/poses/fbx/Rope Climb.fbx',
  sillyDancing: '/poses/fbx/Silly Dancing.fbx',
  taunt: '/poses/fbx/Taunt.fbx',
  treadingWater: '/poses/fbx/Treading Water.fbx',
  defeat: '/poses/fbx/Defeat.fbx',
  climbingToTop: '/poses/fbx/Climbing To Top.fbx',
  
  // New Locomotion
  walking: '/poses/fbx/Walking.fbx',
  running: '/poses/fbx/Running.fbx',
  slowRun: '/poses/fbx/Slow Run.fbx',
  crouchedWalking: '/poses/fbx/Crouched Walking.fbx',
  leftTurn: '/poses/fbx/Left Turn.fbx',
  rightTurn: '/poses/fbx/Right Turn.fbx',
  stopWalking: '/poses/fbx/Stop Walking.fbx',

  // New Idles
  neutralIdle: '/poses/fbx/Neutral Idle.fbx',
  breathingIdle: '/poses/fbx/Breathing Idle.fbx',
  nervouslyLookAround: '/poses/fbx/Nervously Look Around.fbx',

  // New Sitting
  sitting: '/poses/fbx/Sitting.fbx',
  sittingFloor: '/poses/fbx/Sitting Floor.fbx',
  sittingSad: '/poses/fbx/Sitting Sad.fbx',
  typing: '/poses/fbx/Typing.fbx',
  standToSit: '/poses/fbx/Stand To Sit.fbx',
  sitToStand: '/poses/fbx/Sit To Stand.fbx',
  standingUpFromFloor: '/poses/fbx/Standing Up From Floor.fbx',

  // New Social
  waving: '/poses/fbx/Waving.fbx',
  quickFormalBow: '/poses/fbx/Quick Formal Bow.fbx',
  bored: '/poses/fbx/Bored.fbx',
};

export type BatchPoseConfig = {
  id: PoseId;
  label: string;
  source: string;
  fileName: string;
  sceneRotation?: { x?: number; y?: number; z?: number };
};

export const batchConfigs: BatchPoseConfig[] = [
  // Locomotion
  { id: 'locomotion-walk', label: 'Walk', source: mixamoSources.walking, fileName: 'Walking.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'locomotion-run', label: 'Run', source: mixamoSources.running, fileName: 'Running.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'locomotion-jog', label: 'Jog', source: mixamoSources.slowRun, fileName: 'Slow Run.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'locomotion-crouch-walk', label: 'Crouch Walk', source: mixamoSources.crouchedWalking, fileName: 'Crouched Walking.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'locomotion-turn-left', label: 'Turn Left', source: mixamoSources.leftTurn, fileName: 'Left Turn.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'locomotion-turn-right', label: 'Turn Right', source: mixamoSources.rightTurn, fileName: 'Right Turn.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'locomotion-stop', label: 'Stop Walking', source: mixamoSources.stopWalking, fileName: 'Stop Walking.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },

  // Idles
  { id: 'idle-neutral', label: 'Neutral Idle', source: mixamoSources.neutralIdle, fileName: 'Neutral Idle.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'idle-happy', label: 'Happy Idle', source: mixamoSources.happyIdle, fileName: 'Happy Idle.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'idle-breathing', label: 'Breathing Idle', source: mixamoSources.breathingIdle, fileName: 'Breathing Idle.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'idle-nervous', label: 'Nervous Look', source: mixamoSources.nervouslyLookAround, fileName: 'Nervously Look Around.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'idle-offensive', label: 'Offensive Idle', source: mixamoSources.offensiveIdle, fileName: 'Offensive Idle.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },

  // Sitting
  { id: 'sit-chair', label: 'Sit (Chair)', source: mixamoSources.sitting, fileName: 'Sitting.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'sit-floor', label: 'Sit (Floor)', source: mixamoSources.sittingFloor, fileName: 'Sitting Floor.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'sit-sad', label: 'Sit (Sad)', source: mixamoSources.sittingSad, fileName: 'Sitting Sad.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'sit-typing', label: 'Typing', source: mixamoSources.typing, fileName: 'Typing.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'transition-stand-to-sit', label: 'Stand to Sit', source: mixamoSources.standToSit, fileName: 'Stand To Sit.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'transition-sit-to-stand', label: 'Sit to Stand', source: mixamoSources.sitToStand, fileName: 'Sit To Stand.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'transition-floor-to-stand', label: 'Floor to Stand', source: mixamoSources.standingUpFromFloor, fileName: 'Standing Up From Floor.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },

  // Social / Emotes
  { id: 'emote-wave', label: 'Wave', source: mixamoSources.waving, fileName: 'Waving.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'emote-point', label: 'Point', source: mixamoSources.pointing, fileName: 'Pointing.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'emote-clap', label: 'Clap', source: mixamoSources.clapping, fileName: 'Clapping.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'emote-cheer', label: 'Cheer', source: mixamoSources.cheering, fileName: 'Cheering.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'emote-thumbsup', label: 'Thumbs Up', source: mixamoSources.thumbsUp, fileName: 'Standing Thumbs Up.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'emote-bow', label: 'Bow', source: mixamoSources.quickFormalBow, fileName: 'Quick Formal Bow.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'emote-dance-silly', label: 'Silly Dance', source: mixamoSources.sillyDancing, fileName: 'Silly Dancing.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'emote-taunt', label: 'Taunt', source: mixamoSources.taunt, fileName: 'Taunt.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'emote-bored', label: 'Bored', source: mixamoSources.bored, fileName: 'Bored.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },

  // Action / Misc
  { id: 'action-defeat', label: 'Defeat', source: mixamoSources.defeat, fileName: 'Defeat.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'action-focus', label: 'Focus', source: mixamoSources.focus, fileName: 'Focus.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'action-rope-climb', label: 'Rope Climb', source: mixamoSources.ropeClimb, fileName: 'Rope Climb.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'action-climb-top', label: 'Climb Top', source: mixamoSources.climbingToTop, fileName: 'Climbing To Top.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'action-swim', label: 'Treading Water', source: mixamoSources.treadingWater, fileName: 'Treading Water.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
  { id: 'action-waking', label: 'Waking', source: mixamoSources.waking, fileName: 'Waking.fbx', sceneRotation: DEFAULT_SCENE_ROTATION },
];

export const loadMixamoFromBuffer = async (arrayBuffer: ArrayBuffer, fileName: string) => {
  const ext = fileName.toLowerCase().split('.').pop();
  let mixamoRoot: THREE.Object3D;
  let animations: THREE.AnimationClip[];

  if (ext === 'fbx') {
    const loader = new FBXLoader();
    const group = loader.parse(arrayBuffer, '');
    mixamoRoot = group;
    animations = group.animations;
  } else {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(arrayBuffer, '');
    mixamoRoot = gltf.scene || gltf;
    animations = gltf.animations;
  }

  return { mixamoRoot, animations };
};

export const applyMixamoBuffer = async (arrayBuffer: ArrayBuffer, fileName: string, vrm: VRM) => {
    // To use the worker, we need to serialize the VRM to a buffer
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const vrmBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(vrm.scene, (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          // Handle JSON case if necessary, for simplicity we assume binary
          const output = JSON.stringify(result, null, 2);
          resolve(new TextEncoder().encode(output).buffer);
        }
      }, reject, { binary: true });
    });

    let vrmClip: THREE.AnimationClip;
    try {
      console.log('[BatchUtils] Retargeting with Web Worker...');
      vrmClip = await retargetWithWorker(vrmBuffer.slice(0), arrayBuffer.slice(0), fileName);
    } catch (error) {
      console.warn('[BatchUtils] Web Worker retargeting failed, falling back to main thread.', error);
      // Fallback to main thread if worker fails
      const { mixamoRoot, animations } = await loadMixamoFromBuffer(arrayBuffer, fileName);
      const clip = getMixamoAnimation(animations, mixamoRoot, vrm);
      if (!clip) {
        throw new Error('Failed to convert Mixamo data for this VRM on main thread.', { cause: error });
      }
      vrmClip = clip;
    }

    // Convert animation to use scene node paths (critical for playback in main app)
    const scenePathClip = convertAnimationToScenePaths(vrmClip, vrm);
    console.log('[BatchUtils] Converted animation to scene paths');

    const pose = poseFromClip(vrmClip);
    if (!pose || !Object.keys(pose).length) {
      throw new Error('Mixamo clip did not contain pose data.');
    }

    vrm.humanoid?.setNormalizedPose(pose);
    vrm.update(0);

    return { pose, animationClip: scenePathClip };
};

export const savePoseToDisk = async (
    poseId: PoseId,
    payload: {
      sceneRotation?: { x?: number; y?: number; z?: number };
      vrmPose: any; // VRMPose
      animationClip?: THREE.AnimationClip;
    }
  ) => {
    // Save pose JSON
    const response = await fetch('/__pose-export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ poseId, data: payload }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to save pose');
    }

    // If animation clip exists, save it separately
    if (payload.animationClip) {
      const { serializeAnimationClip } = await import('../poses/animationClipSerializer');
      const serialized = serializeAnimationClip(payload.animationClip);
      
      const animResponse = await fetch('/__pose-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poseId: `${poseId}-animation`,
          data: serialized,
        }),
      });
      if (!animResponse.ok) {
        console.warn('Failed to save animation clip for', poseId);
      }
    }
};
