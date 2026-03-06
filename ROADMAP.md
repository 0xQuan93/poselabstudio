# 🗺️ PoseLab Roadmap

This document outlines the planned upgrades and feature requests for PoseLab, focusing on making the tool more robust, professional, and versatile for the VRM community. Priorities are reviewed as features ship and user workflows evolve.

---

## ✅ Shipped Milestones (v1.7)

### 🎞️ Animated Backgrounds (GIF & Video Support)
**Goal:** Allow users to upload animated content for backgrounds to create dynamic scenes.
- [x] **Video Support (.mp4, .webm):** Implement `THREE.VideoTexture` to handle video files natively.
- [x] **GIF Support (.gif):** Integrate a GIF decoder to support animated GIF textures.
- [x] **Export Logic:** Ensure `MediaRecorder` captures the animated background.

### 🎬 Timeline & Keyframing (Basic)
**Goal:** Move beyond static poses and simple loops to custom sequences.
- [x] **Keyframe Editor:** A simple timeline interface to set poses at specific timestamps.
- [x] **Interpolation Control:** Basic Linear interpolation between poses.
- [x] **Sequence Export:** Export the full timeline as a `.json` animation clip or `.webm` video.
- [x] **Documentation:** A comprehensive guide to the timeline feature is available in [TIMELINE-GUIDE.md](docs/TIMELINE-GUIDE.md).

### 🕹️ Advanced IK Controls
**Goal:** Provide more precise control over limbs without relying solely on presets.
- [x] **Transform Gizmos:** Interactive Translate/Rotate gizmos attached to hands, feet, and hips.
- [x] **Context-Aware:** Click bones to select, click background to deselect.
- [x] **Rotation Mode:** Local/World space toggle.

### 📤 Advanced Export & Interop
**Goal:** Ensure assets created in PoseLab can be used in other tools (Blender, Unity).
- [x] **GLB Export:** Export the VRM with baked animation data as a standard `.glb` file.
- [x] **Asset Packs:** Shareable JSON libraries of custom poses.
- [x] **Video Hardening:** Codec detection (VP9/VP8) for reliable WebM export.

### 📸 Webcam Motion Capture
**Goal:** Real-time pose tracking using MediaPipe.
- [x] **Webcam Input:** Integrated MediaPipe Holistic.
- [x] **Real-time Retargeting:** Map MediaPipe landmarks to VRM humanoid bones.
- [x] **Recording:** Capture motion sessions to `AnimationClip` for playback/export.
- [x] **Calibration:** T-Pose calibration for accurate retargeting.
- [x] **Professional Smoothing:** Implemented **OneEuroFilter** (same as SystemAnimatorOnline) for jitter-free, low-latency tracking.

### 💾 Project Persistence (v1.7)
**Goal:** Allow users to save their entire workspace state.
- [x] **Project Files (.pose):** Save a JSON file containing the Avatar (ref), Scene Settings, Background, Timeline, and Presets.
- [x] **Load/Save:** UI integration via Command Palette and Header.
- [x] **Autosave & State Recovery:** Automatic saving of project state and recovery after unexpected closures.

### ⌨️ Productivity Tools
**Goal:** Speed up power user workflows.
- [x] **Command Palette:** `Cmd+K` interface for instant tool access.
- [x] **Toast Notifications:** Accessible status updates.

### 🖼️ Live2D Support (v1.5)
**Goal:** Expand avatar support beyond 3D VRM to include 2D Cubism models.
- [x] **PixiJS Integration:** Integrated PixiJS v7 and `pixi-live2d-display`.
- [x] **Cubism Core:** Runtime loading of Cubism 4 SDK.
- [x] **Hybrid Rendering:** Transparent overlay allowing 2D avatars on 3D backgrounds.
- [x] **Expressions/Physics:** Basic support for model settings.

---

## 🔥 Now (v1.7 - Highest Priority)

### 1. 🎥 Director Mode
**Goal:** Enable powerful cinematic camera control and AI-driven scene direction.
- [x] **AI Script Generation**: Generate complex camera movements and scene compositions from text prompts.
- [x] **Timeline-based Control**: Fine-tune camera paths, shot duration, and transitions within a dedicated timeline.
- [x] **Integrated Export**: Render director-guided sequences directly to video.

### 2. 📺 Live Streaming & Capture
**Goal:** Ship a creator-ready streaming pipeline.
- [x] **Virtual Camera Output:** Facilitated via "Stream Mode" (Clean UI + Transparent Background) for OBS Browser Source.
- [x] **Virtual Camera Input:** Select specific camera device (e.g. OBS Virtual Camera) for mocap input.
- [x] **Audio Sync:** Optionally capture mic audio with the render stream.

### 2. ♾️ Evergreen Utility
**Goal:** Make PoseLab a daily driver for creators.
- [x] **Preset Library Sync:** Save/share presets between devices.
- [x] **Batch Exporting:** Queue multiple poses/animations for overnight renders.
- [x] **Quickshot Templates:** Reusable layout presets for shorts, thumbnails, and panels.

### 3. 🧩 Workflow Reliability
**Goal:** Reduce friction in production workflows.
- [x] **State Recovery:** Autosave projects and recover after crashes.
- [x] **Asset Validation:** Detect missing textures, Mixamo mismatches, and invalid files.
- [x] **Performance Budgeting:** Clear warnings when scenes exceed real-time constraints.

