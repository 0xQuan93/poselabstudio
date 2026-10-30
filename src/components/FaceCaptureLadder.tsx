import { describeCaptureTier, type FaceCaptureCapabilities } from '../utils/faceCaptureCapabilities';

interface FaceCaptureLadderProps {
  capabilities: FaceCaptureCapabilities | null;
  activeTier?: FaceCaptureCapabilities['recommendedTier'] | 'holistic' | null;
  companionConnected?: boolean;
}

const TIERS: Array<FaceCaptureCapabilities['recommendedTier']> = [
  'arkit-companion',
  'webxr-ar',
  'mediapipe-face',
];

export function FaceCaptureLadder({
  capabilities,
  activeTier,
  companionConnected = false,
}: FaceCaptureLadderProps) {
  if (!capabilities) {
    return (
      <div className="face-capture-ladder" aria-busy="true">
        <p className="muted small">Detecting camera and XR capabilities…</p>
      </div>
    );
  }

  return (
    <div className="face-capture-ladder" aria-label="Face capture capability ladder">
      <div className="face-capture-ladder__header">
        <span>Capture path</span>
        <strong>{capabilities.recommendedLabel}</strong>
      </div>
      <ol className="face-capture-ladder__list">
        {TIERS.map((tier) => {
          const copy = describeCaptureTier(tier);
          const available =
            tier === 'arkit-companion'
              ? capabilities.companionFlagEnabled
              : tier === 'webxr-ar'
                ? capabilities.webxrImmersiveAR
                : capabilities.hasCamera;
          const recommended = capabilities.recommendedTier === tier;
          const active = activeTier === tier || (tier === 'arkit-companion' && companionConnected);
          const unavailableOnSafari =
            tier === 'webxr-ar' && (capabilities.isIOS || capabilities.isIPadOS) && capabilities.isSafari;

          return (
            <li
              key={tier}
              className={[
                'face-capture-ladder__item',
                available ? 'is-available' : 'is-unavailable',
                recommended ? 'is-recommended' : '',
                active ? 'is-active' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className="face-capture-ladder__dot" aria-hidden="true" />
              <div>
                <strong>{copy.title}</strong>
                <p>
                  {unavailableOnSafari
                    ? 'Not available on iOS Safari (no WebXR immersive-ar, no browser ARKit).'
                    : copy.detail}
                  {tier === 'arkit-companion' && !capabilities.companionFlagEnabled
                    ? ' Enable with VITE_ENABLE_ARKIT_FACE_BRIDGE=true.'
                    : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {capabilities.limitationNotes.map((note) => (
        <p key={note} className="muted small face-capture-ladder__note">
          {note}
        </p>
      ))}
    </div>
  );
}
