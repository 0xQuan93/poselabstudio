import * as THREE from 'three';
import { sceneManager } from './sceneManager';
import { avatarManager } from './avatarManager';
import { animationManager } from './animationManager';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { useUserStore } from '../state/useUserStore';
import { useToastStore } from '../state/useToastStore';

/**
 * VR Manager (VRIK Version)
 * 
 * Provides professional-grade avatar tracking comparable to VRChat/Warudo.
 * Features: 2-bone arm IK, spine/chest bending, hip height tracking, and auto-calibration.
 */
class VRManager {
  private session: XRSession | null = null;
  private isVRSupported: boolean = false;
  private renderer: THREE.WebGLRenderer | null = null;
  private tickDispose?: () => void;
  private controllers: THREE.Group[] = [];
  private controllerGrips: THREE.Group[] = [];
  private firstPersonMode: boolean = true;
  private cameraGroup = new THREE.Group();
  private originalCameraParent: THREE.Object3D | null = null;
  private headMeshes: THREE.Mesh[] = [];
  private currentVrm: VRM | null = null;

  // Calibration Data
  private userHeight = 1.65;
  private avatarHeight = 1.65;
  private scaleFactor = 1.0;
  private initialAvatarPos = new THREE.Vector3();
  private referenceHeadLocalPos = new THREE.Vector3();
  private referenceHipsLocalPos = new THREE.Vector3();
  private hasTrackingReference = false;

  // Snapshot/Review
  private snapshotCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  private reviewPlane: THREE.Mesh | null = null;
  private lastSnapshotUrl: string | null = null;

  // Math Helpers
  private v1 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();

  constructor() {
    this.checkSupport();
    this.cameraGroup.name = 'VR_RIG';
    this.initReviewPlane();
  }

  private initReviewPlane() {
    const geometry = new THREE.PlaneGeometry(1.2, 0.675);
    const material = new THREE.MeshBasicMaterial({ 
        color: 0xffffff,
        side: THREE.DoubleSide, 
        transparent: true,
        opacity: 0,
        depthTest: false 
    });
    this.reviewPlane = new THREE.Mesh(geometry, material);
    this.reviewPlane.name = 'VR_Review_Window';
    this.reviewPlane.visible = false;
    this.reviewPlane.renderOrder = 999;
  }

  private async checkSupport() {
    if (navigator.xr) {
      this.isVRSupported = await navigator.xr.isSessionSupported('immersive-vr');
    }
  }

