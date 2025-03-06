import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { EventEmitter } from "events";
import { STTEvents, STTService } from "../../types/providers/stt";

export class DeepgramSTTService extends EventEmitter implements STTService {
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

  private onTranscription(text: string): void {
    this.emit("transcription", text);
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
          this.onTranscription(transcript);
        }
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
        console.error("❌ Deepgram STT Error:", error);
        this.emit("error", error);
      });

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log("🎙️ Deepgram STT: Connected");
        this.isInitialized = true;
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log("🎙️ Deepgram STT: Connection closed");
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
      console.error("❌ Error processing audio chunk:", error);
      this.emit("error", error as Error);
    }
  }

  async close(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.finish();
      } catch (error) {
        console.error("❌ Error closing STT connection:", error);
      } finally {
        this.connection = null;
        this.isInitialized = false;
      }
    }
  }
}
