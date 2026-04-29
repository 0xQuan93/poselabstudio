import { Application } from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';

// Ensure the Cubism Core is loaded
const CUBISM_CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';

export type Live2DLoadPayload = {
  manifestUrl: string;
  manifestPath: string; // Used for label/tracking
  label?: string;
};

type TickRegistrar = (handler: (delta: number) => void) => () => void;

class Live2DManager {
  private app?: Application;
  private model?: Live2DModel;
  private canvas?: HTMLCanvasElement;
  private hostCanvas?: HTMLCanvasElement;
  private tickRegistrar?: TickRegistrar;
  private tickDispose?: () => void;
  private resizeObserver?: ResizeObserver;
  // private _isLoaded = false;
  // private _currentPayload?: Live2DLoadPayload;
  
  // State tracking
  private physicsEnabled = true;
  private eyeTrackingEnabled = true; // Not fully implemented yet for mouse tracking, but flag exists
  // private _currentExpression?: string;

  constructor() {
    // Register the Ticker for shared updating if needed, 
    // but we usually prefer manual update via our main loop to sync with Three.js
    // @ts-ignore - Shim for Live2D ticker requirement
    Live2DModel.registerTicker(this.updateTicker);
  }

  // Shim to satisfy Live2DModel.registerTicker which expects a PIXI.Ticker-like object
  // We won't actually use this for timing, as we drive it from update()
  private updateTicker = {
    add: (_fn: any) => {},
    remove: (_fn: any) => {},
    start: () => {},
    stop: () => {}
  };

  async attachToCanvas(hostCanvas: HTMLCanvasElement, container: HTMLElement) {
    this.hostCanvas = hostCanvas;

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'absolute';
      this.canvas.style.inset = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.pointerEvents = 'none'; // Pass through clicks to 3D scene
      this.canvas.style.zIndex = '4'; // Above 3D scene
      container.appendChild(this.canvas);

      // Initialize Pixi Application
      this.app = new Application();
      await this.app.init({
        canvas: this.canvas,
        backgroundAlpha: 0, // Transparent
        autoStart: false,   // We drive the loop manually
        resizeTo: hostCanvas, // Auto resize to match host
      });
    }

