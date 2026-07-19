import type { IAgent } from "../interfaces/IAgent";
import { ActionParser } from "../utils/ActionParser";
import { useAIStore } from "../../state/useAIStore";

export class RemoteAgent implements IAgent {
  id = 'remote-agent';
  name = 'Remote Agent';

  capabilities = {
    voice: true,
    emotions: true,
    gestures: true
  };

  private endpoint: string = "";
  private apiKey: string = "";
  private isInitialized = false;

  async initialize(config: { endpoint: string, apiKey?: string, name?: string }) {
    if (!config?.endpoint) throw new Error("RemoteAgent requires an endpoint");
    
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey || "";
    if (config.name) this.name = config.name;
    
    this.isInitialized = true;
    console.log(`[RemoteAgent] Initialized connected to ${this.endpoint}`);
  }

  dispose() {
    this.isInitialized = false;
  }

  async processInput(text: string): Promise<string> {
    if (!this.isInitialized) throw new Error("Agent not initialized");

    useAIStore.getState().setThought("Thinking...");

    try {
      // Build headers object safely
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: text,
          userId: 'poselab-user',
          userName: 'User',
          roomId: 'poselab-default'
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      // Handle different response formats (Eliza, OpenAI, generic)
      const data = await response.json();
      let responseText = "";

      // 1. ElizaOS Standard (Array of messages)
      // Eliza returns: [{ user: "...", content: { text: "..." } }]
      if (Array.isArray(data)) {
        responseText = data.map(d => {
            if (typeof d === 'string') return d;
            if (d.content && d.content.text) return d.content.text;
            if (d.text) return d.text;
            return "";
        }).join('\n');
      } 
      // 2. Generic ({ response: "..." } or { text: "..." })
      else if (data.response) {
        responseText = data.response;
      } else if (data.text) {
        responseText = data.text;
      } else if (data.content) {
        responseText = data.content;
      } else {
        responseText = JSON.stringify(data);
      }

      useAIStore.getState().setThought(null);

      // Execute actions found in the response
      // A response from a configurable remote endpoint is never allowed to
      // initiate a camera-frame request.
      await ActionParser.execute(responseText, (t) => this.speak(t), { allowAiVisionCapture: false });
      
      return responseText;

    } catch (e: any) {
      console.error("[RemoteAgent] Error:", e);
      useAIStore.getState().setThought("Connection Failed");
      return `Error: ${e.message}`;
    }
  }

  private speak(text: string) {
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }
}
