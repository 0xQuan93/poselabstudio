# PoseLab ARKit Face Bridge (optional)

Local-only iPhone companion that streams **ARKit TrueDepth** face blendshapes into PoseLab. This is the native path Safari cannot provide.

**Off by default.** No cloud upload. MIT, same as PoseLab.

This **supersedes** draft PR #21 (`wsBridge` / pose-lab orchestration). That bridge was a generic avatar control plane, not ARKit face tracking, and is not required for VTubing.

## Why a native app?

| Path | iPhone Safari | This companion |
| --- | --- | --- |
| WebXR `immersive-ar` | No | Not used |
| ARKit 52 blendshapes | No | Yes (`ARFaceTrackingConfiguration`) |
| Head pose | MediaPipe estimate | `ARFaceAnchor.transform` |
| Data leaving the device | Camera stays in-page | LAN WebSocket only |

## Enable in PoseLab

1. In a local `.env`:

```env
VITE_ENABLE_ARKIT_FACE_BRIDGE=true
```

2. Restart `npm run dev`.
3. Vite binds a LAN hub at `0.0.0.0:49122` and **rejects non-private peers**.
4. Open Mocap → **ARKit companion (LAN)** and connect to `ws://127.0.0.1:49122`.

The browser never accepts a public WebSocket host. See `src/utils/lanWebSocket.ts`.

## iPhone app

Xcode project scaffolding lives in `companion/ios/PoseLabFaceBridge/`. Create a new iOS App target, add the Swift files, then:

**Capabilities / Info**

- `NSCameraUsageDescription` — Face tracking for a local PoseLab avatar.
- `NSLocalNetworkUsageDescription` — Send blendshapes to PoseLab on your LAN.
- Signing: your personal team. TrueDepth requires a real iPhone (not Simulator).

**Run**

1. Phone and computer on the same Wi-Fi (not a guest/client-isolation network).
2. Enter the computer's LAN IP (the machine running Vite).
3. Port `49122`.
4. Tap **Start Face Tracking**. Allow camera + local network.
5. In PoseLab, connect the companion. The capability ladder should show **Native ARKit companion** as active.

Frames are JSON:

```json
{
  "type": "arkit-face-frame",
  "v": 1,
  "t": 1730000000000,
  "blendshapes": { "jawOpen": 0.42, "eyeBlinkLeft": 0.01 },
  "head": { "x": 0, "y": 0, "z": 0, "w": 1 }
}
```

PoseLab maps those names through the VRCFaceTracking ARKit table onto the loaded VRM.

## What needs a real iPhone

- ARKit Face Tracking / TrueDepth hardware
- Camera + Local Network permission prompts
- LAN connectivity to the Vite hub (or a direct `ws://iphone-ip:49122` if you host on-device)
- Confirming that 52 coefficients animate the VRM without leaving the LAN

Simulator, desktop Chrome, and iOS Safari **cannot** certify this path.