    this.resizeToHost();

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.resizeToHost());
    this.resizeObserver.observe(hostCanvas);
  }

  setTickRegistrar(registrar: TickRegistrar) {
    this.tickRegistrar = registrar;
    // We always want the tick running if we are attached, to update Pixi
    this.startTick();
  }

  getCanvas() {
    return this.canvas;
  }

  async load(payload: Live2DLoadPayload) {
    await this.ensureCoreLoaded();

    if (!this.app) {
      console.error('[Live2DManager] Cannot load model: Pixi app not initialized');
      return;
    }

    try {
      console.log(`[Live2DManager] Loading model from: ${payload.manifestUrl}`);
      
      // Cleanup previous model
      if (this.model) {
        this.app.stage.removeChild(this.model as any);
        this.model.destroy();
        this.model = undefined;
      }

      // this._currentPayload = payload;
      
      // Load new model
      this.model = await Live2DModel.from(payload.manifestUrl);
      
      if (!this.model) {
        throw new Error('Failed to create Live2DModel');
      }

      this.app.stage.addChild(this.model as any);
      
      // Center and scale
      this.fitModelToScreen();
      
      // this._isLoaded = true;
      
      // Apply initial settings
      this.setPhysicsEnabled(this.physicsEnabled);
      
      console.log(`[Live2DManager] Model loaded: ${this.model.internalModel.settings.name}`);

    } catch (error) {
      console.error('[Live2DManager] Failed to load Live2D model:', error);
      // this._isLoaded = false;
    }
  }

  private fitModelToScreen() {
    if (!this.model || !this.app) return;
    
    const scaleX = (this.app.screen.width * 0.8) / this.model.width;
    const scaleY = (this.app.screen.height * 0.8) / this.model.height;
    const scale = Math.min(scaleX, scaleY);
    
    this.model.scale.set(scale);
    this.model.x = (this.app.screen.width - this.model.width) / 2;
    this.model.y = (this.app.screen.height - this.model.height) / 2;
  }

  setPose(_poseId: string) {
    // Live2D poses are usually handled via motion groups or .pose3.json
    // If poseId corresponds to a motion group (e.g. "Idle", "Tap"), we can play it
    if (this.model) {
        // Try to play as motion
        // this.model.motion(poseId);
        console.log('[Live2DManager] setPose not fully implemented for generic Live2D (depends on model structure)');
    }
  }

  setExpression(expressionId: string, _weight = 1) {
    if (!this.model) return;
    // this._currentExpression = expressionId;
    // Live2D expressions are triggered by ID
    this.model.expression(expressionId);
  }

  setPhysicsEnabled(enabled: boolean) {
    this.physicsEnabled = enabled;
    if (this.model && this.model.internalModel && this.model.internalModel.physics) {
       // @ts-ignore - internalModel typing varies
       this.model.internalModel.physics.enabled = enabled;
    }
  }

  setEyeTrackingEnabled(enabled: boolean) {
    this.eyeTrackingEnabled = enabled;
  }

  updateFaceModel(data: {
    head: { x: number; y: number; z: number };
    eye: { l: number; r: number };
    pupil: { x: number; y: number };
    mouth: { open: number };
  }) {
    if (!this.model || !this.eyeTrackingEnabled) return;

    // Helper to safely set parameter
    const setParam = (id: string, value: number) => {
        // @ts-ignore - internalModel typing
        if (this.model.internalModel && this.model.internalModel.coreModel) {
            // @ts-ignore
            this.model.internalModel.coreModel.setParameterValueById(id, value);
        }
    };

    // 1. Head Rotation (Live2D Standard: X=Yaw, Y=Pitch, Z=Roll)
    // Map:
    // Pitch (Head X) -> ParamAngleY
    // Yaw (Head Y)   -> ParamAngleX
    // Roll (Head Z)  -> ParamAngleZ
    if (data.head) {
        setParam('ParamAngleX', data.head.y); 
        setParam('ParamAngleY', data.head.x);
        setParam('ParamAngleZ', data.head.z);
    }

    // 2. Eye Openness (0.0 - 1.0)
    if (data.eye) {
        setParam('ParamEyeLOpen', data.eye.l);
        setParam('ParamEyeROpen', data.eye.r);
    }

    // 3. Eye Gaze (-1.0 - 1.0)
    if (data.pupil) {
        setParam('ParamEyeBallX', data.pupil.x);
        setParam('ParamEyeBallY', data.pupil.y);
    }

    // 4. Mouth Openness (0.0 - 1.0)
    if (data.mouth) {
        setParam('ParamMouthOpenY', data.mouth.open);
    }
  }

  update(delta: number) {
    if (!this.app || !this.model) return;
    
    // Update model with delta time (in ms for Pixi/Live2D)
    this.model.update(delta * 1000);
    
    // Render Pixi frame
    this.app.render();
  }

  dispose() {
    // this._isLoaded = false;
    this.tickDispose?.();
    this.tickDispose = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    
    if (this.model) {
      this.model.destroy();
      this.model = undefined;
    }
    
    if (this.app) {
      // PixiJS v8 destroy signature is different.
      // Calling destroy() with { removeView: true } or just using default arguments
      try {
        this.app.destroy({ removeView: false });
      } catch (e) {
        console.warn('[Live2DManager] Error destroying Pixi app:', e);
      }
      this.app = undefined;
    }
    
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = undefined;
    }
  }

  private startTick() {
    if (!this.tickRegistrar || this.tickDispose) return;
    this.tickDispose = this.tickRegistrar((delta) => this.update(delta));
  }

  private resizeToHost() {
    // Ensure the app and renderer are fully initialized before trying to resize
    if (!this.app || !this.app.renderer || !this.hostCanvas) return;
    
    const width = this.hostCanvas.clientWidth;
    const height = this.hostCanvas.clientHeight;
    
    if (width && height) {
        this.app.renderer.resize(width, height);
        this.fitModelToScreen();
    }
  }

  private async ensureCoreLoaded(): Promise<void> {
    if ((window as any).Live2DCubismCore) return;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CUBISM_CORE_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Live2D Cubism Core'));
      document.body.appendChild(script);
    });
  }
}

export const live2dManager = new Live2DManager();
