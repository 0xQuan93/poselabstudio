import * as THREE from 'three';
import { sceneManager } from '../three/sceneManager';

export interface FaceMaskDebugFrame {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    depth: number;
    frustumWidth: number;
    frustumHeight: number;
}

export interface FaceMaskCoverTransform {
    repeatX: number;
    repeatY: number;
    offsetX: number;
    offsetY: number;
}

export class FaceMaskCompositor {
    private readonly videoElement: HTMLVideoElement;
    private videoPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
    private videoTexture: THREE.VideoTexture | null = null;
    private videoWidth = 0;
    private videoHeight = 0;
    private debugGroup: THREE.Group | null = null;
    private debugAnchor: THREE.Mesh | null = null;
    private debugBox: THREE.LineLoop | null = null;
    private debugCropLine: THREE.Line | null = null;
    private mirrorX = true;

    constructor(videoElement: HTMLVideoElement) {
        this.videoElement = videoElement;
    }

    setMirrorX(enabled: boolean) {
        this.mirrorX = enabled;
    }

    ensureBackdrop() {
        if (this.videoPlane) return;
        const scene = sceneManager.getScene();
        if (!scene) return;

        this.videoTexture = new THREE.VideoTexture(this.videoElement);
        this.videoTexture.colorSpace = THREE.SRGBColorSpace;
        this.videoTexture.minFilter = THREE.LinearFilter;
        this.videoTexture.magFilter = THREE.LinearFilter;
        this.videoTexture.generateMipmaps = false;

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({
            map: this.videoTexture,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
        });

        this.videoPlane = new THREE.Mesh(geometry, material);
        this.videoPlane.name = 'XR_Face_Mask_Webcam_Backdrop';
        this.videoPlane.renderOrder = -10000;
        scene.add(this.videoPlane);
    }

    disposeBackdrop() {
        if (this.videoPlane) {
            this.videoPlane.removeFromParent();
            this.videoPlane.geometry.dispose();
            this.videoPlane.material.dispose();
            this.videoPlane = null;
        }
        this.videoTexture?.dispose();
        this.videoTexture = null;
        this.videoWidth = 0;
        this.videoHeight = 0;
    }

    getCoverTransform(planeAspect: number): FaceMaskCoverTransform {
        const videoWidth = this.videoElement.videoWidth || 0;
        const videoHeight = this.videoElement.videoHeight || 0;
        if (videoWidth <= 0 || videoHeight <= 0 || planeAspect <= 0) {
            return { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 };
        }

        const videoAspect = videoWidth / videoHeight;
        let repeatX = 1;
        let repeatY = 1;
        let offsetX = 0;
        let offsetY = 0;

        if (videoAspect > planeAspect) {
            repeatX = planeAspect / videoAspect;
            offsetX = (1 - repeatX) * 0.5;
        } else {
            repeatY = videoAspect / planeAspect;
            offsetY = (1 - repeatY) * 0.5;
        }

        return { repeatX, repeatY, offsetX, offsetY };
    }

    mapVideoPoint(x: number, y: number, planeAspect: number) {
        const { repeatX, repeatY, offsetX, offsetY } = this.getCoverTransform(planeAspect);
        const coveredX = THREE.MathUtils.clamp((x - offsetX) / repeatX, 0, 1);
        const coveredY = THREE.MathUtils.clamp((y - offsetY) / repeatY, 0, 1);
        return {
            x: this.mirrorX ? 1 - coveredX : coveredX,
            y: coveredY,
        };
    }

    updateBackdrop(maskDepth: number, backset: number) {
        if (!this.videoPlane) return;
        const camera = sceneManager.getCamera();
        if (!camera) return;

        const distance = Math.max(maskDepth + Math.max(0, backset) + 0.75, 2.5);
        const fov = THREE.MathUtils.degToRad(camera.fov);
        const height = 2 * Math.tan(fov / 2) * distance;
        const width = height * camera.aspect;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

        this.videoPlane.position.copy(camera.position).addScaledVector(forward, distance);
        this.videoPlane.quaternion.copy(camera.quaternion);
        this.videoPlane.scale.set(this.mirrorX ? -width : width, height, 1);
        this.updateVideoCover(width, height);
    }

