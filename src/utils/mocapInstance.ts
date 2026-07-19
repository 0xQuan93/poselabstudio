import { MotionCaptureManager } from './motionCapture';

let _mocapManager: MotionCaptureManager | null = null;
let _videoElement: HTMLVideoElement | null = null;

export const initMocapManager = (): MotionCaptureManager => {
    if (_mocapManager) return _mocapManager;

    if (!_videoElement) {
        _videoElement = document.createElement('video');
        _videoElement.id = 'global-mocap-video';
        // Keep the source video rendered (rather than display:none). WebKit can
        // throttle or stop a hidden MediaStream video, which in turn freezes the
        // VideoTexture and facial tracking even though the camera permission is
        // still active. A one-pixel near-transparent element remains playback-capable
        // without appearing in the UI.
        _videoElement.style.position = 'fixed';
        _videoElement.style.left = '0';
        _videoElement.style.top = '0';
        _videoElement.style.width = '1px';
        _videoElement.style.height = '1px';
        // Leave an imperceptible on-screen pixel for WebKit's visibility
        // heuristics; a fully hidden/off-screen media element may be paused.
        _videoElement.style.opacity = '0.01';
        _videoElement.style.pointerEvents = 'none';
        _videoElement.style.zIndex = '2147483647';
        _videoElement.muted = true;
        _videoElement.defaultMuted = true;
        _videoElement.autoplay = true;
        _videoElement.playsInline = true;
        _videoElement.setAttribute('playsinline', '');
        // Retained for older iOS WebKit versions that only honor the prefixed
        // inline-playback attribute.
        _videoElement.setAttribute('webkit-playsinline', '');
        _videoElement.setAttribute('aria-hidden', 'true');
        document.body.appendChild(_videoElement);
    }

    _mocapManager = new MotionCaptureManager(_videoElement);
    return _mocapManager;
};

export const setMocapManager = (manager: MotionCaptureManager) => {
    _mocapManager = manager;
};

export const getMocapManager = (): MotionCaptureManager | null => {
    return _mocapManager;
};

export const getMocapVideo = (): HTMLVideoElement | null => {
    return _videoElement;
};
