import * as THREE from 'three';
import type { BackgroundId } from '../types/reactions';
import { GifTexture } from './GifTexture';

type BackgroundDefinition = {
  id: BackgroundId;
  label: string;
  color: THREE.ColorRepresentation;
  image?: string; // Optional: path to background image
  gradient?: {
    type: 'linear' | 'radial';
    colors: string[];
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// High-Resolution SVG Loader
// Renders SVGs to canvas at 4K resolution for crisp backgrounds
// ═══════════════════════════════════════════════════════════════════════════
const SVG_RENDER_WIDTH = 3840;  // 4K width
const SVG_RENDER_HEIGHT = 2160; // 4K height

async function loadSVGAsHighResTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      // Create high-resolution canvas
      const canvas = document.createElement('canvas');
      canvas.width = SVG_RENDER_WIDTH;
      canvas.height = SVG_RENDER_HEIGHT;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      // Enable high-quality rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Draw SVG scaled to fill canvas
      ctx.drawImage(img, 0, 0, SVG_RENDER_WIDTH, SVG_RENDER_HEIGHT);
      
      // Create texture from canvas
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false; // Not needed for backgrounds
      texture.needsUpdate = true;
      
      console.log(`[Background] SVG rendered at ${SVG_RENDER_WIDTH}x${SVG_RENDER_HEIGHT}:`, url);
      resolve(texture);
    };
    
    img.onerror = (error) => {
      reject(error);
    };
    
    img.src = url;
  });
}

const backgroundDefinitions: BackgroundDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // V2 Lightweight Vector Backgrounds (1-5KB each)
  // Brand-aligned with signal green (#00ffd6) and violet (#7c3aed)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'synthwave-grid',
    label: 'Synthwave Grid',
    color: '#030305',
    image: '/backgrounds/v2/synthwave-grid.svg',
  },
  {
    id: 'neural-circuit',
    label: 'Neural Circuit',
    color: '#030305',
    image: '/backgrounds/v2/neural-circuit.svg',
  },
  {
    id: 'neon-waves',
    label: 'Neon Waves',
    color: '#030305',
    image: '/backgrounds/v2/neon-waves.svg',
  },
  {
    id: 'quantum-particles',
    label: 'Quantum Particles',
    color: '#030305',
    image: '/backgrounds/v2/quantum-particles.svg',
  },
  {
    id: 'signal-glitch',
    label: 'Signal Glitch',
    color: '#050305',
    image: '/backgrounds/v2/signal-glitch.svg',
  },
  {
    id: 'cyber-hexagons',
    label: 'Cyber Hexagons',
    color: '#030305',
    image: '/backgrounds/v2/cyber-hexagons.svg',
  },
  {
    id: 'protocol-gradient',
    label: 'Protocol Gradient',
    color: '#030305',
    image: '/backgrounds/v2/protocol-gradient.svg',
  },
  {
    id: 'void-minimal',
    label: 'Void (Minimal)',
    color: '#030305',
    image: '/backgrounds/v2/void-minimal.svg',
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // Utility Backgrounds
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'green-screen',
    label: 'Green Screen',
    color: '#00ff00',
  },
  {
    id: 'transparent',
    label: 'Transparent',
    color: 'transparent', // Logic handled in applyBackground
  },
];

// Cache loaded textures
const textureCache = new Map<string, THREE.Texture>();
const textureLoader = new THREE.TextureLoader();

export interface AnimatedBackground {
  texture: THREE.Texture;
  update: (delta: number) => void;
  dispose: () => void;
}

