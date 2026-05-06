import * as THREE from 'three';
import { TransformControls } from 'three-stdlib';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { sceneManager } from './sceneManager';
import { avatarManager } from './avatarManager';

const CONTROL_BONES: VRMHumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot
];

class InteractionManager {
  private transformControls?: TransformControls;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private boneHelpers: THREE.Mesh[] = [];
  private isEnabled = false;
  private boundOnPointerDown: (event: PointerEvent) => void;

  constructor() {
    this.boundOnPointerDown = this.onPointerDown.bind(this);
  }

  get enabled() {
    return this.isEnabled;
  }

  init() {
    const camera = sceneManager.getCamera();
    const renderer = sceneManager.getRenderer();
    const scene = sceneManager.getScene();
    
    if (!camera || !renderer || !scene) return;

    if (this.transformControls) {
        this.transformControls.dispose();
        this.transformControls.removeFromParent();
    }

    this.transformControls = new TransformControls(camera, renderer.domElement);
    
    // @ts-expect-error - fix type error
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      const orbit = sceneManager.getControls();
      if (orbit) orbit.enabled = !event.value;
      avatarManager.setInteraction(event.value);
      
      // When dragging ends (event.value = false), save the Hips rotation
      // This captures any manual rotation adjustments made with the gizmo
      if (!event.value) {
        avatarManager.saveLockedHipsRotation();
      }
    });
    
    this.transformControls.setMode('rotate');
    this.transformControls.setSpace('local');
    
    scene.add(this.transformControls);
  }

  setGizmoMode(mode: 'translate' | 'rotate') {
    if (this.transformControls) {
      this.transformControls.setMode(mode);
    }
  }
  
  setGizmoSpace(space: 'local' | 'world') {
    if (this.transformControls) {
      this.transformControls.setSpace(space);
    }
  }

  toggle(enable: boolean) {
    if (this.isEnabled === enable) return;
    this.isEnabled = enable;
    
    const renderer = sceneManager.getRenderer();
    
    if (enable) {
      this.init();
      this.createBoneHelpers();
      renderer?.domElement.addEventListener('pointerdown', this.boundOnPointerDown);
    } else {
      this.removeBoneHelpers();
      if (this.transformControls) {
          this.transformControls.detach();
          this.transformControls.removeFromParent();
          this.transformControls.dispose();
          this.transformControls = undefined;
      }
      renderer?.domElement.removeEventListener('pointerdown', this.boundOnPointerDown);
    }
  }

  private createBoneHelpers() {
    const vrm = avatarManager.getVRM();
    if (!vrm || !vrm.humanoid) return;

    const geometry = new THREE.SphereGeometry(0.02, 8, 8); // Smaller helpers
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffd6,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.4,
    });

    CONTROL_BONES.forEach((boneName) => {
      const node = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (node) {
        const helper = new THREE.Mesh(geometry, material.clone());
        helper.userData = { isBoneHelper: true, boneName, boneNode: node };
        node.add(helper);
        this.boneHelpers.push(helper);
      }
    });
  }

  private removeBoneHelpers() {
    this.boneHelpers.forEach((h) => {
      if (h.parent) h.parent.remove(h);
      h.geometry.dispose();
      (h.material as THREE.Material).dispose();
    });
    this.boneHelpers = [];
  }

  private onPointerDown(event: PointerEvent) {
    if (!this.isEnabled || !this.transformControls) return;

    const canvas = sceneManager.getCanvas();
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = sceneManager.getCamera();
    if (!camera) return;

    this.raycaster.setFromCamera(this.mouse, camera);
    const intersects = this.raycaster.intersectObjects(this.boneHelpers, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object as THREE.Mesh;
      const { boneNode, boneName } = hit.userData;
      
      this.transformControls.attach(boneNode);
      
      // Enforce rotation for non-hips
      if (boneName !== VRMHumanBoneName.Hips) {
          this.transformControls.setMode('rotate');
      }

      this.boneHelpers.forEach(h => (h.material as THREE.MeshBasicMaterial).color.setHex(0x00ffd6));
      (hit.material as THREE.MeshBasicMaterial).color.setHex(0xff0055);
    } else {
      // Small delay to allow gizmo click
      setTimeout(() => {
          // @ts-expect-error - fix type error
          if (this.transformControls && !this.transformControls.dragging) {
              this.transformControls.detach();
              this.boneHelpers.forEach(h => (h.material as THREE.MeshBasicMaterial).color.setHex(0x00ffd6));
          }
      }, 50);
    }
  }

  update() {}

  dispose() {
    this.toggle(false);
  }
}

export const interactionManager = new InteractionManager();
