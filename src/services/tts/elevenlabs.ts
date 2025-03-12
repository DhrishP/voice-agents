import { TTSService } from "../../types/providers/tts";
import WebSocket from "ws";
import eventBus from "../../engine";
export class ElevenLabsTTSService implements TTSService {
  private ws: WebSocket | null = null;
  private isInitialized = false;
  private voiceId: string;
  private apiKey: string;
  private listenerCallback: ((data: Buffer) => void) | null = null;
  private id: string;
  private language: string;

  constructor(id: string, language: string = "en-US") {
    this.id = id;
    this.language = language;
    this.voiceId =
      this.language === "hi" ? "Sxk6njaoa7XLsAFT7WcN" : "JBFqnCBsd6RMkjVDRZzb";
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
      this.ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?` +
          `output_format=ulaw_8000&model_id=eleven_multilingual_v2&inactivity_timeout=3600`
      );

      this.ws.on("open", () => {
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
            const audioBuffer = Buffer.from(message.audio, "base64");

            // console.log(
            //   `ElevenLabs audio chunk received: ${audioBuffer.length} bytes`
            // );

            if (this.listenerCallback) {
              this.listenerCallback(audioBuffer);
            }

            eventBus.emit("call.audio.chunk.synthesized", {
              ctx: {
                callId: this.id,
                provider: "elevenlabs",
                timestamp: Date.now(),
              },
              data: {
                chunk: message.audio, 
              },
            });
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      });

      this.ws.on("error", (error) => {
        console.error("WebSocket error:", error);
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
      this.ws?.send(
        JSON.stringify({
          text: text,
          try_trigger_generation: true,
          language: this.language === "hi" ? "hi" : "en-US",
        })
      );

      return text;
    } catch (error) {
      console.error("Error in ElevenLabs TTS:", error);
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
  }

  public onChunk(listenerCallback: (data: Buffer) => void): void {
    this.listenerCallback = listenerCallback;
  }
}