    ensureDebugOverlay() {
        if (this.debugGroup) return;
        const scene = sceneManager.getScene();
        if (!scene) return;

        const group = new THREE.Group();
        group.name = 'XR_Face_Mask_Debug_Overlay';
        group.renderOrder = 20000;

        const anchorMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffd6,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        this.debugAnchor = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 8), anchorMaterial);
        this.debugAnchor.name = 'XR_Face_Mask_Debug_Anchor';
        this.debugAnchor.renderOrder = 20001;
        group.add(this.debugAnchor);

        const boxMaterial = new THREE.LineBasicMaterial({
            color: 0x00ffd6,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        this.debugBox = new THREE.LineLoop(new THREE.BufferGeometry(), boxMaterial);
        this.debugBox.name = 'XR_Face_Mask_Debug_Face_Bounds';
        this.debugBox.renderOrder = 20001;
        group.add(this.debugBox);

        const cropMaterial = new THREE.LineBasicMaterial({
            color: 0xffd166,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        this.debugCropLine = new THREE.Line(new THREE.BufferGeometry(), cropMaterial);
        this.debugCropLine.name = 'XR_Face_Mask_Debug_Neck_Crop';
        this.debugCropLine.renderOrder = 20002;
        group.add(this.debugCropLine);

        this.debugGroup = group;
        scene.add(group);
    }

    disposeDebugOverlay() {
        if (!this.debugGroup) return;
        this.debugGroup.traverse((object) => {
            const mesh = object as THREE.Mesh | THREE.Line;
            const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
            const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
            geometry?.dispose();
            if (Array.isArray(material)) {
                material.forEach((entry) => entry.dispose());
            } else {
                material?.dispose();
            }
        });
        this.debugGroup.removeFromParent();
        this.debugGroup = null;
        this.debugAnchor = null;
        this.debugBox = null;
        this.debugCropLine = null;
    }

    updateDebugOverlay(
        frame: FaceMaskDebugFrame | null,
        targetHeadWorld: THREE.Vector3,
        currentHeadWorld: THREE.Vector3,
        clipPlane: THREE.Plane,
    ) {
        if (!frame) return;
        this.ensureDebugOverlay();
        if (!this.debugGroup || !this.debugAnchor || !this.debugBox || !this.debugCropLine) return;

        const camera = sceneManager.getCamera();
        if (!camera) return;

        this.debugAnchor.position.copy(targetHeadWorld);
        const corners = [
            this.projectDebugPoint(camera, frame.minX, frame.minY, frame.depth, frame.frustumWidth, frame.frustumHeight),
            this.projectDebugPoint(camera, frame.maxX, frame.minY, frame.depth, frame.frustumWidth, frame.frustumHeight),
            this.projectDebugPoint(camera, frame.maxX, frame.maxY, frame.depth, frame.frustumWidth, frame.frustumHeight),
            this.projectDebugPoint(camera, frame.minX, frame.maxY, frame.depth, frame.frustumWidth, frame.frustumHeight),
        ];
        this.debugBox.geometry.dispose();
        this.debugBox.geometry = new THREE.BufferGeometry().setFromPoints(corners);

        const lineWidth = Math.max(0.35, frame.frustumWidth * 0.18);
        const cropY = -clipPlane.constant;
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        const cropLeft = currentHeadWorld.clone().addScaledVector(cameraRight, -lineWidth);
        const cropRight = currentHeadWorld.clone().addScaledVector(cameraRight, lineWidth);
        cropLeft.y = cropY;
        cropRight.y = cropY;
        this.debugCropLine.geometry.dispose();
        this.debugCropLine.geometry = new THREE.BufferGeometry().setFromPoints([cropLeft, cropRight]);
    }

    dispose() {
        this.disposeBackdrop();
        this.disposeDebugOverlay();
    }

    private updateVideoCover(planeWidth: number, planeHeight: number) {
        if (!this.videoTexture || planeWidth <= 0 || planeHeight <= 0) return;

        const videoWidth = this.videoElement.videoWidth || 0;
        const videoHeight = this.videoElement.videoHeight || 0;
        if (videoWidth <= 0 || videoHeight <= 0) return;

        const { repeatX, repeatY, offsetX, offsetY } = this.getCoverTransform(planeWidth / planeHeight);
        this.videoTexture.repeat.set(repeatX, repeatY);
        this.videoTexture.offset.set(offsetX, offsetY);

        if (videoWidth !== this.videoWidth || videoHeight !== this.videoHeight) {
            this.videoWidth = videoWidth;
            this.videoHeight = videoHeight;
            this.videoTexture.needsUpdate = true;
        }
    }

    private projectDebugPoint(
        camera: THREE.PerspectiveCamera,
        x: number,
        y: number,
        depth: number,
        frustumWidth: number,
        frustumHeight: number,
    ) {
        const ndcX = (x * 2) - 1;
        const ndcY = 1 - (y * 2);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

        return new THREE.Vector3()
            .copy(camera.position)
            .addScaledVector(forward, depth)
            .addScaledVector(right, ndcX * frustumWidth * 0.5)
            .addScaledVector(up, ndcY * frustumHeight * 0.5);
    }
}
