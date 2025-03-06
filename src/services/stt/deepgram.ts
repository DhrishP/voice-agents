import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { EventEmitter } from "events";
import { STTProvider } from "../../providers/stt";

export class DeepgramService extends EventEmitter implements STTProvider {
  private deepgramClient: any;
  private connection: any;
  private isInitialized = false;

  constructor() {
    super();
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY is required in environment variables");
    }
    this.deepgramClient = createClient(apiKey);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.connection = this.deepgramClient.listen.live({
        model: "nova-2",
        language: "en-US",
        encoding: "mulaw",
        sample_rate: 8000,
        channels: 1,
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const transcript = data.channel?.alternatives[0]?.transcript;
        if (transcript && transcript.trim()) {
          this.emit("deepgramTranscript", transcript);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
        this.emit("deepgramError", error);
      });

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        this.isInitialized = true;
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        this.isInitialized = false;
      });
    } catch (error) {
      console.error("❌ Failed to initialize Deepgram connection:", error);
      throw error;
    }
  }

  async pipe(chunk: string): Promise<void> {
    if (!this.isInitialized || !this.connection) {
      await this.initialize();
    }

    try {
      this.connection.send(Buffer.from(chunk, "base64"));
    } catch (error) {
      this.emit("error", error);
    }
  }

  async close(): Promise<void> {
    if (this.connection) {
      this.connection.finish();
      this.isInitialized = false;
    }
  }
}
