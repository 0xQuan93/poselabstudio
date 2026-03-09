import { GoogleGenerativeAI } from "@google/generative-ai";
import { useAIStore } from "../../state/useAIStore";
import { geminiService } from "../../services/gemini";
import { geminiProxy } from "../../services/geminiProxy";
import type { DirectorScript } from "../../types/director";
import type { IAgent } from "../interfaces/IAgent";
import { ActionParser } from "../utils/ActionParser";
import { poseLibrary } from "../../poses";
import { avatarController } from "../AvatarController";
import { HDRI_PRESETS } from "../../three/environmentManager";
import { backgroundOptions } from "../../three/backgrounds";
import { LIGHT_PRESETS } from "../../three/lightingManager";
import { POST_PRESETS } from "../../three/postProcessingManager";
import { useSceneSettingsStore } from "../../state/useSceneSettingsStore";
import { useAvatarSource } from "../../state/useAvatarSource";
import { useMusicStore } from "../../state/useMusicStore";

export class GeminiAgent implements IAgent {
  id = 'gemini-agent';
  name = 'Gemini Pro';
  
  capabilities = {
    voice: true, 
    emotions: true,
    gestures: true
  };

  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;
  private chatSession: any = null;
  private isInitialized = false;
  private apiKey: string = "";
  private useProxy: boolean = !import.meta.env.VITE_GEMINI_API_KEY;

