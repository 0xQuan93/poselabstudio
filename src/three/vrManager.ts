import * as THREE from 'three';
import { sceneManager } from './sceneManager';
import { avatarManager } from './avatarManager';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

/**
 * VR Manager
 * 
 * Handles WebXR sessions, first-person camera syncing, and controller interactions.
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

    // Optimization: VR needs high framerate. 
    // Disable heavy features.
    this.renderer.shadowMap.enabled = false;
    // Cap pixel ratio to 1.0 for VR performance (usually enough for modern headsets)
    this.renderer.setPixelRatio(1.0);

    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['bounded-floor', 'hand-tracking', 'layers']
      });

      this.session = session;
      this.renderer.xr.enabled = true;
      this.renderer.xr.setSession(session);
      
      // Setup Camera Group for positioning in VR
      scene.add(this.cameraGroup);
      this.originalCameraParent = camera.parent;
      this.cameraGroup.add(camera);
      
      // Reset camera local position/rotation as it will be controlled by XR
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);

      this.setupControllers();

      session.addEventListener('end', () => this.onSessionEnded());

      // Start the sync loop
      sceneManager.registerTick(this.update);

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
    console.log(`[VRManager] Controller ${index} trigger pressed - Taking snapshot`);
    // Take a snapshot in VR
    // Use a small delay to ensure the UI or anything else is ready
    setTimeout(() => {
        sceneManager.captureSnapshot({ includeLogo: true }).then(dataUrl => {
          if (dataUrl) {
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `poselab_vr_snapshot_${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log('[VRManager] Snapshot saved');
          }
        });
    }, 100);
  }

  private headMeshes: THREE.Mesh[] = [];
  private currentVrm: any = null;

  private update = () => {
    if (!this.session || !this.firstPersonMode) return;

    const vrm = avatarManager.getVRM();
    if (!vrm) return;

    // Position the camera group at the avatar's position
    this.cameraGroup.position.copy(vrm.scene.position);
    this.cameraGroup.rotation.y = vrm.scene.rotation.y;

    // Cache head meshes if VRM changed
    if (this.currentVrm !== vrm) {
      this.currentVrm = vrm;
      this.headMeshes = [];
      vrm.scene.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh) {
          const name = obj.name.toLowerCase();
          if (
            name.includes('head') || 
            name.includes('face') || 
            name.includes('hair') || 
            name.includes('eye') || 
            name.includes('mouth') ||
            name.includes('brow') ||
            name.includes('ear') ||
            name.includes('tooth') ||
            name.includes('tongue')
          ) {
            this.headMeshes.push(obj);
          }
        }
      });
    }

    // Head Hiding Logic
    const VR_INVISIBLE_LAYER = 10;
    const camera = sceneManager.getCamera();
    if (camera) {
      camera.layers.enable(0); 
      camera.layers.disable(VR_INVISIBLE_LAYER);
    }

    this.headMeshes.forEach(mesh => {
      mesh.layers.set(VR_INVISIBLE_LAYER);
    });
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
