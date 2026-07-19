import type { AnimationClip } from 'three';
import type { VRM, VRMPose } from '@pixiv/three-vrm';
import type { PoseId } from '../types/reactions';

type EulerDegrees = {
  x?: number;
  y?: number;
  z?: number;
};

export type PoseDefinition = {
  sceneRotation?: EulerDegrees;
  vrmPose?: VRMPose;
  boneRotations?: Record<string, EulerDegrees>;
  /** Optional animation clip, resolved separately when a pose is animated. */
  animationClip?: AnimationClip;
  isAnimated?: boolean;
};

type PoseModule = { default: unknown };
type PoseLoader = () => Promise<PoseDefinition>;

/**
 * Wrap a JSON module in a loader so each authored pose remains an independent
 * production chunk. Keeping the import paths literal lets Vite include every
 * pose while fetching only the selected one at runtime.
 */
const loadJsonPose = (
  load: () => Promise<PoseModule>,
  overrides: Partial<PoseDefinition> = {},
): PoseLoader => async () => {
  const { default: definition } = await load();
  return { ...(definition as PoseDefinition), ...overrides };
};

/**
 * The full authored pose catalogue is large. Do not turn this into static
 * imports: the lightweight loader table makes avatar startup independent of
 * every optional animation in the catalogue.
 */
const poseLoaders = {
  'dawn-runner': loadJsonPose(() => import('./dawn-runner.json')),
  'sunset-call': loadJsonPose(() => import('./sunset-call.json')),
  'cipher-whisper': loadJsonPose(() => import('./cipher-whisper.json')),
  'nebula-drift': loadJsonPose(() => import('./nebula-drift.json')),
  'signal-reverie': loadJsonPose(() => import('./signal-reverie.json')),
  'agent-taunt': loadJsonPose(() => import('./agent-taunt.json')),
  'agent-dance': loadJsonPose(() => import('./agent-dance.json')),
  'agent-clapping': loadJsonPose(() => import('./agent-clapping.json')),
  'silly-agent': loadJsonPose(() => import('./silly-agent.json')),
  'simple-wave': loadJsonPose(() => import('./simple-wave.json')),
  point: loadJsonPose(() => import('./point.json')),
  defeat: loadJsonPose(() => import('./defeat.json')),
  focus: loadJsonPose(() => import('./focus.json')),
  'rope-climb': loadJsonPose(() => import('./rope-climb.json')),
  'climb-top': loadJsonPose(() => import('./climb-top.json')),
  'thumbs-up': loadJsonPose(() => import('./thumbs-up.json')),
  'offensive-idle': loadJsonPose(() => import('./offensive-idle.json')),
  waking: loadJsonPose(() => import('./waking.json')),
  'treading-water': loadJsonPose(() => import('./treading-water.json')),
  cheering: loadJsonPose(() => import('./cheering.json')),

  'locomotion-walk': loadJsonPose(() => import('./locomotion-walk.json')),
  'locomotion-run': loadJsonPose(() => import('./locomotion-run.json')),
  'locomotion-jog': loadJsonPose(() => import('./locomotion-jog.json')),
  'locomotion-crouch-walk': loadJsonPose(() => import('./locomotion-crouch-walk.json')),
  'locomotion-turn-left': loadJsonPose(() => import('./locomotion-turn-left.json')),
  'locomotion-turn-right': loadJsonPose(() => import('./locomotion-turn-right.json')),
  'locomotion-stop': loadJsonPose(() => import('./locomotion-stop.json')),

  'idle-neutral': loadJsonPose(() => import('./idle-neutral.json')),
  'idle-happy': loadJsonPose(() => import('./idle-happy.json')),
  'idle-breathing': loadJsonPose(() => import('./idle-neutral.json'), { isAnimated: true }),
  'idle-nervous': loadJsonPose(() => import('./idle-nervous.json')),
  'idle-offensive': loadJsonPose(() => import('./offensive-idle.json')),

  'sit-chair': loadJsonPose(() => import('./sit-chair.json')),
  'sit-floor': loadJsonPose(() => import('./sit-sad.json'), { isAnimated: true }),
  'sit-sad': loadJsonPose(() => import('./sit-sad.json')),
  'sit-typing': loadJsonPose(() => import('./sit-chair.json'), { isAnimated: true }),
  'transition-stand-to-sit': loadJsonPose(() => import('./transition-stand-to-sit.json')),
  'transition-sit-to-stand': loadJsonPose(() => import('./transition-sit-to-stand.json')),
  'transition-floor-to-stand': async () => ({ isAnimated: true }),

  'emote-wave': loadJsonPose(() => import('./emote-wave.json')),
  'emote-point': loadJsonPose(() => import('./emote-point.json')),
  'emote-clap': loadJsonPose(() => import('./emote-clap.json')),
  'emote-cheer': loadJsonPose(() => import('./emote-cheer.json')),
  'emote-thumbsup': loadJsonPose(() => import('./emote-thumbsup.json')),
  'emote-bow': loadJsonPose(() => import('./emote-bow.json')),
  'emote-dance-silly': loadJsonPose(() => import('./emote-dance-silly.json')),
  'emote-taunt': loadJsonPose(() => import('./emote-taunt.json')),
  'emote-bored': loadJsonPose(() => import('./idle-neutral.json'), { isAnimated: true }),

  'action-defeat': loadJsonPose(() => import('./defeat.json')),
  'action-focus': loadJsonPose(() => import('./action-focus.json')),
  'action-rope-climb': loadJsonPose(() => import('./action-rope-climb.json')),
  'action-climb-top': loadJsonPose(() => import('./action-climb-top.json')),
  'action-swim': loadJsonPose(() => import('./action-swim.json')),
  'action-waking': loadJsonPose(() => import('./action-waking.json')),
} satisfies Record<PoseId, PoseLoader>;

/** Stable public catalogue for AI command validation and external ID listing. */
export const poseLibrary = Object.fromEntries(
  (Object.keys(poseLoaders) as PoseId[]).map((id) => [id, {}]),
) as Record<PoseId, PoseDefinition>;

const definitionPromises = new Map<PoseId, Promise<PoseDefinition>>();

/**
 * Resolve an authored pose on demand. Repeated calls share one promise and
 * hydrate the public catalogue entry after the first successful load.
 */
export function getPoseDefinition(id: PoseId): Promise<PoseDefinition | undefined> {
  const loader = poseLoaders[id];
  if (!loader) return Promise.resolve(undefined);

  const existing = definitionPromises.get(id);
  if (existing) return existing;

  const pending = loader()
    .then((definition) => {
      poseLibrary[id] = definition;
      return definition;
    })
    .catch((error: unknown) => {
      // A transient chunk request failure should be retryable.
      definitionPromises.delete(id);
      throw error;
    });

  definitionPromises.set(id, pending);
  return pending;
}

/**
 * Resolve a pose and, only when needed, load and retarget its animation clip.
 */
export async function getPoseDefinitionWithAnimation(
  id: PoseId,
  vrm?: VRM,
): Promise<PoseDefinition | undefined> {
  const definition = await getPoseDefinition(id);
  if (!definition) return undefined;

  // Preserve the existing cache behavior for callers that do not retarget.
  if (definition.animationClip && !vrm) return definition;

  const { loadAnimationClip } = await import('./loadAnimationClip');
  const animationClip = await loadAnimationClip(id, vrm);

  if (!animationClip) return definition;

  // Retargeted clips are VRM-specific, so do not cache this derived result.
  return {
    ...definition,
    animationClip,
    isAnimated: true,
  };
}