  public async enterVR() {
    if (!this.isVRSupported || !navigator.xr) {
      throw new Error('VR is not supported');
    }

    this.renderer = (sceneManager.getRenderer() as THREE.WebGLRenderer) || null;
    const scene = sceneManager.getScene();
    const camera = sceneManager.getCamera();
    
    if (!this.renderer || !scene || !camera) throw new Error('Not initialized');

    // 1. Force state
    avatarManager.setManualPosing(true);
    avatarManager.setInteraction(true); // Disable auto-grounding
    animationManager.stopAnimation(true, true); 
    
    const vrm = avatarManager.getVRM();
    if (vrm) {
        vrm.humanoid?.resetPose();
        this.initialAvatarPos.copy(vrm.scene.position);
    }
    this.hasTrackingReference = false;

    if (this.reviewPlane && !this.reviewPlane.parent) scene.add(this.reviewPlane);

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
      
      this.setupControllers();

      // Anchor rig to avatar position
      if (vrm) {
        this.cameraGroup.position.copy(vrm.scene.position);
        this.cameraGroup.rotation.y = vrm.scene.rotation.y;
      }
      
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
      session.addEventListener('end', () => this.onSessionEnded());
      this.tickDispose?.();
      this.tickDispose = sceneManager.registerTick(this.update, -100);

      // Trigger auto-calibration after 2 seconds
      setTimeout(() => this.calibrate(), 2000);

      console.log('[VRManager] VRIK Session Started');
    } catch (error) {
      console.error('[VRManager] Error:', error);
      avatarManager.setManualPosing(false);
      avatarManager.setInteraction(false);
      throw error;
    }
  }

  private setupControllers() {
    if (!this.renderer) return;
    const modelFactory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const ctrl = this.renderer.xr.getController(i);
      ctrl.addEventListener('selectstart', () => {
        if (this.reviewPlane?.visible) this.handleReviewInteraction(i);
        else this.onTriggerPressed();
      });
      this.cameraGroup.add(ctrl);
      this.controllers.push(ctrl);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(modelFactory.createControllerModel(grip));
      this.cameraGroup.add(grip);
      this.controllerGrips.push(grip);
    }
  }

  /**
   * Calibration: Matches user height to avatar scale
   */
  private calibrate() {
    const vrm = avatarManager.getVRM();
    const camera = sceneManager.getCamera();
    if (!vrm || !camera) return;

    // Get avatar head height
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (!headNode) return;
    headNode.getWorldPosition(this.v1);
    this.avatarHeight = this.v1.y - vrm.scene.position.y;

    this.captureTrackingReference(vrm, camera);

    this.scaleFactor = this.avatarHeight / Math.max(0.1, this.userHeight);
    
    useToastStore.getState().addToast('VR Calibration Complete', 'success');
    console.log(`[VRManager] Calibrated: UserHeight=${this.userHeight.toFixed(2)} AvatarHeight=${this.avatarHeight.toFixed(2)} ScaleFactor=${this.scaleFactor.toFixed(2)}`);
  }

  private captureTrackingReference(vrm: VRM, camera: THREE.Camera) {
    camera.getWorldPosition(this.v1);
    this.userHeight = this.v1.y - vrm.scene.position.y;
    vrm.scene.worldToLocal(this.v1);
    this.referenceHeadLocalPos.copy(this.v1);

    const hipsNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hipsNode) {
      this.referenceHipsLocalPos.copy(hipsNode.position);
    }

    this.hasTrackingReference = true;
  }

  private onTriggerPressed() {
    const vrm = avatarManager.getVRM();
    if (!vrm) return;
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    const head = new THREE.Vector3();
    if (headNode) headNode.getWorldPosition(head);
    else head.copy(vrm.scene.position).y += 1.6;

    const forward = new THREE.Vector3(0, 0, 1);
    vrm.scene.getWorldDirection(forward);
    this.snapshotCamera.position.copy(head).add(forward.clone().multiplyScalar(2.2)).add(new THREE.Vector3(0, 0.1, 0));
    this.snapshotCamera.lookAt(head);

    const originalMask = this.snapshotCamera.layers.mask;
    this.snapshotCamera.layers.enableAll();

    setTimeout(() => {
      sceneManager.captureSnapshot({ 
        includeLogo: true, width: 1280, height: 720, camera: this.snapshotCamera 
      }).then(url => {
        if (url) {
          this.lastSnapshotUrl = url;
          this.showVRReview(url);
        }
        this.snapshotCamera.layers.mask = originalMask;
      });
    }, 100);
  }

  private showVRReview(url: string) {
    const camera = sceneManager.getCamera();
    if (!camera || !this.reviewPlane) return;
    new THREE.TextureLoader().load(url, (tex) => {
      const mat = this.reviewPlane!.material as THREE.MeshBasicMaterial;
      mat.map = tex;
      mat.opacity = 1.0;
      mat.needsUpdate = true;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      this.reviewPlane!.position.copy(camera.position).add(forward.multiplyScalar(0.8));
      this.reviewPlane!.lookAt(camera.position);
      this.reviewPlane!.visible = true;
    });
  }

  private handleReviewInteraction(i: number) {
    if (i === 0) this.hideReview(); // Left = discard
    else { this.saveLastSnapshot(); this.publishToFeed(); this.hideReview(); } // Right = save
  }

  private async publishToFeed() {
    const user = useUserStore.getState().user;
    if (!user || !this.lastSnapshotUrl) return;
    try {
      await fetch('/.netlify/functions/publish-pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: this.lastSnapshotUrl,
          creatorName: user.username || 'VR Creator',
          creatorAvatarUrl: user.avatarUrl,
          creatorId: user.id,
          description: 'VR Posing Session | #PoseLab'
        })
      });
      useToastStore.getState().addToast('Published to Studio Feed!', 'success');
    } catch (e) { console.error(e); }
  }

  private hideReview() {
    if (this.reviewPlane) {
      this.reviewPlane.visible = false;
      (this.reviewPlane.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }

  private saveLastSnapshot() {
    if (!this.lastSnapshotUrl) return;
    const a = document.createElement('a');
    a.href = this.lastSnapshotUrl;
    a.download = `poselab_vr_${Date.now()}.png`;
    a.click();
  }

  /**
   * Core VRIK Update Loop
   */
  private update = () => {
    if (!this.session) return;
    const vrm = avatarManager.getVRM();
    const camera = sceneManager.getCamera();
    if (!vrm || !camera) return;

    const invSceneQuat = vrm.scene.quaternion.clone().invert();

    // 1. HEAD & SPINE SOLVER
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    const chestNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest);
    const spineNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
    const hipsNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);

    if (headNode && hipsNode) {
      if (!this.hasTrackingReference) {
        this.captureTrackingReference(vrm, camera);
      }

      // Rotation
      camera.getWorldQuaternion(this.q1);
      const localHeadQuat = this.q1.clone().premultiply(invSceneQuat);
      headNode.quaternion.copy(localHeadQuat);

      // Spine Bending (Tilt chest/spine to look natural)
      if (chestNode && spineNode) {
          // Calculate head forward vector
          const headForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q1);
          // Distribute rotation across spine chain (subtle)
          const bendQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), headForward);
          bendQuat.premultiply(invSceneQuat);
          
          // Apply 30% to chest, 20% to spine for organic leaning
          chestNode.quaternion.slerp(bendQuat, 0.3);
          spineNode.quaternion.slerp(bendQuat, 0.2);
      }

      // Hips Position (calibrated follow + crouching)
      camera.getWorldPosition(this.v1);
      vrm.scene.worldToLocal(this.v1);
      const currentHeight = this.v1.y;
      const crouch = Math.max(-0.5, Math.min(0.5, (this.userHeight - currentHeight) * this.scaleFactor));
      const headOffsetX = this.v1.x - this.referenceHeadLocalPos.x;
      const headOffsetZ = this.v1.z - this.referenceHeadLocalPos.z;
      const followScale = 0.75;
      const maxHorizontalOffset = 0.25;
      hipsNode.position.set(
        this.referenceHipsLocalPos.x + THREE.MathUtils.clamp(headOffsetX * followScale, -maxHorizontalOffset, maxHorizontalOffset),
        this.referenceHipsLocalPos.y - crouch,
        this.referenceHipsLocalPos.z + THREE.MathUtils.clamp(headOffsetZ * followScale, -maxHorizontalOffset, maxHorizontalOffset),
      );
    }

    // 2. ARM IK SOLVER (2-Bone Analytical)
    this.controllers.forEach((ctrl, idx) => {
      if (!ctrl.visible) return;
      const side = idx === 0 ? 'Left' : 'Right';
      const upperName = side === 'Left' ? VRMHumanBoneName.LeftUpperArm : VRMHumanBoneName.RightUpperArm;
      const lowerName = side === 'Left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm;
      const handName = side === 'Left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;

      const upperNode = vrm.humanoid?.getNormalizedBoneNode(upperName);
      const lowerNode = vrm.humanoid?.getNormalizedBoneNode(lowerName);
      const handNode = vrm.humanoid?.getNormalizedBoneNode(handName);

      if (upperNode && lowerNode && handNode) {
        ctrl.getWorldPosition(this.v1);
        ctrl.getWorldQuaternion(this.q1);

        const shoulderPos = new THREE.Vector3();
        upperNode.getWorldPosition(shoulderPos);
        
        const d1 = lowerNode.position.length(); // Upper arm len
        const d2 = handNode.position.length();  // Lower arm len
        
        const reachVec = this.v1.clone().sub(shoulderPos);
        const dist = reachVec.length();
        const reachDir = reachVec.clone().normalize();
        
        // Law of Cosines for Elbow
        const c = Math.min(dist, (d1 + d2) * 0.999);
        const cosGamma = (d1 * d1 + d2 * d2 - c * c) / (2 * d1 * d2);
        const gamma = Math.acos(THREE.MathUtils.clamp(cosGamma, -1, 1));

        // Law of Cosines for Shoulder Offset
        const cosBeta = (d1 * d1 + c * c - d2 * d2) / (2 * d1 * c);
        const beta = Math.acos(THREE.MathUtils.clamp(cosBeta, -1, 1));

        // Solve Rotation
        const baseDir = new THREE.Vector3(idx === 0 ? 1 : -1, 0, 0); // VRM Arms out along X
        const pole = new THREE.Vector3(0, 0, 1).applyQuaternion(vrm.scene.quaternion); // Elbows back
        const sideNormal = reachDir.clone().cross(pole).normalize();
        
        const shoulderQuat = new THREE.Quaternion().setFromUnitVectors(baseDir, reachDir);
        const shoulderBend = new THREE.Quaternion().setFromAxisAngle(sideNormal, idx === 0 ? -beta : beta);
        
        upperNode.quaternion.copy(shoulderQuat).multiply(shoulderBend).premultiply(invSceneQuat);
        
        const elbowBend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), idx === 0 ? (Math.PI - gamma) : -(Math.PI - gamma));
        lowerNode.quaternion.copy(elbowBend);

        // Hand Rotation
        const localHandQuat = this.q1.clone().premultiply(invSceneQuat);
        const handCorr = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2, 0, idx === 0 ? Math.PI/2 : -Math.PI/2));
        handNode.quaternion.copy(localHandQuat).multiply(handCorr);
        
        // Keep the wrist bone anchored to its default local offset. Driving the
        // whole hand bone to world-space controller coordinates breaks the arm
        // chain and prevents the avatar body from being cleanly user-driven.
      }
    });

    // 3. FPV MESH HIDING
    if (this.firstPersonMode) {
      if (this.currentVrm !== vrm) {
        this.currentVrm = vrm;
        this.headMeshes = [];
        vrm.scene.traverse(o => {
          if (o instanceof THREE.Mesh) {
            const n = o.name.toLowerCase();
            if (n.includes('head') || n.includes('face') || n.includes('hair') || n.includes('eye') || n.includes('mouth') || n.includes('brow')) this.headMeshes.push(o);
          }
        });
      }
      camera.layers.disable(10);
      this.headMeshes.forEach(m => m.layers.set(10));
    }
  };

  private onSessionEnded() {
    const vrm = avatarManager.getVRM();
    this.tickDispose?.();
    this.tickDispose = undefined;
    this.hasTrackingReference = false;

    if (vrm) {
      const pose = vrm.humanoid?.getNormalizedPose();
      vrm.scene.position.copy(this.initialAvatarPos);
      avatarManager.setManualPosing(false);
      avatarManager.setInteraction(false);
      if (pose) avatarManager.applyRawPose({ vrmPose: pose }, false, 'static', false);
    } else {
      avatarManager.setManualPosing(false);
      avatarManager.setInteraction(false);
    }
    const cam = sceneManager.getCamera();
    const scene = sceneManager.getScene();
    if (cam && this.originalCameraParent) this.originalCameraParent.add(cam);
    cam?.layers.enable(10);
    this.headMeshes.forEach((mesh) => mesh.layers.enable(0));
    if (scene && this.cameraGroup) scene.remove(this.cameraGroup);
    this.hideReview();
    this.session = null;
    this.controllers = [];
    this.controllerGrips = [];
    console.log('[VRManager] Session Ended');
  }

  public async exitVR() { if (this.session) await this.session.end(); }
  public isSupported() { return this.isVRSupported; }
  public isInVR() { return this.session !== null; }
  public setFirstPerson(e: boolean) { this.firstPersonMode = e; }
}

export const vrManager = new VRManager();
