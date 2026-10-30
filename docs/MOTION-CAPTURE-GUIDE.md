# 🎥 Motion Capture Guide (v3.1 - System Animator Parity)

> "Motion is the language of the soul, translated into digital form."

The **Motion Capture** system has been radically upgraded in version 3.1 to match the robustness of *SystemAnimatorOnline*. We have rebuilt the core loop to ensure physics synchronization and added professional-grade adaptive smoothing using the **OneEuroFilter**.

---

## ✨ Major Upgrades in v3.1

### 1. 🧠 Adaptive Smoothing (OneEuroFilter)
We have replaced simple Lerp with the **OneEuroFilter** (1€ Filter), a standard in academic and professional motion capture.
- **Problem**: Simple smoothing is either too jittery (low smoothing) or too laggy (high smoothing).
- **Solution**: The OneEuroFilter adapts its cutoff frequency based on velocity.
  - **When still**: It lowers the cutoff frequency (heavy smoothing) to eliminate "jitter" and "webcam breathing".
  - **When moving**: It raises the cutoff frequency (light smoothing) to capture fast movements with near-zero latency.
- **Result**: You get the precision of raw tracking for action, with the stability of a statue for stillness.

### 2. 🧶 Physics Rail Synchronization (Priority Tick)
Previously, physics often updated *before* bones moved, causing hair and clothes to "lag" or vibrate.
- **New Architecture**: The motion capture system now runs on a **High Priority Tick** within the `SceneManager`.
- **Order of Execution**:
  1. **Mocap Tick (Priority 100)**: Sets bone rotations from webcam data.
  2. **Avatar Tick (Priority 0)**: Updates `VRM` and physics (SpringBone) based on the *new* bone positions.
  3. **Render**: Draws the frame.
- **Benefit**: Every bone movement is perfectly synchronized with the physics engine.

### 3. 📱 Face AR (iPhone Safari — honest limits)
This is **Safari Face AR UX**, not native ARKit.

- **iPhone Safari**: No WebXR `immersive-ar`, no browser TrueDepth / `ARFaceAnchor`. Best path is front camera + MediaPipe **Face Landmarker** (Holistic fallback) with ARKit-named blendshape → VRM mapping.
- **WebXR immersive-ar**: Chrome Android / compatible headsets only. The AR button is hidden when `isSessionSupported('immersive-ar')` is false.
- **WebXR immersive-vr**: visionOS-oriented. `vrManager` “Facial XR masks” hide avatar face meshes from the **headset camera** — not TrueDepth.
- **Optional native ARKit**: local iOS companion (`VITE_ENABLE_ARKIT_FACE_BRIDGE`, LAN WebSocket). Off by default. See `companion/README.md`.
- **Usage**: Load a VRM → **Mocap** → **Go Live (Face)** or **Enter Facial XR**. Allow the front camera when Safari asks.
- **Overlay**: Webcam is `scene.background` (`THREE.VideoTexture`). **Head-Only** hides body meshes and keeps head/neck/hair.

---

## 🛠️ How to Use

### Setup
1. **Lighting**: Ensure your face is well-lit. Avoid strong backlighting.
2. **Camera Position**: Place camera at eye level.
3. **Distance**: Stand/sit where your head and shoulders are clearly visible.

### Modes
- **Full Body**: Tracks body + face + fingers (MediaPipe Holistic). Best for full performance.
- **Upper Body**: Face, hands, and arms without lower-body tracking.
- **Face Only**: Head + ARKit-mapped expressions via Face Landmarker. Best path on iPhone Safari.
- **Face Overlay / Head-Only**: Webcam passthrough background; hide body meshes.
- **WebXR AR**: Only on browsers where `immersive-ar` is supported. Not iOS Safari.

### Troubleshooting

| Issue | Solution |
|-------|----------|
| **Jittery Hands** | The OneEuroFilter handles this. If still jittery, improve lighting. |
| **Physics Lag** | The new Priority Tick system should eliminate this. Ensure FPS > 30. |
| **AR Button Missing** | Only appears on WebXR-compatible browsers (Chrome Android, Quest Browser). |

---

## 🔧 Technical Architecture

### The Update Loop
1. **MediaPipe** captures landmarks (async) on the main thread today. A worker-based pipeline is planned for a future performance pass.
2. **Kalidokit** solves the pose.
3. **MotionCaptureManager** calculates target rotations.
4. **SceneManager** calls `tick(delta)` handlers in priority order.
   - **Priority 100**: `MotionCaptureManager` applies smooth rotations to bones.
   - **Priority 0**: `AvatarManager` updates Physics/SpringBones.
5. **Renderer** draws the frame.

### OneEuroFilter Configuration
We use specific tuning for different body parts:
- **Body**: `minCutoff: 1.0`, `beta: 0.5` (Balanced)
- **Eyes**: `minCutoff: 2.0` (More responsive)
- **Head**: `minCutoff: 0.5` (More stable)

### Files
- `src/utils/OneEuroFilter.ts`: The adaptive filter implementation.
- `src/utils/motionCapture.ts`: Core logic and filter application.
- `src/utils/webXRManager.ts`: AR session handling.
- `src/three/sceneManager.ts`: Priority-based render loop.
