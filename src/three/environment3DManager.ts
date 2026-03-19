import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { sceneManager } from './sceneManager';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Add BVH support to THREE
// @ts-ignore
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
// @ts-ignore
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

import { Node, NodeLoader } from './nodeLoader';
import { PhysicsLayers } from './physicsLayers';

// ======================
// Types & Configuration
// ======================

export interface Environment3DSettings {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // Euler degrees
  scale: number;
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface LoadedEnvironment {
  id: string;
  name: string;
  url: string;
  data?: string; // Base64 for persistence
  group: THREE.Group;
  rootNode: Node; // The root node after parsing
  settings: Environment3DSettings;
  colliders: THREE.Mesh[];
  rigidbodies: Node[];
  lods: Node[];
}

export const DEFAULT_ENV_3D_SETTINGS: Environment3DSettings = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1.0,
  visible: true,
  castShadow: false,
  receiveShadow: true,
};

// ======================
// Environment 3D Manager
// ======================

class Environment3DManager {
  private loader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private environments: Map<string, LoadedEnvironment> = new Map();
  private idCounter = 0;
  private onChangeCallbacks: Set<() => void> = new Set();

  constructor() {
    this.loader = new GLTFLoader();
    
    // Setup Draco decoder for compressed GLB files
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.dracoLoader.setDecoderConfig({ type: 'js' });
    this.loader.setDRACOLoader(this.dracoLoader);
  }

  /**
   * Subscribe to environment changes
   */
  onChange(callback: () => void): () => void {
    this.onChangeCallbacks.add(callback);
    return () => this.onChangeCallbacks.delete(callback);
  }

  private notifyChange() {
    this.onChangeCallbacks.forEach(cb => cb());
  }