export function getBackgroundDefinition(id: BackgroundId | string): BackgroundDefinition {
  if (id.startsWith('blob:') || id.startsWith('data:')) {
    return {
      id: id as BackgroundId,
      label: 'Custom Background',
      color: '#000000',
      image: id
    };
  }
  return backgroundDefinitions.find((entry) => entry.id === id) ?? backgroundDefinitions[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// Lab 3D Environment (Cyclorama)
// ═══════════════════════════════════════════════════════════════════════════
const STUDIO_MESH_NAME = 'Project89_Lab_Environment';

function getOrCreateStudioMesh(scene: THREE.Scene): THREE.Group {
  let group = scene.getObjectByName(STUDIO_MESH_NAME) as THREE.Group;
  if (!group) {
    group = new THREE.Group();
    group.name = STUDIO_MESH_NAME;
    
    // Create a large cylindrical cyclorama for the background image
    const geometry = new THREE.CylinderGeometry(15, 15, 20, 64, 1, true);
    const material = new THREE.MeshBasicMaterial({ 
      side: THREE.BackSide,
      toneMapped: false // keep colors pure like the UI
    });
    const cyclorama = new THREE.Mesh(geometry, material);
    cyclorama.name = 'Cyclorama';
    cyclorama.position.y = 5; // lift up slightly
    cyclorama.scale.x = -1; // Flip horizontally so BackSide textures read correctly
    
    // Create a glossy/tech floor
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.MeshStandardMaterial({ 
      color: 0x0a0a0a,
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      opacity: 0.95
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    
    // Create a strict architectural grid on the floor
    const grid = new THREE.GridHelper(30, 30, 0x00ffd6, 0x22222a);
    grid.position.y = 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    
    group.add(cyclorama);
    group.add(floor);
    group.add(grid);

    scene.add(group);
  }
  return group;
}

function applyTextureToStudio(scene: THREE.Scene, texture: THREE.Texture | null, color: THREE.Color | null) {
  const group = getOrCreateStudioMesh(scene);
  const cyclorama = group.getObjectByName('Cyclorama') as THREE.Mesh;
  const material = cyclorama.material as THREE.MeshBasicMaterial;
  
  if (texture) {
    material.map = texture;
    material.color.setHex(0xffffff);
    material.needsUpdate = true;
    group.visible = true;
  } else if (color) {
    material.map = null;
    material.color.copy(color);
    material.needsUpdate = true;
    group.visible = true;
  } else {
    // Transparent case
    group.visible = false;
  }
}

export function toggleLabEnvironment(scene: THREE.Scene, visible: boolean) {
  const group = scene.getObjectByName(STUDIO_MESH_NAME) as THREE.Group;
  if (group) {
    group.visible = visible;
  }
}

export async function applyBackground(scene: THREE.Scene, id: BackgroundId | string): Promise<AnimatedBackground | null> {
  // Always clear the actual scene.background so our 3D lab environment is visible
  scene.background = null;

  // Special case for Transparent
  if (id === 'transparent') {
    applyTextureToStudio(scene, null, null);
    console.log('[Background] Applied transparent (hid Lab environment)');
    return null;
  }

  const definition = getBackgroundDefinition(id);
  
  // Note: We don't clear scene.environment here anymore, to allow mixing Backgrounds with HDRI lighting.

  // Try to load image if specified
  if (definition.image) {
    try {
      const imageUrl = definition.image;
      let mimeType = '';

      // Extract mime type from blob URL or data URL
      if (imageUrl.startsWith('blob:') && imageUrl.includes('#type=')) {
        mimeType = imageUrl.split('#type=')[1];
      } else if (imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:([^;]+);/);
        if (match) mimeType = match[1];
      }

      // Handle GIF
      if (mimeType.includes('gif')) {
        console.log('[Background] Detected GIF:', imageUrl);
        const gifTexture = new GifTexture();
        await gifTexture.load(imageUrl);
        applyTextureToStudio(scene, gifTexture.texture, null);
        
        return {
          texture: gifTexture.texture,
          update: (delta) => gifTexture.update(delta),
          dispose: () => gifTexture.dispose()
        };
      }
      
      // Handle Video
      if (mimeType.includes('video') || mimeType.includes('mp4') || mimeType.includes('webm') || 
          imageUrl.toLowerCase().endsWith('.mp4') || imageUrl.toLowerCase().endsWith('.webm')) {
        console.log('[Background] Detected Video:', imageUrl);
        const video = document.createElement('video');
        video.src = imageUrl;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.play().catch(e => console.warn('[Background] Video autoplay failed:', e));
        
        const videoTexture = new THREE.VideoTexture(video);
        videoTexture.colorSpace = THREE.SRGBColorSpace;
        applyTextureToStudio(scene, videoTexture, null);
        
        return {
          texture: videoTexture,
          update: () => {}, // VideoTexture updates automatically
          dispose: () => {
            video.pause();
            video.src = '';
            videoTexture.dispose();
          }
        };
      }

      // Standard Image Loading
      let texture = textureCache.get(imageUrl);
      
      if (!texture) {
        console.log('[Background] Loading image:', imageUrl);
        
        // Use high-res SVG loader for SVG files
        const isSVG = imageUrl.toLowerCase().includes('.svg') || mimeType.includes('svg');
        
        if (isSVG) {
          texture = await loadSVGAsHighResTexture(imageUrl);
        } else {
          texture = await new Promise<THREE.Texture>((resolve, reject) => {
            textureLoader.load(
              imageUrl,
              (loadedTexture) => {
                loadedTexture.colorSpace = THREE.SRGBColorSpace;
                resolve(loadedTexture);
              },
              undefined,
              (error) => {
                console.warn('[Background] Failed to load image:', imageUrl, error);
                reject(error);
              }
            );
          });
        }
        
        textureCache.set(imageUrl, texture);
      }
      
      applyTextureToStudio(scene, texture, null);
      console.log('[Background] Applied image to Lab:', imageUrl);
      return null;
    } catch (error) {
      console.warn('[Background] Image load failed, using color fallback', error);
    }
  }
  
  // Fallback to solid color
  applyTextureToStudio(scene, null, new THREE.Color(definition.color));
  console.log('[Background] Applied color to Lab:', definition.color);
  return null;
}

export const backgroundOptions = backgroundDefinitions;