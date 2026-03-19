import * as THREE from 'three';
import { environment3DManager } from './environment3DManager';

class CollisionManager {
  private raycaster = new THREE.Raycaster();
  private tempVec = new THREE.Vector3();
  private tempDown = new THREE.Vector3(0, -1, 0);

  /**
   * Find the ground height at a given world position
   * @returns The Y position of the ground, or null if no ground found
   */
  getGroundHeight(worldPos: THREE.Vector3, maxDistance = 5): number | null {
    const colliders = environment3DManager.getAllColliders();
    
    if (colliders.length === 0) return 0;

    this.tempVec.copy(worldPos);
    this.tempVec.y += 2.0;

    this.raycaster.set(this.tempVec, this.tempDown);
    this.raycaster.far = maxDistance + 5.0;

    const intersects = this.raycaster.intersectObjects(colliders, true);
    if (intersects.length > 0) {
      return intersects[0].point.y;
    }

    return null;
  }

  /**
   * Check for wall collisions in a direction
   */
  checkWallCollision(worldPos: THREE.Vector3, direction: THREE.Vector3, maxDistance = 0.5): number | null {
    const colliders = environment3DManager.getAllColliders();
    if (colliders.length === 0) return null;

    this.raycaster.set(worldPos, direction);
    this.raycaster.far = maxDistance;

    const intersects = this.raycaster.intersectObjects(colliders, true);
    if (intersects.length > 0) {
      return intersects[0].distance;
    }

    return null;
  }
}

export const collisionManager = new CollisionManager();
