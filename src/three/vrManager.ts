import * as THREE from 'three';
import { sceneManager } from './sceneManager';
import { avatarManager } from './avatarManager';
import { animationManager } from './animationManager';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { useUserStore } from '../state/useUserStore';
import { useToastStore } from '../state/useToastStore';

/**
 * VR Manager
 * 
 * Handles WebXR sessions, corrected VRIK mapping, and in-VR photo review/sharing.
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

    // 1. COMPLETELY OVERRIDE ANIMATIONS
    avatarManager.setManualPosing(true);
    animationManager.stopAnimation(true, true); // Stop any active mixer and reset pose
    
    const vrm = avatarManager.getVRM();
    if (vrm) {
        vrm.humanoid?.resetPose();
        if (vrm.expressionManager) {
            vrm.expressionManager.expressions.forEach(e => vrm.expressionManager!.setValue(e.expressionName, 0));
        }
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
      
      // Setup Camera Group
      scene.add(this.cameraGroup);
      this.originalCameraParent = camera.parent;
      this.cameraGroup.add(camera);
      
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);

      // --- FIX BACKWARDS VIEW ---
      // Anchor physical space to avatar's feet
      if (vrm) {
        this.cameraGroup.position.copy(vrm.scene.position);
        
        // Align physical room 'forward' (-Z) with avatar 'forward' (+Z if rotated 180)
        const avatarRotY = vrm.scene.rotation.y;
        this.cameraGroup.rotation.y = avatarRotY;
      }

      this.setupControllers();

      session.addEventListener('end', () => this.onSessionEnded());
      // High priority to be the final word on bone state
      sceneManager.registerTick(this.update, -100);

      console.log('[VRManager] VR Session started - All systems hooked up');
    } catch (error) {
      console.error('[VRManager] Failed to enter VR:', error);
      avatarManager.setManualPosing(false);
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
    console.log(`[VRManager] Controller ${index} trigger pressed - Taking snapshot`);
    
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
          }
          this.snapshotCamera.layers.mask = originalMask;
        });
    }, 100);
  }

  private showVRReview(dataUrl: string) {
    const scene = sceneManager.getScene();
    const camera = sceneManager.getCamera();
    if (!scene || !camera) return;

    if (this.reviewPlane) {
      scene.remove(this.reviewPlane);
    }

    const loader = new THREE.TextureLoader();
    loader.load(dataUrl, (texture) => {
      const geometry = new THREE.PlaneGeometry(1.2, 0.675);
      const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true });
      this.reviewPlane = new THREE.Mesh(geometry, material);

      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(camera.quaternion);
      
      this.reviewPlane.position.copy(camera.position).add(forward.multiplyScalar(1.5));
      this.reviewPlane.lookAt(camera.position);
      this.reviewPlane.name = 'VR_Review_Window';
      
      scene.add(this.reviewPlane);
    });
  }

  private handleReviewInteraction(index: number) {
    if (!this.reviewPlane || !this.lastSnapshotUrl) return;

    if (index === 0) { // Left Hand = DISCARD
        console.log('[VRManager] Photo discarded');
        this.hideReview();
    } else { // Right Hand = SAVE & PUBLISH
        console.log('[VRManager] Photo saved & publishing...');
        this.saveLastSnapshot();
        this.publishToFeed();
        this.hideReview();
    }
  }

  private async publishToFeed() {
    const user = useUserStore.getState().user;
    if (!user || !this.lastSnapshotUrl) return;

    try {
      const currentLevel = Math.floor((user?.lp || 0) / 100) + 1;
      
      const response = await fetch('/.netlify/functions/publish-pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: this.lastSnapshotUrl,
          creatorName: user.username || 'VR Creator',
          creatorAvatarUrl: user.avatarUrl,
          creatorId: user.id,
          description: `Level ${currentLevel} VR Capture | #PoseLabVR`
        })
      });

      if (response.ok) {
        useToastStore.getState().addToast('Successfully published to Discord Studio!', 'success');
        useUserStore.getState().recordGamifiedAction('publish_daily');
      }
    } catch (e) {
      console.error('[VRManager] Failed to publish VR photo', e);
    }
  }

  private hideReview() {
    if (this.reviewPlane) {
      const scene = sceneManager.getScene();
      if (scene) scene.remove(this.reviewPlane);
      this.reviewPlane = null;
    }
  }

  private saveLastSnapshot() {
    if (!this.lastSnapshotUrl) return;
    const link = document.createElement('a');
    link.href = this.lastSnapshotUrl;
    link.download = `poselab_vr_snapshot_${Date.now()}.png`;
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

    const invSceneQuat = vrm.scene.quaternion.clone().invert();

    // 1. Head Mapping
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (headNode && this.firstPersonMode) {
      const camQuat = new THREE.Quaternion();
      camera.getWorldQuaternion(camQuat);
      const localHeadQuat = camQuat.clone().premultiply(invSceneQuat);
      headNode.quaternion.copy(localHeadQuat);
    }

    // 2. Hand Mapping
    this.controllers.forEach((controller, index) => {
      if (!controller.visible) return;
      
      const handBoneName = index === 0 ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;
      const handNode = vrm.humanoid?.getNormalizedBoneNode(handBoneName);
      
      if (handNode) {
        const ctrlPos = new THREE.Vector3();
        const ctrlQuat = new THREE.Quaternion();
        controller.getWorldPosition(ctrlPos);
        controller.getWorldQuaternion(ctrlQuat);

        const localPos = ctrlPos.clone();
        vrm.scene.worldToLocal(localPos);
        handNode.position.copy(localPos);

        const localQuat = ctrlQuat.clone().premultiply(invSceneQuat);
        const handCorrection = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, index === 0 ? Math.PI/2 : -Math.PI/2));
        localQuat.multiply(handCorrection);
        handNode.quaternion.copy(localQuat);
      }
    });

    // 3. Visibility
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
    const vrm = avatarManager.getVRM();
    if (vrm) {
        const finalPose = vrm.humanoid?.getNormalizedPose();
        if (finalPose) {
            avatarManager.setManualPosing(false);
            avatarManager.applyRawPose({ vrmPose: finalPose }, false, 'static', false);
        }
    } else {
        avatarManager.setManualPosing(false);
    }
    
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
    console.log('[VRManager] VR Session ended - Pose saved');
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
