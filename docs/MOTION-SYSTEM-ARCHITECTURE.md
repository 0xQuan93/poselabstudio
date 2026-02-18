# 🚀 Motion System Upgrade (v3.0)

**Date**: 2026-01-11
**Focus**: Robustness, Physics Parity, and AR

This document details the architectural overhaul of the Motion Capture system to match the capabilities of the open-source *SystemAnimatorOnline*.

---

## 1. The "Physics Rail" Architecture

### Problem
In v2.0, the webcam processing loop (`requestAnimationFrame` inside `motionCapture.ts`) ran independently of the Three.js render loop (`SceneManager`).
- **Result**: Physics (SpringBones) often updated *before* bones moved, or twice in a row, causing jitter/vibration in secondary motion (hair/clothes).

### Solution
We implemented a **Tick Registration Pattern**.
1. `SceneManager` exposes a `registerTick(callback)` method.
2. `MotionCaptureManager` registers itself as a tick handler.
3. `motionCapture` logic now runs **synchronously** within the render frame, just before physics calculation.

**Order of Operations:**
1. `SceneManager` Loop Start
2. `Controls` Update
3. `MotionCapture` Update (Bones set)
4. `AvatarManager` Update (Physics calculated based on new bone positions)
5. `Renderer` Draw

## 2. Adaptive Smoothing Engine

We replaced static spherical linear interpolation (SLERP) with an adaptive velocity-based approach.

| State | Velocity | Smoothing Factor (Lerp) | Effect |
| :--- | :--- | :--- | :--- |
| **Idle** | ~0 rad/s | 0.05 (Heavy) | Locks avatar in place. Removes "webcam breathing". |
| **Slow** | < 1 rad/s | 0.1 - 0.2 | Smooth, fluid motion. |
| **Fast** | > 4 rad/s | 0.4 (Light) | Instant response. No "rubbery" lag. |

**Code Implementation:**
```typescript
let adaptiveLerp = THREE.MathUtils.mapLinear(
    angleDifference, 
    0.01, // Near zero movement
    0.5,  // Fast movement
    SMOOTHING.MIN_LERP, 
    SMOOTHING.MAX_LERP
);
```

## 3. WebXR (Augmented Reality)

We added a `WebXRManager` to handle AR sessions.
- **Hit Test**: Detects real-world surfaces.
- **DOM Overlay**: Keeps UI visible on mobile AR.
- **Lighting Estimation**: (Optional) Matches virtual light to real room.

## 4. Stability Improvements

- **Framerate Independence**: All smoothing now uses `delta` time. 
  - *Previous*: 144hz monitor = faster smoothing than 60hz.
  - *Now*: Identical behavior on all framerates.
- **Eye Tuning**: Eyes have a separate, faster smoothing profile (`0.6`) to maintain liveliness while head remains stable.

---

## Future Roadmap (v3.1)
- **Multiplayer Sync**: Transmit compressed bone quaternions via LiveKit Data Channels.
- **Recording**: Export `vrm` animation clips directly from AR sessions.
