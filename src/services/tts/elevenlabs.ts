import { EventEmitter } from "events";
import { TTSEvents, TTSService } from "../../types/providers/tts";
import { ElevenLabsClient } from "elevenlabs";

export class ElevenLabsTTSService extends EventEmitter implements TTSService {
  private client!: ElevenLabsClient;
  private isInitialized = false;
  private voiceId = "JBFqnCBsd6RMkjVDRZzb";
  private buffer: string = "";
  private bufferSize: number = 0;

  constructor() {
    super();
  }

  private onChunk(data: Buffer): void {
    console.log("🔊 Audio chunk received");
    this.emit("chunk", data);
  }

  async initialize(): Promise<void> {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error("ElevenLabs API key not found");
    }
    this.client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY,
    });
    this.isInitialized = true;
    console.log("🎙️ ElevenLabs TTS: Connected");
  }

  private async processAudioStream(audio: any) {
    try {
      for await (const chunk of audio) {
        this.onChunk(chunk);
      }
    } catch (error) {
      console.error("❌ ElevenLabs TTS Error:", error);
      this.emit("error", error as Error);
    }
  }

  async generate(text: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const audio = await this.client.textToSpeech.convert(this.voiceId, {
        model_id: "eleven_multilingual_v2",
        output_format: "ulaw_8000",
        text: text,
      });

      this.processAudioStream(audio).catch((error) => {
        console.error("Error processing audio stream:", error);
        this.emit("error", error as Error);
      });

      return text;
    } catch (error) {
      console.error("Error in ElevenLabs TTS:", error);
      this.emit("error", error as Error);
      throw error;
    }
  }

  async pipe(text: string): Promise<void> {
    if (this.bufferSize < 10) {
      this.buffer += text;
      this.bufferSize += 1;
      return;
    }
    await this.generate(text);
  }

  async close(): Promise<void> {
    this.isInitialized = false;
    this.emit("close");
  }
}
