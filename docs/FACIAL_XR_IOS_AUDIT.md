# Facial XR iPhone & Provenance Audit

Audit date: 2026-07-18

## Product boundary

PoseLab supports a browser-first Facial XR tier on iPhone: front camera, microphone-driven lip sync, local canvas video recording, and local take provenance. It does **not** receive native TrueDepth depth, `ARFaceAnchor`, or ARKit blendshape data from Safari. The UI must describe this as browser landmark tracking, not ARKit-quality face capture.

Safari's browser capture path is appropriate for the primary flow:

1. Load a VRM from Files.
2. Open the mobile tools drawer and enter Facial XR from the Face AR tab.
3. Grant camera and microphone access from the explicit browser prompt.
4. Confirm tracking health and use the stage record button.
5. Save the video locally and optionally download its Take Passport.

## Changes applied

- Camera startup now uses mobile-friendly 1280×720 ideals, falls back safely from stale camera IDs, waits for real inline playback, and reports interrupted streams.
- The tracker uses request-video-frame callbacks where available, cancels stale callbacks on stop/restart, and adaptively budgets mobile inference at 18–24 FPS so rendering and video capture remain responsive.
- The hidden camera source remains an imperceptible, inline-playable element for WebKit instead of `display:none`, avoiding WebKit's hidden-video throttling behavior.
- The Facial XR entry flow starts Face AR and voice together, gives a compact preflight, surfaces tracker FPS, and provides a local calibration/data-clear control.
- Canvas recording uses feature-detected WebM/MP4 formats, prefers MP4 on iPhone, records one-second chunks, keeps tracks alive until the recorder flushes, and shares a cloned live lip-sync microphone instead of opening a competing mic stream.
- Each completed video can create a local Take Passport containing a SHA-256 digest, codec, non-identifying track settings, canvas dimensions, avatar label, tracker health, and integrity events. It never contains raw camera frames, audio, device IDs, or an upload URL.
- A current camera frame can only be sent to Gemini after a fresh, one-time confirmation. Remote Studio Feed messages no longer execute application commands.
- Multiplayer binary transfers are sender-bound, target-bound, size-limited (20 MiB VRM / 5 MiB background), time-limited, and validated before allocation or JSON parsing.

## Verification

- `npm run build` completed successfully on 2026-07-18.
- The build includes existing lint warnings, but no lint errors, type errors, or Vite build failures.

## Required device acceptance pass

Run this on real hardware before release; a desktop build cannot certify iOS media behavior.

| Scenario | Expected result |
| --- | --- |
| iPhone Safari, first visit | Avatar loads from Files; camera/mic prompts occur only after the Facial XR action. |
| Start, stop, restart Facial XR | No duplicate tracker loop; camera LED turns off after exit; restart selects front camera if a saved device ID is stale. |
| Lock/unlock or background/foreground | Stream either resumes or clearly reports **Camera interrupted** with a deterministic stop/start recovery. |
| 60-second Face AR recording with voice | Smooth canvas output, audible voice, correct `.mp4` when Safari selects MP4, and no truncated final second. |
| Mic denied | Face AR remains usable; recorder clearly states that it will save video only. |
| Passport | The video hash verifies against the downloaded file and no device ID, track label, raw landmark, frame, or audio payload appears in the JSON. |

## Remaining system risks

These require product/authentication decisions and were deliberately not changed in this pass.

1. **Critical:** LiveKit tokens can be minted without a signed user/session check. Require server-side identity, short TTLs, cryptographically strong room IDs, and least-privilege grants.
2. **Critical:** Discord publishing/chat server functions need server-side authentication and authorization; do not rely on user-controlled display names or room inputs.
3. **High:** Multiplayer still transfers complete VRM buffers automatically. This pass adds sender/target binding, transfer caps, byte validation, and expiry; add explicit share-avatar consent and authenticated peer identity before opening user-generated rooms.
4. **High:** Avatar license/source/author metadata is not preserved through the picker and exports. Pin manifests, retain attribution, and add a publishing-rights attestation.
5. **High:** Third-party runtime scripts and broad camera/microphone Permissions-Policy should be replaced with an integrity-pinned/self-hosted supply chain and a tested allowlist CSP. Test Discord embedding before narrowing the policy.

## Research references

- [Apple ARFaceTrackingConfiguration](https://developer.apple.com/documentation/arkit/arfacetrackingconfiguration)
- [Google MediaPipe Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [WebKit MediaRecorder API](https://webkit.org/blog/11353/mediarecorder-api/)
- [Epic Live Link Face recording workflow](https://dev.epicgames.com/documentation/unreal-engine/recording-face-animation-on-ios-device-in-unreal-engine)
