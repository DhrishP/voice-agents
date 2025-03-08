import { EventEmitter } from "events";
import { TTSEvents, TTSService } from "../../types/providers/tts";
import WebSocket from "ws";
import eventBus from "../../engine";
import { convertWavToMulaw } from "../../utils/ffmpeg/convert/wav/mulaw";

export class SarvamTTSService implements TTSService {
  private ws: WebSocket | null = null;
  private isInitialized = false;
  private voiceId = "JBFqnCBsd6RMkjVDRZzb";
  private apiKey: string;
  private listenerCallback: ((data: Buffer) => void) | null = null;
  private id: string;
  private buffer: string = "";

  constructor(id: string) {
    this.id = id;
    this.apiKey = process.env.ELEVENLABS_API_KEY || "";
  }

  async initialize(): Promise<void> {
    if (!process.env.SARVAM_API_KEY) {
      throw new Error("Sarvam API key not found");
    }
    this.isInitialized = true;
    console.log("🎙️ Sarvam TTS: Connected");
  }

  async generate(text: string): Promise<string> {
    console.log("🎙️ Sarvam TTS: Generating audio for text:", text);
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const response = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": process.env.SARVAM_API_KEY || "",
        },
        body: JSON.stringify({
          speaker: "pavithra",
          loudness: 1,
          speech_sample_rate: "8000",
          enable_preprocessing: false,
          override_triplets: {},
          target_language_code: "hi-IN",
          model: "bulbul:v1",
          inputs: [text],
        }),
      });

      if (!response.ok) {
        throw new Error(`Sarvam API error: ${response.statusText}`);
      }

      const rsp = await response.json();
      const mulawBuffer = await convertWavToMulaw(rsp.audios[0]);
      if (this.listenerCallback) {
        this.listenerCallback(mulawBuffer);
      }

      eventBus.emit("call.audio.chunk.synthesized", {
        ctx: {
          callId: this.id,
          provider: "sarvam",
          timestamp: Date.now(),
        },
        data: { chunk: mulawBuffer.toString("base64") },
      });

      return text;
    } catch (error) {
      console.error("Error in Sarvam TTS:", error);
      throw error;
    }
  }

  async pipe(text: string): Promise<void> {
    if (text === "") {
      await this.generate(this.buffer);
      this.buffer = "";
    }

    this.buffer += text;
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
