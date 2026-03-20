import * as THREE from 'three';
import { sceneManager } from './sceneManager';
import { avatarManager } from './avatarManager';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * VR Manager
 * 
 * Handles WebXR sessions, VRIK-style bone mapping, and controller interactions.
 */
class VRManager {
  private session: XRSession | null = null;
  private isVRSupported: boolean = false;
  private renderer: THREE.WebGLRenderer | null = null;
  private controllers: THREE.Group[] = [];
  private controllerGrips: THREE.Group[] = [];
  private firstPersonMode: boolean = true;
  private cameraGroup = new THREE.Group();
  private originalCameraParent: THREE.Object3D | null = null;
  private headMeshes: THREE.Mesh[] = [];
  private currentVrm: any = null;

  // Snapshot Camera for VR
  private snapshotCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);

  constructor() {
    this.checkSupport();
    this.cameraGroup.name = 'VR_Camera_Group';
  }

  private async checkSupport() {
    if (navigator.xr) {
      this.isVRSupported = await navigator.xr.isSessionSupported('immersive-vr');
    }
  }

  public async enterVR() {
    if (!this.isVRSupported || !navigator.xr) {
      throw new Error('VR is not supported on this device/browser');
    }

    this.renderer = (sceneManager.getRenderer() as THREE.WebGLRenderer) || null;
    const scene = sceneManager.getScene();
    const camera = sceneManager.getCamera();
    
    if (!this.renderer || !scene || !camera) {
      throw new Error('Three.js elements not initialized');
    }

    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(1.0);

    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['bounded-floor', 'hand-tracking', 'layers']
      });

      this.session = session;
      this.renderer.xr.enabled = true;
      this.renderer.xr.setSession(session);
      
      scene.add(this.cameraGroup);
      this.originalCameraParent = camera.parent;
      this.cameraGroup.add(camera);
      
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);

      this.setupControllers();

      session.addEventListener('end', () => this.onSessionEnded());
      // Use a lower priority (-10) so VR bone mapping overrides animations
      sceneManager.registerTick(this.update, -10);

      console.log('[VRManager] VR Session started');
    } catch (error) {
      console.error('[VRManager] Failed to enter VR:', error);
      throw error;
    }
  }

  private setupControllers() {
    if (!this.renderer) return;
    const scene = sceneManager.getScene();
    if (!scene) return;

    const controllerModelFactory = new XRControllerModelFactory();

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.addEventListener('selectstart', () => this.onTriggerPressed(i));
      scene.add(controller);
      this.controllers.push(controller);

      const grip = this.renderer.xr.getControllerGrip(i);
      const model = controllerModelFactory.createControllerModel(grip);
      grip.add(model);
      scene.add(grip);
      this.controllerGrips.push(grip);
    }
  }

  private onTriggerPressed(index: number) {
    console.log(`[VRManager] Controller ${index} trigger pressed - Taking avatar snapshot`);
    
    const vrm = avatarManager.getVRM();
    if (!vrm) return;

    // Position snapshot camera in front of avatar
    const head = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, 1);
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    
    if (headNode) {
      headNode.getWorldPosition(head);
    } else {
      vrm.scene.getWorldPosition(head);
      head.y += 1.6;
    }
    
    // Character's forward direction
    vrm.scene.getWorldDirection(forward);
    // Point camera at head from 2.0m away, slightly elevated
    this.snapshotCamera.position.copy(head).add(forward.clone().multiplyScalar(2.0)).add(new THREE.Vector3(0, 0.2, 0));
    this.snapshotCamera.lookAt(head);

    // Temporarily show all layers for the snapshot camera
    const originalMask = this.snapshotCamera.layers.mask;
    this.snapshotCamera.layers.enableAll();

    setTimeout(() => {
        sceneManager.captureSnapshot({ 
          includeLogo: true,
          width: 1920,
          height: 1080,
          camera: this.snapshotCamera
        }).then(dataUrl => {
          if (dataUrl) {
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `poselab_avatar_snapshot_${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log('[VRManager] Avatar snapshot saved');
          }
          // Restore mask (though snapshot call uses a clone usually, better safe)
          this.snapshotCamera.layers.mask = originalMask;
        });
    }, 100);
  }

  private update = () => {
    if (!this.session) return;

    const vrm = avatarManager.getVRM();
    if (!vrm) return;

    const camera = sceneManager.getCamera();
    if (!camera) return;

    // 1. Position the avatar to match the VR session floor
    // We keep the avatar at its current scene position, but sync bones
    
    // 2. Head Mapping (HMD to Head Bone)
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (headNode && this.firstPersonMode) {
      // Get camera position/rotation in world space
      const camWorldPos = new THREE.Vector3();
      const camWorldQuat = new THREE.Quaternion();
      camera.getWorldPosition(camWorldPos);
      camera.getWorldQuaternion(camWorldQuat);

      // Map rotation to head bone
      // We need to account for VRM's 180 coordinate system
      headNode.quaternion.copy(camWorldQuat);
      // Adjust for avatar scene rotation if any
      const invSceneQuat = vrm.scene.quaternion.clone().invert();
      headNode.quaternion.premultiply(invSceneQuat);
    }

    // 3. Hand Mapping (Controllers to Hand Bones)
    this.controllers.forEach((controller, index) => {
      if (!controller.visible) return;
      
      const handBoneName = index === 0 ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;
      const handNode = vrm.humanoid?.getNormalizedBoneNode(handBoneName);
      
      if (handNode) {
        const ctrlWorldPos = new THREE.Vector3();
        const ctrlWorldQuat = new THREE.Quaternion();
        controller.getWorldPosition(ctrlWorldPos);
        controller.getWorldQuaternion(ctrlWorldQuat);

        // Position hand node (local to avatar)
        const localHandPos = ctrlWorldPos.clone();
        vrm.scene.worldToLocal(localHandPos);
        handNode.position.copy(localHandPos);

        // Rotate hand node
        const localHandQuat = ctrlWorldQuat.clone();
        const invSceneQuat = vrm.scene.quaternion.clone().invert();
        localHandQuat.premultiply(invSceneQuat);
        handNode.quaternion.copy(localHandQuat);
      }
    });

    // 4. First-person mesh hiding
    if (this.firstPersonMode) {
      if (this.currentVrm !== vrm) {
        this.currentVrm = vrm;
        this.headMeshes = [];
        vrm.scene.traverse((obj: THREE.Object3D) => {
          if (obj instanceof THREE.Mesh) {
            const name = obj.name.toLowerCase();
            if (name.includes('head') || name.includes('face') || name.includes('hair') || 
                name.includes('eye') || name.includes('mouth') || name.includes('brow') ||
                name.includes('ear') || name.includes('tooth') || name.includes('tongue')) {
              this.headMeshes.push(obj);
            }
          }
        });
      }

      const VR_INVISIBLE_LAYER = 10;
      camera.layers.enable(0); 
      camera.layers.disable(VR_INVISIBLE_LAYER);
      this.headMeshes.forEach(mesh => mesh.layers.set(VR_INVISIBLE_LAYER));
    }
  };

  private onSessionEnded() {
    const camera = sceneManager.getCamera();
    const scene = sceneManager.getScene();
    
    if (camera && this.originalCameraParent) {
      this.originalCameraParent.add(camera);
    } else if (camera && scene) {
      scene.add(camera);
    }

    if (scene && this.cameraGroup) {
      scene.remove(this.cameraGroup);
    }

    this.session = null;
    this.controllers = [];
    this.controllerGrips = [];
    console.log('[VRManager] VR Session ended');
  }

  public async exitVR() {
    if (this.session) {
      await this.session.end();
    }
  }

  public isSupported(): boolean {
    return this.isVRSupported;
  }

  public isInVR(): boolean {
    return this.session !== null;
  }

  public setFirstPerson(enabled: boolean) {
    this.firstPersonMode = enabled;
  }
}

export const vrManager = new VRManager();