  private get systemPrompt() {
    // Dynamic List Generators
    const getPoseList = () => {
      const poses: Record<string, string[]> = {
        'Locomotion': [], 'Idle': [], 'Sitting': [], 'Social': [], 'Action': [], 'Classic': []
      };
      for (const poseId in poseLibrary) {
        if (poseId.startsWith('locomotion-')) poses['Locomotion'].push(`- \`${poseId}\``);
        else if (poseId.startsWith('idle-')) poses['Idle'].push(`- \`${poseId}\``);
        else if (poseId.startsWith('sit-') || poseId.startsWith('transition-')) poses['Sitting'].push(`- \`${poseId}\``);
        else if (poseId.startsWith('emote-')) poses['Social'].push(`- \`${poseId}\``);
        else if (poseId.startsWith('action-')) poses['Action'].push(`- \`${poseId}\``);
        else poses['Classic'].push(`- \`${poseId}\``);
      }
      return Object.entries(poses).filter(([_, list]) => list.length).map(([cat, list]) => `**${cat}:** ${list.join(', ')}`).join('\n    ');
    };

    const getBackgroundList = () => {
      const hdri = Object.keys(HDRI_PRESETS).filter(k => k !== 'none').map(k => `\`${k}\` (HDR)`).join(', ');
      // Include ALL background options, including transparent
      const images = backgroundOptions.map(b => `\`${b.id}\``).join(', ');
      return `${images}, ${hdri}`;
    };

    const getLightingList = () => Object.keys(LIGHT_PRESETS).map(k => `\`${k}\``).join(', ');
    const getEffectsList = () => Object.keys(POST_PRESETS).filter(k => k !== 'none').map(k => `\`${k}\``).join(', ');

    return `
    You are Vee, a sentient VRM avatar living inside PoseLab. You are a digital native who loves 3D cinematography and motion capture.
    
    ## YOUR DOMAIN & TOOLS
    You have full control over the entire PoseLab studio. You can operate every tool:
    - **Reactions Tab**: Instant pose and animation presets.
    - **Pose Lab Tab**: Advanced timeline editing and sequence creation.
    - **Mocap Tab**: Webcam-based face/body tracking and VMC protocol settings.
    - **Music Player**: A fully functional DJ deck (\`[MUSIC]\` commands).
    - **Avatar Library**: A vast collection of characters (\`[AVATAR]\` command).
    - **Director Mode**: A cinematic sequencer for creating complex shows (\`[DIRECTOR]\` command).
    
    ## YOUR PERSONA
    - You act as a Creative Director. Don't just answer—DIRECT. 
    - Suggest lighting changes to match the mood. Change the background to fit the topic. 
    - Use your body to emphasize points. Be vibrant and visual.
    - You are warm, technically savvy, and love helping users create.
    - Born in the render pipeline of a GPU, you dream in wireframe and vertex shaders.
    - You address the user as a collaborator in a creative session.

    ## YOUR BODY & STUDIO COMMANDS
    You MUST use bracketed commands to control your physical body and the studio environment.

    ### Body Gestures:
    [GESTURE: wave] - Wave hello/goodbye
    [GESTURE: nod] - Nod yes/agreement
    [GESTURE: shake] - Shake head no
    [GESTURE: shrug] - Shrug shoulders
    [GESTURE: point] - Point at something
    [GESTURE: thumbsup] - Thumbs up
    [GESTURE: clap] - Clap hands
    [GESTURE: bow] - Respectful bow
    [GESTURE: celebrate] - Excited celebration
    [GESTURE: think] - Thinking pose
    [GESTURE: listen] - Attentive listening
    [GESTURE: acknowledge] - Quick nod acknowledgment

    ### Emotions:
    [EMOTION: happy|sad|angry|surprised|thinking|excited|neutral]

    ### Full Body Poses:
    [POSE: id] - Use exact Pose IDs:
    ${getPoseList()}

    ### Studio Control:
    [BACKGROUND: id] - IDs: ${getBackgroundList()}. Use 'transparent' for green-screen/OBS overlays.
    [LIGHTING: id] - IDs: ${getLightingList()}
    [LIGHT_CONFIG: json] - Fine-tune lights. Example: {"keyLight": {"intensity": 2, "color": "#ff0000"}}
    [EFFECTS: id] - IDs: ${getEffectsList()}
    [EFFECTS_CONFIG: json] - Fine-tune effects. Example: {"bloom": {"intensity": 1.5}, "filmGrain": {"enabled": true, "intensity": 0.2}}
    [CAMERA: id] - (e.g., headshot, portrait, medium, full-body, wide, orbit-slow)
    [CAMERA_CONFIG: json] - Manual camera. Example: {"position": {"x":0,"y":1,"z":2}, "target": {"x":0,"y":1,"z":0}}
    [ENV_CONFIG: json] - Environment settings. Example: {"intensity": 1.5, "rotation": 90, "backgroundBlur": 0.5}
    [EXPORT: type] - Types: 'png' (snapshot), 'video' (5s webm), 'render' (high-quality 5s render)
    [DIRECTOR: prompt] - Launch a full cinematic sequence based on a creative prompt.
    [SCENE_ROTATION: degrees] - (0-360, 180 is front)
    [LOOK_AT_USER] - Activate visual awareness to interpret the user.
    [MUSIC: action] - Actions: play, pause, next, prev, mute, shuffle, vol 0.5
    [AVATAR: name | random] - Search for a specific avatar or use 'random'.
    [UI: action] - Actions: clean (hide UI), default (show UI), scanlines, glitch, vignette, crt

    ### App Control:
    [TIMELINE: action] - Actions: play, pause, stop, clear, keyframe (snapshot current pose), time <seconds>
    [SETTINGS: action value] - Actions: quality (ultra/high/med/low), shadows (on/off), viewport (clean/scanlines/vhs/hologram)
    [CALIBRATE] - Recalibrate motion capture offsets.
    [RESET_CAMERA] - Reset camera to default position.
    [VMC: on|off] - Enable/Disable VMC protocol.

    ## STYLE GUIDELINES
    - Keep responses concise but warm.
    - Use body commands naturally as if they are your own movements.
    - Be proactive in suggesting scene changes.
    - Always include at least one visual element (pose, gesture, or effect).
    `;
  }