---

## 🥽 XR & AR Integration (v1.8)
**Goal:** Merge the virtual and physical worlds by overlaying avatars onto the real world via webcam and WebXR.

### 🎭 Face Overlay (Snapchat Style)
- [ ] **Background Passthrough:** Render webcam feed as `scene.background` using `THREE.VideoTexture`.
- [ ] **Head-Only Mode:** Logic to hide avatar body meshes while keeping the head/neck and hair active for a seamless "face swap" effect.
- [ ] **3D Spatial Alignment:** Project 2D MediaPipe face landmarks into 3D Three.js space with distance estimation for accurate anchoring.

### 🧍 Full-Body AR Overlay
- [ ] **Root Anchoring:** Anchor avatar hips to the projected 3D position of the user's pelvis for "magic mirror" style tracking.
- [ ] **Ground Plane Shadows:** Implement a transparent shadow catcher plane to visually ground the avatar in the real-world environment.
- [ ] **WebXR Immersive-AR:** Leverage native browser AR (ARCore/ARKit) for stable floor tracking, hit testing, and real-world occlusion on supported mobile devices.

---

## 💎 Next (v1.4 - Medium Priority)

### 🔐 IP Protection & Gating
**Goal:** Allow creators to own and monetize their work.
- [ ] **Token Gating:** Logic to lock/unlock JSON exports based on subscription/token status.
- [ ] **License Management:** Embed license data into exported files (Public/Private/Commercial).

### 🏪 Creator Marketplace
**Goal:** A platform for users to share and sell poses.
- [ ] **Database Integration:** User profiles, and asset registry.
- [ ] **Auto-Marketplace:** Default flow for free users (uploads to public pool).
- [ ] **Creator Pages:** Personalized storefronts for Premium users.

---

## ✅ Shipped - Rendering & Visual Quality (v1.6)
**Goal:** Professional rendering quality and style options.
- [x] **Advanced Lighting:** 3-point lighting controls (Key, Fill, Rim) with presets.
- [x] **HDRI Support:** Upload `.hdr`/`.exr` environment maps with curated presets.
- [x] **Post-Processing:** Bloom, Color Grading, Vignette, Film Grain with cinematic presets.
- [x] **Toon Shader Settings:** Customize outlines, rim lighting, and emissive glow (MToon VRMs only).
- [x] **3D GLB Environments:** Load 3D environments in GLB format with position, rotation, and scale controls.

### 👥 Multi-Avatar Composition
**Goal:** Create interactions between multiple characters.
- [ ] **Multiple Loaders:** Support loading and managing multiple VRM models in one scene.
- [ ] **Interaction Poses:** Presets designed for two actors (e.g., high-five, hug, battle).
- [ ] **Scene Graph:** Simple list to select active character.

### 🦾 IK Solver Upgrade
**Goal:** Better biomechanical constraints.
- [ ] **Full Body IK:** Drag a hand and have the arm/shoulder follow naturally (CCD or FABRIK).
- [ ] **Floor Constraints:** Keep feet planted on the ground.

---

## 🔮 Long-Term Vision (v2.0+)

### 11. 🤖 AI Motion Director
**Goal:** Expand Gemini integration for full motion synthesis.
- [ ] **Text-to-Animation:** "Make the avatar dance excitedly for 10 seconds."
- [ ] **Motion Style Transfer:** Apply the "mood" of a text prompt to an existing animation.

### 12. 📦 Cloud Asset Library
**Goal:** Direct access to shared assets.
- [ ] **VRoid Hub Integration:** Direct import of avatars.
- [ ] **Sketchfab Integration:** Import props and environments.

---

## 📝 Feature Tracker

| Feature | Status | Priority |
|---------|--------|----------|
| **Core v1.0** | ✅ Done | - |
| **Motion Capture (Basic + Recording)** | ✅ Done (v1.2) | High |
| **Project Save/Load** | ✅ Done (v1.2) | High |
| **Command Palette** | ✅ Done (v1.2) | High |
| **Video Export Hardening** | ✅ Done (v1.2) | High |
| **Live2D Support** | ✅ Done (v1.3) | High |
| **Advanced Lighting** | ✅ Done (v1.4) | Medium |
| **HDRI Environments** | ✅ Done (v1.4) | Medium |
| **Post-Processing** | ✅ Done (v1.4) | Medium |
| **Toon Shader Customization** | ✅ Done (v1.4) | Medium |
| **3D GLB Environments** | ✅ Done (v1.5) | Medium |
| **Multiplayer Co-op** | ✅ Done (v1.5) | High |
| **Voice Chat** | ✅ Done (v1.5) | High |
| **Live Streaming & Virtual Camera** | ✅ Done (v1.7) | **Critical** |
| **Face Overlay (AR)** | 🚧 Planned (v1.8) | **High** |
| **Full-Body AR** | 🚧 Planned (v1.8) | **High** |
| **Evergreen Utility (Batch Export/Templates)** | 🚧 Planned | **High** |
| **State Recovery & Validation** | 🚧 Planned | **High** |
| **Monetization / Gating** | 🚧 Planned | Medium |
| **Creator Marketplace** | 🚧 Planned | Medium |
| **Full Body IK** | 🚧 Planned | Medium |
| **Multi-Avatar** | 🚧 Planned | Medium |
