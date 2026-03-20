import * as THREE from 'three';
import { sceneManager } from './sceneManager';
import { avatarManager } from './avatarManager';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * VR Manager
 * 
 * Handles WebXR sessions, corrected VRIK mapping, and in-VR photo review.
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
  
  // VR Review Window
  private reviewPlane: THREE.Mesh | null = null;
  private lastSnapshotUrl: string | null = null;

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
      // Use a lower priority (-10) so VR bone mapping overrides animations and manual posing
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
      controller.addEventListener('selectstart', () => {
        if (this.reviewPlane && this.reviewPlane.visible) {
            this.handleReviewInteraction(i);
        } else {
            this.onTriggerPressed(i);
        }
      });
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

    const head = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, 1);
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    
    if (headNode) {
      headNode.getWorldPosition(head);
    } else {
      vrm.scene.getWorldPosition(head);
      head.y += 1.6;
    }
    
    vrm.scene.getWorldDirection(forward);
    // Point camera at head from 2.0m away, slightly elevated
    this.snapshotCamera.position.copy(head).add(forward.clone().multiplyScalar(2.0)).add(new THREE.Vector3(0, 0.2, 0));
    this.snapshotCamera.lookAt(head);

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
            this.lastSnapshotUrl = dataUrl;
            this.showVRReview(dataUrl);
            console.log('[VRManager] Avatar snapshot captured for review');
          }
          this.snapshotCamera.layers.mask = originalMask;
        });
    }, 100);
  }

  /**
   * Show a 3D preview of the photo inside VR
   */
  private showVRReview(dataUrl: string) {
    const scene = sceneManager.getScene();
    const camera = sceneManager.getCamera();
    if (!scene || !camera) return;

    // Remove existing review plane
    if (this.reviewPlane) {
      scene.remove(this.reviewPlane);
    }

    const loader = new THREE.TextureLoader();
    loader.load(dataUrl, (texture) => {
      const geometry = new THREE.PlaneGeometry(0.8, 0.45); // 16:9 aspect
      const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
      this.reviewPlane = new THREE.Mesh(geometry, material);

      // Position in front of camera
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(camera.quaternion);
      
      this.reviewPlane.position.copy(camera.position).add(forward.multiplyScalar(1.2));
      this.reviewPlane.lookAt(camera.position);
      this.reviewPlane.name = 'VR_Review_Window';
      
      scene.add(this.reviewPlane);
    });
  }

  private handleReviewInteraction(index: number) {
    if (!this.reviewPlane || !this.lastSnapshotUrl) return;

    // For now, left trigger = Cancel, right trigger = Save
    if (index === 0) {
        console.log('[VRManager] Review Cancelled');
        this.hideReview();
    } else {
        console.log('[VRManager] Review Saved');
        this.saveLastSnapshot();
        this.hideReview();
    }
  }

  private hideReview() {
    if (this.reviewPlane) {
      this.reviewPlane.visible = false;
      const scene = sceneManager.getScene();
      if (scene) scene.remove(this.reviewPlane);
    }
  }

  private saveLastSnapshot() {
    if (!this.lastSnapshotUrl) return;
    const link = document.createElement('a');
    link.href = this.lastSnapshotUrl;
    link.download = `poselab_avatar_snapshot_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  private update = () => {
    if (!this.session) return;

    const vrm = avatarManager.getVRM();
    if (!vrm) return;

    const camera = sceneManager.getCamera();
    if (!camera) return;

    // 1. Root Positioning
    // In local-floor, camera (0,0,0) is physical floor center.
    // We don't move the vrm.scene because the user might have positioned it.
    // Instead we calculate relative offsets for bones.

    // 2. Head Mapping (Corrected for VRM 180 coordinate system)
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (headNode && this.firstPersonMode) {
      const camWorldQuat = new THREE.Quaternion();
      camera.getWorldQuaternion(camWorldQuat);

      // VRM models face -Z by default, but PoseLab often rotates the scene 180 (facing +Z)
      // We need to ensure the head follows the headset correctly relative to the body.
      const invSceneQuat = vrm.scene.quaternion.clone().invert();
      const localQuat = camWorldQuat.clone().premultiply(invSceneQuat);
      
      // Apply to head
      headNode.quaternion.copy(localQuat);
    }

    // 3. Hand Mapping (Corrected Position & Orientation)
    this.controllers.forEach((controller, index) => {
      if (!controller.visible) return;
      
      const handBoneName = index === 0 ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;
      const handNode = vrm.humanoid?.getNormalizedBoneNode(handBoneName);
      
      if (handNode) {
        const ctrlWorldPos = new THREE.Vector3();
        const ctrlWorldQuat = new THREE.Quaternion();
        controller.getWorldPosition(ctrlWorldPos);
        controller.getWorldQuaternion(ctrlWorldQuat);

        // Convert world position to avatar-local position
        const localPos = ctrlWorldPos.clone();
        vrm.scene.worldToLocal(localPos);
        handNode.position.copy(localPos);

        // Convert world rotation to avatar-local rotation
        const invSceneQuat = vrm.scene.quaternion.clone().invert();
        const localQuat = ctrlWorldQuat.clone().premultiply(invSceneQuat);
        
        // Correcting for the fact that VRM hand bones often have a 90-degree offset 
        // compared to VR controller "forward".
        const correction = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index === 0 ? Math.PI/2 : -Math.PI/2, 0));
        localQuat.multiply(correction);
        
        handNode.quaternion.copy(localQuat);
      }
    });

    // 4. Mesh Hiding
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
    
    this.hideReview();

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
