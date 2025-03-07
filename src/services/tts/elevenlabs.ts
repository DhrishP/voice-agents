import { EventEmitter } from "events";
import { TTSEvents, TTSService } from "../../types/providers/tts";
import WebSocket from "ws";

export class ElevenLabsTTSService extends EventEmitter implements TTSService {
  private ws: WebSocket | null = null;
  private isInitialized = false;
  private voiceId = "JBFqnCBsd6RMkjVDRZzb";
  private apiKey: string;
  private listenerCallback: ((data: Buffer) => void) | null = null;

  constructor() {
    super();

    this.apiKey = process.env.ELEVENLABS_API_KEY || "";
  }

  async initialize(): Promise<void> {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error("ElevenLabs API key not found");
    }
    await this.connectWebSocket();
    this.isInitialized = true;
    console.log("🎙️ ElevenLabs TTS: Connected");
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create WebSocket connection with query parameters
      this.ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?` +
          `output_format=ulaw_8000&model_id=eleven_multilingual_v2&inactivity_timeout=3600`
      );

      // Setup event handlers
      this.ws.on("open", () => {
        // Send initial configuration
        this.ws?.send(
          JSON.stringify({
            text: " ",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8,
              speed: 1,
            },
            "xi-api-key": this.apiKey,
          })
        );
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.audio) {
            if (this.listenerCallback) {
              this.onChunk(message.audio);
            }
            this.emit("chunk", message.audio);
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      });

      this.ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.emit("error", error);
        reject(error);
      });

      this.ws.on("close", () => {
        console.log("WebSocket connection closed");
        setTimeout(() => this.connectWebSocket(), 10);
      });
    });
  }

  async generate(text: string): Promise<string> {
    if (!this.isInitialized || !this.ws) {
      await this.initialize();
    }

    try {
      // Send the text to be converted
      this.ws?.send(
        JSON.stringify({
          text: text,
          try_trigger_generation: true,
        })
      );

      return text;
    } catch (error) {
      console.error("Error in ElevenLabs TTS:", error);
      this.emit("error", error as Error);
      throw error;
    }
  }

  async pipe(text: string): Promise<void> {
    await this.generate(text);
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isInitialized = false;
    this.emit("close");
  }

  public onChunk(callback: (data: Buffer) => void): void {
    this.listenerCallback = callback;
  }
}
