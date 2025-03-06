import { EventEmitter } from "events";
import { TTSProvider } from "../../providers/tts";
import { ElevenLabsClient } from "elevenlabs";

export class ElevenLabsTTSService extends EventEmitter implements TTSProvider {
  private client!: ElevenLabsClient;
  private isInitialized = false;
  private voiceId = "JBFqnCBsd6RMkjVDRZzb";

  constructor() {
    super();
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
        this.emit("chunk", chunk);
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
        text: text,
        model_id: "eleven_multilingual_v2",
        output_format: "mp3_44100_128",
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
    await this.generate(text);
  }

  async close(): Promise<void> {
    this.isInitialized = false;
    this.emit("close");
  }
}
