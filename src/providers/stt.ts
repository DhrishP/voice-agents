import { EventEmitter } from "events";
import { DeepgramService } from "../services/stt/deepgram";
export interface STTEvents {
  transcription: (text: string) => void;
  error: (error: Error) => void;
}

export interface STTProvider {
  initialize(): Promise<void>;
  pipe(chunk: string): Promise<void>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
}

export default class STTService extends EventEmitter {
  private provider: STTProvider;

  constructor() {
    super();
    this.provider = new DeepgramService();

    this.provider.on("deepgramTranscript", (text: string) => {
      this.onTranscription(text);
    });

    this.provider.on("deepgramError", (error: Error) => {
      this.emit("error", error);
    });
  }

  private onTranscription(text: string): void {
    console.log("📝 Transcription received:", text);
    this.emit("transcription", text);
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
  }

  async pipe(chunk: string): Promise<void> {
    await this.provider.pipe(chunk);
  }

  async close(): Promise<void> {
    await this.provider.close();
  }
}
