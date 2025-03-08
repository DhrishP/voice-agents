import { EventEmitter } from "events";
import { TTSEvents, TTSService } from "../../types/providers/tts";
import { createClient, LiveTTSEvents } from "@deepgram/sdk";
import eventBus from "../../engine";

export class DeepgramTTSService implements TTSService {
  private deepgramClient: any;
  private connection: any = null;
  private isInitialized = false;
  private listenerCallback: ((data: Buffer) => void) | null = null;
  private id: string;

  constructor(id: string) {
    this.id = id;
    if (!process.env.DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY is required in environment variables");
    }
    this.deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
  }

  onChunk(listenerCallback: (data: Buffer) => void): void {
    this.listenerCallback = listenerCallback;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.connection = this.deepgramClient.speak.live({
        model: "aura-asteria-en",
        encode: "mulaw",
        sampleRate: 8000,
      });

      this.connection.on(LiveTTSEvents.Open, () => {
        console.log("🎙️ Deepgram TTS: Connected");
        this.isInitialized = true;
      });

      this.connection.on(LiveTTSEvents.Audio, (data: Buffer) => {
        if (this.listenerCallback) {
          this.listenerCallback(data);
        }
        eventBus.emit("call.audio.chunk.synthesized", {
          ctx: {
            callId: this.id,
            provider: "deepgram",
            timestamp: Date.now(),
          },
          data: { chunk: data.toString("base64") },
        });
      });

      this.connection.on(LiveTTSEvents.Error, (error: Error) => {
        console.error("❌ Deepgram TTS Error:", error);
      });

      this.connection.on(LiveTTSEvents.Close, () => {
        console.log("🎙️ Deepgram TTS: Connection closed");
        this.isInitialized = false;
      });

      // Wait for connection to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 10000);

        this.connection.on(LiveTTSEvents.Open, () => {
          clearTimeout(timeout);
          resolve();
        });

        this.connection.on(LiveTTSEvents.Error, (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      console.error("❌ Failed to initialize Deepgram TTS connection:", error);
      throw error;
    }
  }

  async generate(text: string): Promise<string> {
    if (!this.isInitialized || !this.connection) {
      await this.initialize();
    }

    try {
      this.connection.sendText(text);
      // this.connection.flush();
      return text;
    } catch (error) {
      console.error("❌ Error processing text:", error);
      throw error;
    }
  }

  async pipe(text: string): Promise<void> {
    await this.generate(text);
  }

  async close(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.close();
      } catch (error) {
        console.error("❌ Error closing TTS connection:", error);
      } finally {
        this.connection = null;
        this.isInitialized = false;
      }
    }
  }
}
