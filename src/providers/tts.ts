import { EventEmitter } from "events";
import { DeepgramTTSService } from "../services/tts/deepgram";

export interface TTSEvents {
  chunk: (data: Buffer) => void;
  error: (error: Error) => void;
  close: () => void;
}

export interface TTSProvider {
  initialize(): Promise<void>;
  generate(text: string): Promise<string>;
  pipe(text: string): Promise<void>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
}

export default class TTSService extends EventEmitter {
  private provider: TTSProvider;

  constructor() {
    super();
    this.provider = new DeepgramTTSService();

    this.provider.on("chunk", (data: Buffer) => {
      this.onChunk(data);
    });

    this.provider.on("error", (error: Error) => {
      this.emit("error", error);
    });

    this.provider.on("close", () => {
      this.emit("close");
    });
  }

  private onChunk(data: Buffer): void {
    console.log("🔊 Audio chunk received");
    this.emit("chunk", data);
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
  }

  async generate(text: string): Promise<string> {
    return text;
  }

  async pipe(text: string): Promise<void> {
    try {
      await this.provider.pipe(text);
    } catch (error) {
      console.error("Error processing text:", error);
      this.emit("error", error as Error);
    }
  }

  async close(): Promise<void> {
    await this.provider.close();
  }
}
