import * as THREE from 'three';
import { PhysicsLayers } from './physicsLayers';

/**
 * Node Types supported in PoseLab (based on Hyperfy metadata)
 */
export type NodeType = 'group' | 'mesh' | 'skinnedmesh' | 'collider' | 'rigidbody' | 'lod' | 'snap' | 'trigger';

export interface NodeData {
  id: string;
  type: NodeType;
  object3d?: THREE.Object3D;
  position?: number[];
  quaternion?: number[];
  scale?: number[];
  userData?: any;
  physics?: {
    type?: 'static' | 'dynamic' | 'kinematic';
    mass?: number;
    layer?: number;
    trigger?: boolean;
    convex?: boolean;
  };
  lod?: {
    maxDistance: number;
  };
}

/**
 * Node system to manage objects parsed from GLB files with metadata
 */
export class Node {
  public id: string;
  public name: string;
  public type: NodeType;
  public object3d: THREE.Object3D;
  public parent: Node | null = null;
  public children: Node[] = [];
  public physics?: NodeData['physics'];
  public lod?: NodeData['lod'];

  constructor(data: NodeData) {
    this.id = data.id;
    this.name = data.id;
    this.type = data.type;
    this.object3d = data.object3d || new THREE.Group();
    this.object3d.name = this.id;
    this.physics = data.physics;
    this.lod = data.lod;

    if (data.position) this.object3d.position.fromArray(data.position);
    if (data.quaternion) this.object3d.quaternion.fromArray(data.quaternion);
    if (data.scale) this.object3d.scale.fromArray(data.scale);
  }

  add(child: Node) {
    this.children.push(child);
    child.parent = this;
    this.object3d.add(child.object3d);
  }

  traverse(callback: (node: Node) => void) {
    callback(this);
    this.children.forEach(child => child.traverse(callback));
  }

  get(id: string): Node | undefined {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.get(id);
      if (found) return found;
    }
    return undefined;
  }
}

/**
 * NodeLoader - parses GLB scenes into a Node tree based on Hyperfy-style userData
 */
export class NodeLoader {
  /**
   * Converts a Three.js scene (from GLTFLoader) into a Node tree
   */
  static glbToNodes(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): Node {
    const root = new Node({ id: '$root', type: 'group' });
    this.parse(gltf.scene.children, root, gltf.animations);
    return root;
  }

  private static parse(object3ds: THREE.Object3D[], parentNode: Node, animations: THREE.AnimationClip[]) {
    for (const object3d of object3ds) {
      const props = object3d.userData || {};
      
      let node: Node;

      // Detect special Hyperfy/Blender metadata nodes
      if (props.node === 'rigidbody') {
        node = new Node({
          id: object3d.name,
          type: 'rigidbody',
          object3d,
          physics: {
            type: props.type || 'dynamic',
            mass: props.mass || 1,
            layer: props.layer || PhysicsLayers.PROP,
          }
        });
      } else if (props.node === 'collider') {
        node = new Node({
          id: object3d.name,
          type: 'collider',
          object3d,
          physics: {
            type: 'static',
            trigger: props.trigger || false,
            convex: props.convex || false,
            layer: props.layer || PhysicsLayers.ENVIRONMENT,
          }
        });
      } else if (props.node === 'lod') {
        node = new Node({
          id: object3d.name,
          type: 'lod',
          object3d,
          lod: {
            maxDistance: props.maxDistance || 100
          }
        });
      } else if (props.node === 'snap') {
        node = new Node({
          id: object3d.name,
          type: 'snap',
          object3d
        });
      } else if (object3d instanceof THREE.Mesh) {
        node = new Node({
          id: object3d.name,
          type: 'mesh',
          object3d,
          lod: props.maxDistance ? { maxDistance: props.maxDistance } : undefined
        });
      } else {
        node = new Node({
          id: object3d.name,
          type: 'group',
          object3d
        });
      }

      if (node) {
        parentNode.add(node);
        this.parse(object3d.children, node, animations);
      }
    }
  }
}
