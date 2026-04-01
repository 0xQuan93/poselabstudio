import * as THREE from 'three';
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * Utility to calculate an accurate bounding box for a VRM or SkinnedMesh
 * by accounting for bone positions, avoiding the 'bind-pose' limitation of Box3.setFromObject
 */
export function getAccurateVRMBounds(vrm: VRM): THREE.Box3 {
  const box = new THREE.Box3();
  const tempVec = new THREE.Vector3();
  
  if (!vrm.humanoid) {
    return box.setFromObject(vrm.scene);
  }

  // Iterate through all bones and expand the box
  const boneNames = Object.values(VRMHumanBoneName);
  let hasPoints = false;

  boneNames.forEach((name) => {
    const node = vrm.humanoid?.getNormalizedBoneNode(name);
    if (node) {
      node.getWorldPosition(tempVec);
      box.expandByPoint(tempVec);
      hasPoints = true;
    }
  });

  if (!hasPoints) {
    return box.setFromObject(vrm.scene);
  }

  // Add specific padding for common VRM elements that bones don't cover
  // (Hair, clothing, shoes, skin thickness)
  // These are standard offsets derived from common VRM rig proportions
  box.min.y -= 0.35; // Sole/Shoe padding
  box.max.y += 0.50; // Head/Hair padding
  box.min.x -= 0.35; // Arm/Skin padding
  box.max.x += 0.35;
  box.min.z -= 0.35;
  box.max.z += 0.35;

  return box;
}

/**
 * Enhanced frame logic for any object, with special handling for VRMs
 */
export function getObjectBounds(object: THREE.Object3D): THREE.Box3 {
  // Check if it's a VRM
  if (object.userData?.vrm) {
    return getAccurateVRMBounds(object.userData.vrm);
  }

  // Fallback to standard Three.js bounds for static objects
  // (SkinnedMeshes will still have bind-pose issues here, but for now
  // we prioritize VRMs as they are the primary animated objects)
  const box = new THREE.Box3().setFromObject(object);
  return box;
}
