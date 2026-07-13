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

### 3. 📱 Face AR (iPhone Safari prioritized)
You can now bring your avatar into the real world.
- **Supported Devices**: Android Phones (Chrome), Meta Quest, Vision Pro.
- **Usage**: Load a VRM, open **Mocap**, then tap **Start Face AR**. Allow front-camera access when Safari asks.
- **How it works**: The browser uses MediaPipe facial landmarks to drive and composite the VRM head over the live front-camera view.
- **iPhone note**: This is a browser-based Face AR experience. Safari does not expose native ARKit face anchors or immersive WebXR AR to web apps.
- **Function**: The background becomes your camera feed, and the avatar stands on your floor/desk.

---

## 🛠️ How to Use

### Setup
1. **Lighting**: Ensure your face is well-lit. Avoid strong backlighting.
2. **Camera Position**: Place camera at eye level.
3. **Distance**: Stand/sit where your head and shoulders are clearly visible.

### Modes
- **Full Body**: Tracks body + face + fingers. Best for full performance.
- **Face Only**: Tracks face/head rotation. Body plays idle animation (e.g., "Sunset Call").
- **AR Mode**: (New) Projects avatar into your room. Requires HTTPS and a compatible device.

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