  /**
   * Load a GLB file from URL or blob
   */
  async loadFromUrl(url: string, name?: string, base64Data?: string): Promise<LoadedEnvironment> {
    const scene = sceneManager.getScene();
    if (!scene) {
      throw new Error('Scene not initialized');
    }

    console.log('[Environment3D] Loading GLB:', url);

    // If no base64 data provided and it's a blob URL, we can't easily get it here without fetch
    // But for File uploads, loadFromFile handles it. 
    // For remote URLs, we might want to fetch it if we want to save it later.
    // For now, let's rely on loadFromFile or explicit base64 passing.

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const id = `env3d_${++this.idCounter}`;
          const group = new THREE.Group();
          group.name = `Environment3D_${id}`;
          
          // Add the loaded scene to our group
          group.add(gltf.scene);

          // Ground the model based on its bounding box
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          
          // Center on X and Z, but place bottom at Y=0
          gltf.scene.position.x -= center.x;
          gltf.scene.position.z -= center.z;
          gltf.scene.position.y -= box.min.y;
          
          // Calculate scale to fit reasonably in scene (target ~15 units max dimension for environments)
          const maxDim = Math.max(size.x, size.y, size.z);
          const targetSize = 15;
          let autoScale = maxDim > 0 ? targetSize / maxDim : 1;
          
          // If the model is already "human scale" (between 2m and 40m), keep it at 1:1
          if (maxDim > 2 && maxDim < 40) {
            autoScale = 1.0;
          }
          
          // Apply default settings
          const settings: Environment3DSettings = {
            ...DEFAULT_ENV_3D_SETTINGS,
            scale: autoScale,
          };

          const rootNode = NodeLoader.glbToNodes(gltf);
          const colliders: THREE.Mesh[] = [];
          const rigidbodies: Node[] = [];
          const lods: Node[] = [];

          // Setup shadows and extract metadata from nodes
          rootNode.traverse((node) => {
            const child = node.object3d;
            if (child instanceof THREE.Mesh) {
              child.castShadow = settings.castShadow;
              child.receiveShadow = settings.receiveShadow;
              
              // Generate BVH collider for each mesh if it's a collider node or environment
              if (child.geometry && (node.type === 'collider' || node.type === 'mesh')) {
                // @ts-ignore
                child.geometry.computeBoundsTree();
                colliders.push(child);
              }
            }

            if (node.type === 'rigidbody') {
              rigidbodies.push(node);
            }
            if (node.type === 'lod' || node.lod) {
              lods.push(node);
            }
          });

          // Add to scene
          scene.add(group);

          const environment: LoadedEnvironment = {
            id,
            name: name || this.extractName(url) || `Environment ${this.idCounter}`,
            url,
            data: base64Data,
            group,
            rootNode,
            settings,
            colliders,
            rigidbodies,
            lods
          };

          this.environments.set(id, environment);
          this.notifyChange();

          console.log('[Environment3D] Loaded successfully:', environment.name);
          resolve(environment);
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = (progress.loaded / progress.total) * 100;
            console.log(`[Environment3D] Loading: ${percent.toFixed(1)}%`);
          }
        },
        (error) => {
          console.error('[Environment3D] Failed to load:', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Load a GLB file from a File object
   */
  async loadFromFile(file: File): Promise<LoadedEnvironment> {
    const url = URL.createObjectURL(file);
    
    // Read file as base64 for persistence
    const base64Data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.readAsDataURL(file);
    });

    try {
      const env = await this.loadFromUrl(url, file.name.replace(/\.glb$/i, ''), base64Data);
      return env;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  /**
   * Load environment from base64 data (for project restore)
   */
  async loadFromData(base64: string | undefined, name: string, settings?: Environment3DSettings, url?: string): Promise<LoadedEnvironment> {
    let loadUrl: string;
    
    if (base64) {
        // Convert base64 to blob
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'model/gltf-binary' });
        loadUrl = URL.createObjectURL(blob);
    } else if (url) {
        loadUrl = url;
    } else {
        throw new Error('No data or URL provided for environment');
    }
    
    try {
      // Pass base64 if we have it, so it persists again if re-saved
      const env = await this.loadFromUrl(loadUrl, name, base64);
      
      // Restore settings if provided
      if (settings) {
        this.updateSettings(env.id, settings);
      }
      
      return env;
    } catch (error) {
      if (base64) URL.revokeObjectURL(loadUrl);
      throw error;
    }
  }

  /**
   * Extract a readable name from URL
   */
  private extractName(url: string): string {
    try {
      const urlObj = new URL(url, window.location.origin);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || '';
      return filename.replace(/\.glb$/i, '').replace(/[-_]/g, ' ');
    } catch {
      return '';
    }
  }

  /**
   * Apply settings to an environment group
   */
  private applySettings(group: THREE.Group, settings: Environment3DSettings) {
    group.position.set(settings.position.x, settings.position.y, settings.position.z);
    group.rotation.set(
      THREE.MathUtils.degToRad(settings.rotation.x),
      THREE.MathUtils.degToRad(settings.rotation.y),
      THREE.MathUtils.degToRad(settings.rotation.z)
    );
    group.scale.setScalar(settings.scale);
    group.visible = settings.visible;
  }

  /**
   * Update environment settings
   */
  updateSettings(id: string, newSettings: Partial<Environment3DSettings>) {
    const env = this.environments.get(id);
    if (!env) {
      console.warn('[Environment3D] Environment not found:', id);
      return;
    }

    env.settings = { ...env.settings, ...newSettings };
    this.applySettings(env.group, env.settings);

    // Update shadow settings if changed
    if (newSettings.castShadow !== undefined || newSettings.receiveShadow !== undefined) {
      env.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = env.settings.castShadow;
          child.receiveShadow = env.settings.receiveShadow;
        }
      });
    }

    this.notifyChange();
  }

  /**
   * Remove an environment
   */
  remove(id: string) {
    const env = this.environments.get(id);
    if (!env) {
      console.warn('[Environment3D] Environment not found:', id);
      return;
    }

    const scene = sceneManager.getScene();
    if (scene) {
      scene.remove(env.group);
    }

    // Dispose geometries and materials
    env.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });

    // Revoke blob URL if it was created from a file
    if (env.url.startsWith('blob:')) {
      URL.revokeObjectURL(env.url);
    }

    this.environments.delete(id);
    this.notifyChange();
    console.log('[Environment3D] Removed:', env.name);
  }

  /**
   * Remove all environments
   */
  removeAll() {
    const ids = Array.from(this.environments.keys());
    ids.forEach(id => this.remove(id));
  }

  /**
   * Get all loaded environments
   */
  getAll(): LoadedEnvironment[] {
    return Array.from(this.environments.values());
  }

  /**
   * Get serializeable data for all environments
   */
  getSerializeableData() {
    return Array.from(this.environments.values())
      .filter(env => env.data || !env.url.startsWith('blob:')) // Return if has data OR if it's a persistent URL (not blob)
      .map(env => ({
        id: env.id,
        name: env.name,
        data: env.data, // might be undefined
        url: !env.data ? env.url : undefined, // save URL if data is missing
        settings: env.settings
      }));
  }

  /**
   * Get a specific environment
   */
  get(id: string): LoadedEnvironment | undefined {
    return this.environments.get(id);
  }

  /**
   * Check if any environments are loaded
   */
  hasEnvironments(): boolean {
    return this.environments.size > 0;
  }

  /**
   * Get all active colliders from all visible environments
   */
  getAllColliders(): THREE.Mesh[] {
    const colliders: THREE.Mesh[] = [];
    this.environments.forEach(env => {
      if (env.settings.visible) {
        colliders.push(...env.colliders);
      }
    });
    return colliders;
  }

  /**
   * Set visibility of an environment
   */
  setVisible(id: string, visible: boolean) {
    this.updateSettings(id, { visible });
  }

  /**
   * Toggle visibility of an environment
   */
  toggleVisible(id: string) {
    const env = this.environments.get(id);
    if (env) {
      this.updateSettings(id, { visible: !env.settings.visible });
    }
  }

  /**
   * Dispose and cleanup
   */
  dispose() {
    this.removeAll();
    this.dracoLoader.dispose();
    this.onChangeCallbacks.clear();
  }
}

export const environment3DManager = new Environment3DManager();