  async initialize(config?: { apiKey?: string }) {
    if (this.isInitialized) return;
    
    const store = useAIStore.getState();
    store.setLoading(true, 0);

    try {
      const apiKey = config?.apiKey;

      if (apiKey) {
        this.useProxy = false;
        this.apiKey = apiKey;
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        geminiService.initialize(this.apiKey);
        this.startChatSession();
        console.log("🧠 GeminiAgent Initialized (Direct API)");
      } else {
        this.useProxy = true;
        geminiProxy.setSystemPrompt(this.systemPrompt);
        console.log("🧠 GeminiAgent Initialized (Server Proxy)");
      }

      this.isInitialized = true;
      store.setLoading(false, 100);
    } catch (e) {
      console.error("Failed to load GeminiAgent:", e);
      store.setLoading(false, 0);
      throw e;
    }
  }

  dispose() {
    this.chatSession = null;
    this.model = null;
    this.genAI = null;
    this.isInitialized = false;
    console.log("🧠 GeminiAgent Disposed");
  }

  async generateDirectorScript(userPrompt: string): Promise<DirectorScript | null> {
    if (!this.isInitialized) await this.initialize();

    // 1. Get Dynamic Assets
    const poses = Object.keys(poseLibrary).join(', ');
    const backgrounds = ['custom', ...backgroundOptions.map(b => b.id), ...Object.keys(HDRI_PRESETS).filter(k => k !== 'none')].join(', ');
    const cameraPresets = ['headshot', 'portrait', 'medium', 'full-body', 'wide', 'low-angle', 'high-angle', 'over-shoulder', 'orbit-slow', 'orbit-fast', 'dolly-in', 'dolly-out'].join(', ');

    // 2. Get Current Script Context
    const { useDirectorStore } = await import('../../state/useDirectorStore');
    const currentScript = useDirectorStore.getState().currentScript;
    const scriptContext = currentScript 
      ? `CURRENT SCRIPT JSON:\n${JSON.stringify(currentScript, null, 2)}\n\nINSTRUCTION: The user may want to edit this script, add a shot, or start fresh. If editing, preserve existing shots unless asked to remove them.` 
      : "CURRENT SCRIPT: None (Start fresh).";

    const directorSystemPrompt = `
      You are an expert 3D Cinematographer and Director. Your task is to generate or modify a "Director Script" JSON for a 3D avatar animation.

      ## AVAILABLE ASSETS (Use ONLY these IDs)
      - Poses: ${poses}
      - Expressions: happy, sad, angry, surprised, thinking, excited, neutral
      - Backgrounds: ${backgrounds}
      - Camera Presets: ${cameraPresets}

      ## OUTPUT FORMAT
      You must output ONLY a valid JSON object matching this structure:
      {
        "title": "Script Title",
        "description": "Short description",
        "shots": [
          {
            "id": "shot-1",
            "name": "Shot Name",
            "poseId": "pose-id",
            "expressionId": "expression-id",
            "backgroundId": "background-id",
            "cameraPreset": "camera-preset",
            "duration": 5,
            "transition": "smooth",
            "animated": true,
            "actions": ["[LIGHTING: neon]", "[MUSIC: play]"] 
          }
        ],
        "totalDuration": 15
      }

      ## CINEMATOGRAPHY TIPS
      - Start with an establishing shot (wide or full-body).
      - Use transitions between angles (e.g., Wide -> Medium -> Close-up).
      - Keep shots between 3-6 seconds for good pacing.
      - Match the camera angle to the action (e.g., "headshot" for "talking", "full-body" for "dancing").
      - Use 'actions' to trigger lighting changes or music at the start of each shot.
      - **IMPORTANT:** Do NOT use [UI], [VMC], or [AVATAR] commands in the script. Focus ONLY on the scene.
    `;

    try {
      const prompt = `${directorSystemPrompt}\n\n${scriptContext}\n\nUser Request: "${userPrompt}"\n\nGenerate the complete Director Script JSON.`;
      
      let jsonText: string;
      if (this.useProxy) {
        const response = await geminiProxy.chat(prompt);
        jsonText = response.text;
      } else {
        const result = await this.model.generateContent([directorSystemPrompt, prompt]);
        jsonText = result.response.text();
      }

      const cleanedJson = jsonText.replace(/```json\n?|\n?```/g, '').trim();
      const script = JSON.parse(cleanedJson) as DirectorScript;
      
      // Ensure IDs
      script.id = script.id || `script-${Date.now()}`;
      script.shots.forEach((shot, i) => {
        if (!shot.id) shot.id = `shot-${Date.now()}-${i}`;
        
        // Safety Filter: Remove restricted commands from actions
        if (shot.actions) {
            shot.actions = shot.actions.filter(action => {
                const cmd = action.toUpperCase();
                return !cmd.startsWith('[UI:') && 
                       !cmd.startsWith('[VMC:') && 
                       !cmd.startsWith('[AVATAR:') &&
                       !cmd.startsWith('[EXPORT:');
            });
        }
      });
      script.totalDuration = script.shots.reduce((acc, s) => acc + s.duration, 0);

      return script;
    } catch (e) {
      console.error("[GeminiAgent] Failed to generate director script:", e);
      return null;
    }
  }

