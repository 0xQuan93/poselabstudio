import * as THREE from 'three';
import { sceneManager } from './sceneManager';
import { avatarManager } from './avatarManager';
import { animationManager } from './animationManager';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { useUserStore } from '../state/useUserStore';
import { useToastStore } from '../state/useToastStore';

type XRControllerGroup = THREE.Group & {
  addEventListener(type: 'selectstart', listener: () => void): void;
  removeEventListener(type: 'selectstart', listener: () => void): void;
  userData: THREE.Object3D['userData'] & {
    vrSelectHandler?: () => void;
  };
};

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
  private originalRendererPixelRatio: number | null = null;
  private originalRendererShadowMapEnabled: boolean | null = null;

  // Calibration Data
  private userHeight = 1.65;
  private avatarHeight = 1.65;
  private scaleFactor = 1.0;
  private initialAvatarPos = new THREE.Vector3();
  private initialAvatarRotation = new THREE.Euler();
  private referenceHeadLocalPos = new THREE.Vector3();
  private referenceHipsLocalPos = new THREE.Vector3();
  private referenceBodyYawOffset = 0;
  private hasTrackingReference = false;

  // Snapshot/Review
  private snapshotCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  private reviewPlane: THREE.Mesh | null = null;
  private lastSnapshotUrl: string | null = null;
  private isCapturingSnapshot = false;

  // Math Helpers
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private q3 = new THREE.Quaternion();
  private e1 = new THREE.Euler();
  private initialHandWorldRotations = [new THREE.Quaternion(), new THREE.Quaternion()];
  private controllerHandOffsets = [new THREE.Quaternion(), new THREE.Quaternion()];
  private hasControllerHandOffsets = [false, false];
  private gamepadButtonStates = new Map<string, boolean>();

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
        vrm.humanoid?.resetNormalizedPose();
        this.initialAvatarPos.copy(vrm.scene.position);
        this.initialAvatarRotation.copy(vrm.scene.rotation);
        this.captureInitialHandRotations(vrm);
    }
    this.hasTrackingReference = false;
    this.hasControllerHandOffsets = [false, false];
    this.gamepadButtonStates.clear();

    if (this.reviewPlane && !this.reviewPlane.parent) scene.add(this.reviewPlane);

    this.originalRendererShadowMapEnabled ??= this.renderer.shadowMap.enabled;
    this.originalRendererPixelRatio ??= this.renderer.getPixelRatio();
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
      useToastStore.getState().addToast('VR controls: Right trigger snaps/saves, left trigger discards review, left stick press recalibrates, right stick press toggles FPV.', 'success');

      console.log('[VRManager] VRIK Session Started');
    } catch (error) {
      console.error('[VRManager] Error:', error);
      this.restoreRendererState();
      if (this.renderer) this.renderer.xr.enabled = false;
      avatarManager.setManualPosing(false);
      avatarManager.setInteraction(false);
      throw error;
    }
  }

  private setupControllers() {
    if (!this.renderer) return;

    this.controllers.forEach((ctrl) => {
      const xrCtrl = ctrl as XRControllerGroup;
      const existingHandler = xrCtrl.userData.vrSelectHandler;
      if (existingHandler) xrCtrl.removeEventListener('selectstart', existingHandler);
    });

    this.controllers = [];
    this.controllerGrips = [];

    const modelFactory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const ctrl = this.renderer.xr.getController(i) as XRControllerGroup;
      const selectHandler = () => {
        if (this.reviewPlane?.visible) this.handleReviewInteraction(i);
        else if (i === 1) this.captureSnapshot();
      };
      ctrl.userData.vrSelectHandler = selectHandler;
      ctrl.addEventListener('selectstart', selectHandler);
      this.cameraGroup.add(ctrl);
      this.controllers.push(ctrl);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.clear();
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
    this.captureControllerHandOffsets();

    this.scaleFactor = this.avatarHeight / Math.max(0.1, this.userHeight);
    
    useToastStore.getState().addToast('VR Calibration Complete', 'success');
    console.log(`[VRManager] Calibrated: UserHeight=${this.userHeight.toFixed(2)} AvatarHeight=${this.avatarHeight.toFixed(2)} ScaleFactor=${this.scaleFactor.toFixed(2)}`);
  }

  private captureTrackingReference(vrm: VRM, camera: THREE.Camera) {
    camera.getWorldPosition(this.v1);
    this.userHeight = this.v1.y - vrm.scene.position.y;
    vrm.scene.worldToLocal(this.v1);
    this.referenceHeadLocalPos.copy(this.v1);

    camera.getWorldQuaternion(this.q1);
    this.e1.setFromQuaternion(this.q1, 'YXZ');

    // AvatarManager keeps the avatar scene rotated 180° in desktop mode so the
    // model faces the preview camera. VR body yaw should only preserve any user
    // authored offset beyond that desktop-facing baseline.
    this.referenceBodyYawOffset = vrm.scene.rotation.y - Math.PI - this.e1.y;

    const hipsNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hipsNode) {
      this.referenceHipsLocalPos.copy(hipsNode.position);
    }

    this.hasTrackingReference = true;
  }

  private setBoneWorldQuaternion(bone: THREE.Object3D, worldQuaternion: THREE.Quaternion) {
    if (bone.parent) {
      bone.parent.getWorldQuaternion(this.q2);
      bone.quaternion.copy(this.q2.invert().multiply(worldQuaternion));
    } else {
      bone.quaternion.copy(worldQuaternion);
    }
  }

  private captureInitialHandRotations(vrm: VRM) {
    const leftHand = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftHand);
    const rightHand = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightHand);
    leftHand?.getWorldQuaternion(this.initialHandWorldRotations[0]);
    rightHand?.getWorldQuaternion(this.initialHandWorldRotations[1]);
  }

  private captureControllerHandOffsets() {
    this.controllerGrips.forEach((grip, idx) => {
      if (!grip.visible) return;
      grip.getWorldQuaternion(this.q1);
      this.controllerHandOffsets[idx].copy(this.q1.clone().invert().multiply(this.initialHandWorldRotations[idx]));
      this.hasControllerHandOffsets[idx] = true;
    });

    if (this.hasControllerHandOffsets.some(Boolean)) {
      console.log('[VRManager] Controller hand offsets calibrated');
    }
  }

  private captureSnapshot() {
    const vrm = avatarManager.getVRM();
    const camera = sceneManager.getCamera();
    if (!vrm || !camera || this.isCapturingSnapshot) return;
    this.isCapturingSnapshot = true;
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    const hipsNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    const head = new THREE.Vector3();
    const hips = new THREE.Vector3();
    if (headNode) headNode.getWorldPosition(head);
    else head.copy(vrm.scene.position).y += 1.6;
    if (hipsNode) hipsNode.getWorldPosition(hips);
    else hips.copy(vrm.scene.position).y += 1.0;

    const avatarForward = new THREE.Vector3(0, 0, 1).applyQuaternion(vrm.scene.quaternion).normalize();
    const avatarRight = new THREE.Vector3(1, 0, 0).applyQuaternion(vrm.scene.quaternion).normalize();
    const lookTarget = hips.clone().lerp(head, 0.6).add(new THREE.Vector3(0, 0.08, 0));
    const framingDistance = THREE.MathUtils.clamp(this.avatarHeight * 0.9, 1.25, 2.3);

    this.snapshotCamera.position
      .copy(lookTarget)
      .add(avatarForward.multiplyScalar(framingDistance))
      .add(avatarRight.multiplyScalar(0.12))
      .add(new THREE.Vector3(0, 0.22, 0));
    this.snapshotCamera.lookAt(lookTarget);

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
      }).finally(() => {
        this.isCapturingSnapshot = false;
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

  private applyFingerCurl(
    vrm: VRM,
    names: [VRMHumanBoneName, VRMHumanBoneName, VRMHumanBoneName],
    side: 'Left' | 'Right',
    curl: number,
    thumb = false,
  ) {
    const [proximalName, intermediateName, distalName] = names;
    const proximal = vrm.humanoid?.getNormalizedBoneNode(proximalName);
    const intermediate = vrm.humanoid?.getNormalizedBoneNode(intermediateName);
    const distal = vrm.humanoid?.getNormalizedBoneNode(distalName);
    const sideSign = side === 'Left' ? -1 : 1;

    if (thumb) {
      const thumbCurl = THREE.MathUtils.clamp(curl, 0, 1);
      const thumbQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          -0.2 * thumbCurl,
          sideSign * 0.35 * thumbCurl,
          sideSign * 0.55 * thumbCurl,
        ),
      );
      proximal?.quaternion.slerp(thumbQuat, 0.5);
      intermediate?.quaternion.slerp(thumbQuat, 0.65);
      distal?.quaternion.slerp(thumbQuat, 0.8);
      return;
    }

    const proximalQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sideSign * -0.9 * curl));
    const intermediateQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sideSign * -1.1 * curl));
    const distalQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sideSign * -0.9 * curl));
    proximal?.quaternion.slerp(proximalQuat, 0.55);
    intermediate?.quaternion.slerp(intermediateQuat, 0.7);
    distal?.quaternion.slerp(distalQuat, 0.85);
  }

  private applyControllerFingerPose(vrm: VRM, inputSource: XRInputSource | undefined, side: 'Left' | 'Right') {
    const gamepad = inputSource?.gamepad;
    if (!gamepad) return;

    const trigger = gamepad.buttons[0]?.value ?? 0;
    const squeeze = gamepad.buttons[1]?.value ?? 0;
    const thumbTouched = [3, 4, 5].some((idx) => gamepad.buttons[idx]?.touched);
    const thumbCurl = thumbTouched ? 0.7 : 0.15;

    const prefix = side === 'Left' ? 'Left' : 'Right';
    this.applyFingerCurl(vrm, [
      VRMHumanBoneName[`${prefix}IndexProximal`],
      VRMHumanBoneName[`${prefix}IndexIntermediate`],
      VRMHumanBoneName[`${prefix}IndexDistal`],
    ], side, trigger);
    this.applyFingerCurl(vrm, [
      VRMHumanBoneName[`${prefix}MiddleProximal`],
      VRMHumanBoneName[`${prefix}MiddleIntermediate`],
      VRMHumanBoneName[`${prefix}MiddleDistal`],
    ], side, squeeze);
    this.applyFingerCurl(vrm, [
      VRMHumanBoneName[`${prefix}RingProximal`],
      VRMHumanBoneName[`${prefix}RingIntermediate`],
      VRMHumanBoneName[`${prefix}RingDistal`],
    ], side, squeeze);
    this.applyFingerCurl(vrm, [
      VRMHumanBoneName[`${prefix}LittleProximal`],
      VRMHumanBoneName[`${prefix}LittleIntermediate`],
      VRMHumanBoneName[`${prefix}LittleDistal`],
    ], side, squeeze);
    this.applyFingerCurl(vrm, [
      VRMHumanBoneName[`${prefix}ThumbProximal`],
      VRMHumanBoneName[`${prefix}ThumbDistal`],
      VRMHumanBoneName[`${prefix}ThumbDistal`],
    ], side, thumbCurl, true);
  }

  private consumeGamepadButton(inputSource: XRInputSource | undefined, buttonIndex: number, key: string) {
    const pressed = !!inputSource?.gamepad?.buttons[buttonIndex]?.pressed;
    const wasPressed = this.gamepadButtonStates.get(key) ?? false;
    this.gamepadButtonStates.set(key, pressed);
    return pressed && !wasPressed;
  }

  private updateControllerShortcuts() {
    const leftInput = this.session?.inputSources[0];
    const rightInput = this.session?.inputSources[1];

    if (this.consumeGamepadButton(leftInput, 3, 'left-stick-press')) {
      this.calibrate();
    }

    if (this.consumeGamepadButton(rightInput, 3, 'right-stick-press')) {
      this.firstPersonMode = !this.firstPersonMode;
      useToastStore.getState().addToast(this.firstPersonMode ? 'First-person mode enabled' : 'First-person mode disabled', 'success');
    }
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
    this.updateControllerShortcuts();

    // 1. HEAD & SPINE SOLVER
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    const chestNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest);
    const spineNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
    const hipsNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);

    if (headNode && hipsNode) {
      if (!this.hasTrackingReference) {
        this.captureTrackingReference(vrm, camera);
      }

      vrm.scene.rotation.x = this.initialAvatarRotation.x;
      vrm.scene.rotation.z = this.initialAvatarRotation.z;

      // Rotation
      camera.getWorldQuaternion(this.q1);
      this.e1.setFromQuaternion(this.q1, 'YXZ');

      // Industry-standard 3-point VR avatar control pins the avatar root to the
      // HMD and uses headset yaw to drive the body. We preserve the calibrated
      // avatar-vs-headset yaw offset so the user stays aligned with the rig.
      vrm.scene.rotation.y = this.e1.y + this.referenceBodyYawOffset;
      camera.getWorldPosition(this.v1);
      this.v2.copy(this.referenceHeadLocalPos).applyQuaternion(vrm.scene.quaternion);
      vrm.scene.position.set(
        this.v1.x - this.v2.x,
        this.initialAvatarPos.y,
        this.v1.z - this.v2.z,
      );

      this.setBoneWorldQuaternion(headNode, this.q1);

      // Spine Bending (Tilt chest/spine to look natural)
      if (chestNode && spineNode) {
          const torsoLocalQuat = vrm.scene.quaternion.clone().invert().multiply(this.q1);
          const identityQuat = new THREE.Quaternion();

          chestNode.quaternion.copy(identityQuat.clone().slerp(torsoLocalQuat, 0.3));
          spineNode.quaternion.copy(identityQuat.clone().slerp(torsoLocalQuat, 0.2));
      }

      // Hips Position (calibrated follow + crouching)
      camera.getWorldPosition(this.v1);
      vrm.scene.worldToLocal(this.v1);
      const currentHeight = this.v1.y;
      const crouch = Math.max(-0.5, Math.min(0.5, (this.userHeight - currentHeight) * this.scaleFactor));
      hipsNode.position.set(
        this.referenceHipsLocalPos.x,
        this.referenceHipsLocalPos.y - crouch,
        this.referenceHipsLocalPos.z,
      );
    }

    // 2. ARM IK SOLVER (2-Bone Analytical)
    this.controllerGrips.forEach((grip, idx) => {
      if (!grip.visible) return;
      const side = idx === 0 ? 'Left' : 'Right';
      const upperName = side === 'Left' ? VRMHumanBoneName.LeftUpperArm : VRMHumanBoneName.RightUpperArm;
      const lowerName = side === 'Left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm;
      const handName = side === 'Left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;

      const upperNode = vrm.humanoid?.getNormalizedBoneNode(upperName);
      const lowerNode = vrm.humanoid?.getNormalizedBoneNode(lowerName);
      const handNode = vrm.humanoid?.getNormalizedBoneNode(handName);

      if (upperNode && lowerNode && handNode) {
        grip.getWorldPosition(this.v1);
        grip.getWorldQuaternion(this.q1);

        const shoulderPos = new THREE.Vector3();
        upperNode.getWorldPosition(shoulderPos);

        const upperLen = lowerNode.position.length();
        const lowerLen = handNode.position.length();
        const reachVec = this.v1.clone().sub(shoulderPos);
        const reachDist = reachVec.length();
        if (reachDist < 1e-5) return;

        const clampedDist = Math.min(reachDist, (upperLen + lowerLen) * 0.999);
        const reachDir = reachVec.clone().normalize();

        // Build the bend plane from the avatar's side/back vectors instead of
        // assuming the normalized VRM arm always rests on +/-X. That assumption
        // was causing the user's lowered hands to solve upward on some rigs.
        const sidePole = new THREE.Vector3(idx === 0 ? -1 : 1, 0, 0).applyQuaternion(vrm.scene.quaternion);
        const backPole = new THREE.Vector3(0, 0, -1).applyQuaternion(vrm.scene.quaternion);
        const poleHint = sidePole.addScaledVector(backPole, 0.35).normalize();

        let bendNormal = reachDir.clone().cross(poleHint);
        if (bendNormal.lengthSq() < 1e-6) {
          bendNormal = reachDir.clone().cross(new THREE.Vector3(0, 1, 0).applyQuaternion(vrm.scene.quaternion));
        }
        if (bendNormal.lengthSq() < 1e-6) {
          bendNormal = reachDir.clone().cross(new THREE.Vector3(1, 0, 0));
        }
        bendNormal.normalize();

        const elbowOut = bendNormal.clone().cross(reachDir).normalize();
        const shoulderToElbowAlong = ((upperLen * upperLen) - (lowerLen * lowerLen) + (clampedDist * clampedDist)) / (2 * clampedDist);
        const elbowHeight = Math.sqrt(Math.max(0, upperLen * upperLen - shoulderToElbowAlong * shoulderToElbowAlong));
        const elbowPos = shoulderPos.clone()
          .add(reachDir.clone().multiplyScalar(shoulderToElbowAlong))
          .add(elbowOut.multiplyScalar(elbowHeight));

        const upperRestDirLocal = lowerNode.position.clone().normalize();
        upperNode.parent?.getWorldQuaternion(this.q2);
        const elbowDirLocal = elbowPos
          .clone()
          .sub(shoulderPos)
          .normalize()
          .applyQuaternion(this.q2.clone().invert());
        upperNode.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(upperRestDirLocal, elbowDirLocal));

        const lowerRestDirLocal = handNode.position.clone().normalize();
        lowerNode.parent?.getWorldQuaternion(this.q2);
        const handDirLocal = this.v1
          .clone()
          .sub(elbowPos)
          .normalize()
          .applyQuaternion(this.q2.clone().invert());
        lowerNode.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(lowerRestDirLocal, handDirLocal));

        if (!this.hasControllerHandOffsets[idx]) {
          this.captureControllerHandOffsets();
        }

        // Hand Rotation
        this.q3.copy(this.q1).multiply(this.controllerHandOffsets[idx]);
        this.setBoneWorldQuaternion(handNode, this.q3);
        this.applyControllerFingerPose(vrm, this.session?.inputSources[idx], side);
      }
    });

    // 3. FPV MESH HIDING
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

    if (this.firstPersonMode) {
      camera.layers.disable(10);
      this.headMeshes.forEach(m => m.layers.set(10));
    } else {
      camera.layers.enable(10);
      this.headMeshes.forEach(m => m.layers.enable(0));
    }
  };

  private restoreRendererState() {
    if (!this.renderer) return;
    if (this.originalRendererShadowMapEnabled !== null) {
      this.renderer.shadowMap.enabled = this.originalRendererShadowMapEnabled;
    }
    if (this.originalRendererPixelRatio !== null) {
      this.renderer.setPixelRatio(this.originalRendererPixelRatio);
    }
  }

  private onSessionEnded() {
    const vrm = avatarManager.getVRM();
    this.tickDispose?.();
    this.tickDispose = undefined;
    this.hasTrackingReference = false;

    if (vrm) {
      const pose = vrm.humanoid?.getNormalizedPose();
      vrm.scene.position.copy(this.initialAvatarPos);
      vrm.scene.rotation.copy(this.initialAvatarRotation);
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
    this.restoreRendererState();
    if (this.renderer) this.renderer.xr.enabled = false;
    cam?.layers.enable(10);
    this.headMeshes.forEach((mesh) => mesh.layers.enable(0));
    if (scene && this.cameraGroup) scene.remove(this.cameraGroup);
    this.hideReview();
    this.session = null;
    this.controllers.forEach((ctrl) => {
      const xrCtrl = ctrl as XRControllerGroup;
      const existingHandler = xrCtrl.userData.vrSelectHandler;
      if (existingHandler) {
        xrCtrl.removeEventListener('selectstart', existingHandler);
        delete xrCtrl.userData.vrSelectHandler;
      }
    });
    this.controllers = [];
    this.controllerGrips = [];
    this.originalCameraParent = null;
    console.log('[VRManager] Session Ended');
  }

  public async exitVR() { if (this.session) await this.session.end(); }
  public isSupported() { return this.isVRSupported; }
  public isInVR() { return this.session !== null; }
  public setFirstPerson(e: boolean) { this.firstPersonMode = e; }
}

export const vrManager = new VRManager();
