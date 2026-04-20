import { MotionCaptureManager } from './motionCapture';

let _mocapManager: MotionCaptureManager | null = null;
let _videoElement: HTMLVideoElement | null = null;

export const initMocapManager = (): MotionCaptureManager => {
    if (_mocapManager) return _mocapManager;

    if (!_videoElement) {
        _videoElement = document.createElement('video');
        _videoElement.id = 'global-mocap-video';
        _videoElement.style.display = 'none';
        _videoElement.muted = true;
        _videoElement.playsInline = true;
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