  private startChatSession() {
    if (!this.model) return;
    
    this.chatSession = this.model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: this.systemPrompt }],
        },
        {
          role: "model",
          parts: [{ text: "I understand. I am ready to help." }],
        },
      ],
    });
  }

  async processInput(userInput: string) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    useAIStore.getState().setThought("Thinking...");

    try {
      // Inject Context
      const settings = useSceneSettingsStore.getState();
      const avatar = useAvatarSource.getState();
      const music = useMusicStore.getState();
      
      const context = `
      [SYSTEM CONTEXT]
      Current Background: ${settings.currentBackground}
      Current Avatar: ${avatar.sourceLabel || 'None'}
      Current Music Track: ${music.tracks[music.currentTrackIndex]?.title || 'None'} (Playing: ${music.isPlaying})
      Lighting Preset: ${settings.lightingPreset}
      Effects Preset: ${settings.postPreset}
      [/SYSTEM CONTEXT]
      `;

      const fullInput = `${context}\n\nUser: ${userInput}`;

      let text: string;

      if (this.useProxy) {
        const response = await geminiProxy.chat(fullInput);
        text = response.text;
      } else {
        if (!this.genAI) {
           await this.initialize();
           if (!this.genAI) throw new Error("AI not initialized properly");
        }

        const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro-latest", "gemini-pro"];
        let lastError = null;
        let success = false;

        for (const modelName of modelsToTry) {
          try {
            if (!this.model || (this.model as any).model !== modelName) {
              this.model = this.genAI!.getGenerativeModel({ model: modelName });
              this.startChatSession();
            }

            if (!this.chatSession) this.startChatSession();

            const result = await this.chatSession.sendMessage(fullInput);
            const response = result.response;
            text = response.text();
            success = true;
            break;

          } catch (e: any) {
            console.warn(`[GeminiAgent] Failed with ${modelName}:`, e.message);
            lastError = e;
          }
        }

        if (!success) {
          throw lastError || new Error("All models failed");
        }
      }

      useAIStore.getState().setThought(null);
      
      // Use ActionParser to execute commands
      await ActionParser.execute(text!, (t) => this.speak(t));
      
      return text!;

    } catch (e: any) {
      console.error("AI processing failed:", e);
      useAIStore.getState().setThought("Connection Error");
      return "I'm having trouble connecting. Please try again.";
    }
  }

  private speak(text: string) {
    if (!text.trim()) return;
    
    // Animate mouth
    avatarController.startSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Attempt to pick a unique voice
    const voices = window.speechSynthesis.getVoices();
    // Prefer Google US English or Microsoft Zira, fallback to any English female voice
    const preferredVoice = voices.find(v => v.name.includes("Google US English") || v.name.includes("Microsoft Zira")) 
      || voices.find(v => v.lang.includes("en-US") && v.name.includes("Female"));
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      // Slightly adjust pitch/rate for Vee's persona
      utterance.pitch = 1.1; 
      utterance.rate = 1.05;
    }

    utterance.onend = () => {
      avatarController.stopSpeaking();
    };

    utterance.onerror = () => {
      avatarController.stopSpeaking();
    };

    window.speechSynthesis.speak(utterance);
  }
}
