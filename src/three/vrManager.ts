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
  private viewfinderPlane: THREE.Mesh | null = null;
  private viewfinderRenderTarget: THREE.WebGLRenderTarget | null = null;

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
  private controllerHandTargetOffsets = [
    new THREE.Vector3(-0.035, -0.035, 0.03),
    new THREE.Vector3(0.035, -0.035, 0.03),
  ];
  private avatarBounds = new THREE.Box3();
  private floorAnchorY = 0;
  private currentBodyYaw = 0;
  private readonly handheldSelfieMinDistance = 0.95;
  private readonly handheldSelfieMaxDistance = 1.6;

  constructor() {
    this.checkSupport();
    this.cameraGroup.name = 'VR_RIG';
    this.initReviewPlane();
    this.initViewfinder();
  }

  private initViewfinder() {
    this.viewfinderRenderTarget = new THREE.WebGLRenderTarget(360, 640);
    const geometry = new THREE.PlaneGeometry(0.15, 0.15 * (640/360));
    const material = new THREE.MeshBasicMaterial({ 
        map: this.viewfinderRenderTarget.texture,
        side: THREE.DoubleSide,
        depthTest: false,
    });
    this.viewfinderPlane = new THREE.Mesh(geometry, material);
    this.viewfinderPlane.name = 'VR_Viewfinder';
    this.viewfinderPlane.renderOrder = 998;
    this.viewfinderPlane.visible = false;
  }

  private activeFlash: { mesh: THREE.Mesh, opacity: number } | null = null;

  private triggerFlash() {
    const scene = sceneManager.getScene();
    const camera = sceneManager.getCamera();
    if (!scene || !camera) return;

    if (this.activeFlash) {
       scene.remove(this.activeFlash.mesh);
       this.activeFlash.mesh.geometry.dispose();
       (this.activeFlash.mesh.material as THREE.Material).dispose();
    }

    const flashGeometry = new THREE.PlaneGeometry(10, 10);
    const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false });
    const flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
    
    const forward = new THREE.Vector3(0, 0, -0.5).applyQuaternion(camera.quaternion);
    flashMesh.position.copy(camera.position).add(forward);
    flashMesh.quaternion.copy(camera.quaternion);
    flashMesh.renderOrder = 9999;
    scene.add(flashMesh);
    
    this.activeFlash = { mesh: flashMesh, opacity: 0.8 };

    // Audio click
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
    } catch (e) {}
  }

  private initReviewPlane() {
    // Taller geometry to fit the snapshot + UI context labels
    const geometry = new THREE.PlaneGeometry(0.675, 1.2 * (1380/1280));
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
        this.captureFloorAnchor(vrm);
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
      
      if (i === 1 && this.viewfinderPlane) {
        grip.add(this.viewfinderPlane);
        this.viewfinderPlane.position.set(0, 0.1, -0.1);
        this.viewfinderPlane.rotation.x = -Math.PI / 6;
      }
      
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
    this.avatarHeight = this.v1.y - this.initialAvatarPos.y;

    this.captureTrackingReference(vrm, camera);
    this.captureControllerHandOffsets();

    this.scaleFactor = this.avatarHeight / Math.max(0.1, this.userHeight);
    
    useToastStore.getState().addToast('VR Calibration Complete', 'success');
    console.log(`[VRManager] Calibrated: UserHeight=${this.userHeight.toFixed(2)} AvatarHeight=${this.avatarHeight.toFixed(2)} ScaleFactor=${this.scaleFactor.toFixed(2)}`);
  }

  private captureTrackingReference(vrm: VRM, camera: THREE.Camera) {
    camera.getWorldPosition(this.v1);
    this.userHeight = this.v1.y - this.initialAvatarPos.y;
    vrm.scene.worldToLocal(this.v1);
    this.referenceHeadLocalPos.copy(this.v1);

    camera.getWorldQuaternion(this.q1);
    this.e1.setFromQuaternion(this.q1, 'YXZ');

    // AvatarManager keeps the avatar scene rotated 180° in desktop mode so the
    // model faces the preview camera. VR body yaw should only preserve any user
    // authored offset beyond that desktop-facing baseline.
    this.referenceBodyYawOffset = vrm.scene.rotation.y - Math.PI - this.e1.y;
    this.currentBodyYaw = this.e1.y;

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

  private captureFloorAnchor(vrm: VRM) {
    vrm.scene.updateWorldMatrix(true, true);
    this.avatarBounds.setFromObject(vrm.scene);
    this.floorAnchorY = this.avatarBounds.min.y;
  }

  private ensureSelfieCameraOutsideAvatar(vrm: VRM, fallbackDirection: THREE.Vector3) {
    vrm.scene.updateWorldMatrix(true, true);
    this.avatarBounds.setFromObject(vrm.scene);
    if (!Number.isFinite(this.avatarBounds.min.x) || !Number.isFinite(this.avatarBounds.max.x)) return;

    const center = this.avatarBounds.getCenter(new THREE.Vector3());
    const radius = this.avatarBounds.getSize(new THREE.Vector3()).length() * 0.5;
    const safeRadius = radius + (0.12 * Math.max(0.8, this.scaleFactor));

    const fromCenter = this.snapshotCamera.position.clone().sub(center);
    const dist = fromCenter.length();
    if (dist >= safeRadius) return;

    const retreatDir = dist > 1e-5
      ? fromCenter.normalize()
      : fallbackDirection.clone().normalize();
    this.snapshotCamera.position.copy(center).addScaledVector(retreatDir, safeRadius);
  }

  private keepAvatarGrounded(vrm: VRM) {
    vrm.scene.updateWorldMatrix(true, true);
    this.avatarBounds.setFromObject(vrm.scene);
    if (!Number.isFinite(this.avatarBounds.min.y)) return;

    const deltaY = this.floorAnchorY - this.avatarBounds.min.y;
    if (Math.abs(deltaY) > 1e-4) {
      vrm.scene.position.y += deltaY;
    }
  }

  private captureSnapshot() {
    const vrm = avatarManager.getVRM();
    const camera = sceneManager.getCamera();
    if (!vrm || !camera || this.isCapturingSnapshot) return;
    this.isCapturingSnapshot = true;
    
    vrm.scene.updateWorldMatrix(true, true);
    
    // Target resolution for selfie (Vertical 9:16)
    const targetWidth = 720;
    const targetHeight = 1280;

    // Get head position for the camera to look at
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    const headPos = new THREE.Vector3();
    if (headNode) headNode.getWorldPosition(headPos);
    else headPos.copy(vrm.scene.position).add(new THREE.Vector3(0, 1.5 * this.scaleFactor, 0));

    const rightGrip = this.controllerGrips[1]; // Right trigger triggers snapshot
    
    if (rightGrip && rightGrip.visible) {
        // HANDHELD SELFIE MODE (Free aim already set in update loop)
        
        // Haptics
        const session = this.renderer?.xr.getSession();
        if (session) {
            const rightInput = session.inputSources[1];
            if (rightInput?.gamepad?.hapticActuators?.[0]) {
                rightInput.gamepad.hapticActuators[0].pulse(1.0, 100);
            }
        }
        
        // Visual Flash & Audio
        this.triggerFlash();
        
    } else {
        // AUTO-PORTRAIT MODE (Third person vertical)
        this.avatarBounds.setFromObject(vrm.scene);
        const avatarForward = new THREE.Vector3(0, 0, 1).applyQuaternion(vrm.scene.quaternion).normalize();
        
        // Composition for vertical portrait
        const framingDistance = 1.3 * this.scaleFactor;
        this.snapshotCamera.position
          .copy(headPos)
          .add(avatarForward.multiplyScalar(framingDistance))
          .add(new THREE.Vector3(0, 0.1, 0));
        
        this.snapshotCamera.fov = 50;
        this.snapshotCamera.lookAt(headPos);
    }

    this.snapshotCamera.near = 0.01;
    this.snapshotCamera.far = 100;
    this.snapshotCamera.updateProjectionMatrix();

    const originalMask = this.snapshotCamera.layers.mask;
    this.snapshotCamera.layers.enableAll();

    setTimeout(() => {
      sceneManager.captureSnapshot({ 
        includeLogo: true, width: targetWidth, height: targetHeight, camera: this.snapshotCamera 
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

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 1280 + 100; // Extra space for UI
      const ctx = canvas.getContext('2d')!;
      
      // Draw background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw Snapshot
      ctx.drawImage(img, 0, 0, 720, 1280);
      
      // Draw UI Text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('[L-Trigger: ✖ Discard]    [R-Trigger: ✔ Publish]', canvas.width / 2, 1280 + 60);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      
      const mat = this.reviewPlane!.material as THREE.MeshBasicMaterial;
      mat.map = tex;
      mat.opacity = 1.0;
      mat.needsUpdate = true;
      
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      this.reviewPlane!.position.copy(camera.position).add(forward.multiplyScalar(0.8));
      this.reviewPlane!.lookAt(camera.position);
      this.reviewPlane!.visible = true;
    };
    img.src = url;
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
    const squeeze = 0.08 + (gamepad.buttons[1]?.value ?? 0) * 0.92;
    const thumbTouched = [3, 4, 5].some((idx) => gamepad.buttons[idx]?.touched);
    const thumbCurl = thumbTouched ? 0.58 : 0.1;

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

  private getInputSourceByHandedness(handedness: XRHandedness): XRInputSource | undefined {
    return this.session ? Array.from(this.session.inputSources).find((source: XRInputSource) => source.handedness === handedness) : undefined;
  }

  private updateControllerShortcuts() {
    const leftInput = this.getInputSourceByHandedness('left');
    const rightInput = this.getInputSourceByHandedness('right');

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

    if (this.activeFlash) {
      this.activeFlash.opacity -= 0.05;
      if (this.activeFlash.opacity <= 0) {
        sceneManager.getScene()?.remove(this.activeFlash.mesh);
        this.activeFlash.mesh.geometry.dispose();
        (this.activeFlash.mesh.material as THREE.Material).dispose();
        this.activeFlash = null;
      } else {
        (this.activeFlash.mesh.material as THREE.MeshBasicMaterial).opacity = this.activeFlash.opacity;
      }
    }

    const rightGrip = this.controllerGrips[1];
    if (rightGrip && rightGrip.visible && this.viewfinderPlane && this.viewfinderRenderTarget) {
        this.viewfinderPlane.visible = true;

        // Stabilized handheld selfie framing: keep the avatar in view instead of
        // rendering an extreme close-up when the controller is near the headset.
        rightGrip.getWorldPosition(this.v1);
        rightGrip.getWorldQuaternion(this.q1);

        const headNodeForViewfinder = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
        const lookAtTarget = new THREE.Vector3();
        if (headNodeForViewfinder) {
          headNodeForViewfinder.getWorldPosition(lookAtTarget);
        } else {
          lookAtTarget.copy(vrm.scene.position).add(new THREE.Vector3(0, 1.45 * this.scaleFactor, 0));
        }

        lookAtTarget.y -= 0.08 * this.scaleFactor;

        const controllerForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q1).normalize();
        const lensOffset = controllerForward.clone().multiplyScalar(0.08);
        this.snapshotCamera.position.copy(this.v1).add(lensOffset);

        const idealDistance = THREE.MathUtils.clamp(1.15 * this.scaleFactor, this.handheldSelfieMinDistance, this.handheldSelfieMaxDistance);
        const cameraFromTarget = this.snapshotCamera.position.clone().sub(lookAtTarget);
        const currentDistance = cameraFromTarget.length();
        if (currentDistance < idealDistance) {
          const retreatDirection = currentDistance > 1e-5
            ? cameraFromTarget.normalize()
            : controllerForward.clone().negate();
          this.snapshotCamera.position.copy(lookAtTarget).addScaledVector(retreatDirection, idealDistance);
        }

        this.ensureSelfieCameraOutsideAvatar(vrm, controllerForward.clone().negate());
        this.snapshotCamera.lookAt(lookAtTarget);
        this.snapshotCamera.fov = 58;
        this.snapshotCamera.near = 0.01;
        this.snapshotCamera.far = 100;
        this.snapshotCamera.updateProjectionMatrix();

        if (this.renderer && !this.isCapturingSnapshot) {
            const gl = this.renderer;
            const currentRenderTarget = gl.getRenderTarget();

            // Hide viewfinder mesh during its own render to avoid infinite mirror
            this.viewfinderPlane.visible = false;

            gl.setRenderTarget(this.viewfinderRenderTarget);
            gl.render(sceneManager.getScene()!, this.snapshotCamera);

            gl.setRenderTarget(currentRenderTarget);

            this.viewfinderPlane.visible = true;
        }
    } else if (this.viewfinderPlane) {
        this.viewfinderPlane.visible = false;
    }

    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);
    
    // Calculate the perfect target head position mapping real-world space to avatar space
    const drop = this.userHeight - (cameraPos.y - this.initialAvatarPos.y);
    const scaledDrop = drop * this.scaleFactor;
    const targetHeadPos = new THREE.Vector3(
        cameraPos.x,
        this.initialAvatarPos.y + this.avatarHeight - scaledDrop,
        cameraPos.z
    );

    // 1. HEAD & SPINE SOLVER
    const headNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    const chestNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest);
    const upperChestNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.UpperChest);
    const spineNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
    const neckNode = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck);
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

      // VRChat style low-pass filter for body yaw smoothing
      let yawDiff = this.e1.y - this.currentBodyYaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      this.currentBodyYaw += yawDiff * 0.1; // Smooth body turning

      vrm.scene.rotation.y = this.currentBodyYaw + this.referenceBodyYawOffset;

      // Reset hips to reference before solving
      hipsNode.position.copy(this.referenceHipsLocalPos);

      // Anchor roughly to get bones in the right ballpark
      this.v2.copy(this.referenceHeadLocalPos).applyQuaternion(vrm.scene.quaternion);
      vrm.scene.position.set(
        targetHeadPos.x - this.v2.x,
        this.initialAvatarPos.y,
        targetHeadPos.z - this.v2.z,
      );

      this.setBoneWorldQuaternion(headNode, this.q1);

      // Spine Bending (VRChat / Warudo style distributed procedural bending)
      if (spineNode) {
          const torsoLocalQuat = vrm.scene.quaternion.clone().invert().multiply(this.q1);
          const identityQuat = new THREE.Quaternion();

          // Distribute rotation across the spine chain to prevent "stiff pole" syndrome
          spineNode.quaternion.copy(identityQuat.clone().slerp(torsoLocalQuat, 0.15));
          if (chestNode) chestNode.quaternion.copy(identityQuat.clone().slerp(torsoLocalQuat, 0.25));
          if (upperChestNode) upperChestNode.quaternion.copy(identityQuat.clone().slerp(torsoLocalQuat, 0.15));
          if (neckNode) neckNode.quaternion.copy(identityQuat.clone().slerp(torsoLocalQuat, 0.2));
      }

      // Precise Alignment
      vrm.scene.updateMatrixWorld(true);
      const actualHeadPos = new THREE.Vector3();
      headNode.getWorldPosition(actualHeadPos);

      // Fix X/Z offset exactly
      vrm.scene.position.x += (targetHeadPos.x - actualHeadPos.x);
      vrm.scene.position.z += (targetHeadPos.z - actualHeadPos.z);

      // Fix Y offset via Hips (Crouching)
      const yError = targetHeadPos.y - actualHeadPos.y;
      const newHipsY = this.referenceHipsLocalPos.y + yError;
      
      const maxHipsY = this.referenceHipsLocalPos.y;
      const minHipsY = this.referenceHipsLocalPos.y - 0.8; 
      hipsNode.position.y = Math.max(minHipsY, Math.min(maxHipsY, newHipsY));

      vrm.scene.updateMatrixWorld(true);
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
        this.v1.copy(this.controllerHandTargetOffsets[idx]);
        grip.localToWorld(this.v1);
        grip.getWorldQuaternion(this.q1);

        const camToHand = this.v1.clone().sub(cameraPos);
        camToHand.multiplyScalar(this.scaleFactor);
        const targetHandPos = targetHeadPos.clone().add(camToHand);

        const shoulderPos = new THREE.Vector3();
        upperNode.getWorldPosition(shoulderPos);

        const upperLen = lowerNode.position.length();
        const lowerLen = handNode.position.length();
        const reachVec = targetHandPos.clone().sub(shoulderPos);
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

        const elbowOut = bendNormal.clone().cross(reachDir).normalize().add(new THREE.Vector3(0, -0.25, 0)).normalize();
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
        handNode.getWorldQuaternion(this.q2);
        this.q2.slerp(this.q3, 0.45);
        this.setBoneWorldQuaternion(handNode, this.q2);
        const inputSource = this.getInputSourceByHandedness(idx === 0 ? 'left' : 'right');
        this.applyControllerFingerPose(vrm, inputSource, side);
      }
    });

    this.keepAvatarGrounded(vrm);

    // 3. FPV MESH HIDING
    if (this.currentVrm !== vrm) {
      this.currentVrm = vrm;
      this.headMeshes = [];

      if (vrm.firstPerson) {
        vrm.firstPerson.setup({ firstPersonOnlyLayer: 9, thirdPersonOnlyLayer: 10 });
      } else {
        vrm.scene.traverse(o => {
          if (o instanceof THREE.Mesh) {
            const n = o.name.toLowerCase();
            if (n.includes('head') || n.includes('face') || n.includes('hair') || n.includes('eye') || n.includes('mouth') || n.includes('brow')) {
              this.headMeshes.push(o);
            }
          }
        });
      }
    }

    const firstPersonOnlyLayer = vrm.firstPerson?.firstPersonOnlyLayer ?? 9;
    const thirdPersonOnlyLayer = vrm.firstPerson?.thirdPersonOnlyLayer ?? 10;

    this.snapshotCamera.layers.enable(0);
    this.snapshotCamera.layers.enable(thirdPersonOnlyLayer);
    this.snapshotCamera.layers.disable(firstPersonOnlyLayer);

    if (this.firstPersonMode) {
      camera.layers.enable(firstPersonOnlyLayer);
      camera.layers.disable(thirdPersonOnlyLayer);
      this.headMeshes.forEach((mesh) => mesh.layers.set(thirdPersonOnlyLayer));
    } else {
      camera.layers.disable(firstPersonOnlyLayer);
      camera.layers.enable(thirdPersonOnlyLayer);
      this.headMeshes.forEach((mesh) => mesh.layers.enable(0));
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
