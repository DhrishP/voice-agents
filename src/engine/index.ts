import eventBus from "../events";
import { VoiceCallJobData } from "../types";
import { DeepgramSTTService } from "../services/stt/deepgram";
import { OpenAIService } from "../services/ai/openai";
import { DeepgramTTSService } from "../services/tts/deepgram";
import {
  AIService,
  STTService,
  TTSService,
  TelephonyProvider,
} from "../types/providers";
import twilioOperator from "../services/telephony/twillio/operator";
import { ElevenLabsTTSService } from "../services/tts/elevenlabs";

const sttEngines: Record<string, STTService> = {};
const ttsEngines: Record<string, TTSService> = {};
const telephonyEngines: Record<string, TelephonyProvider> = {};
const llmEngines: Record<string, AIService> = {};

class PhoneCall {
  id: string;
  sttEngine: STTService | null;
  llmEngine: AIService | null;
  ttsEngine: TTSService | null;
  telephonyEngine: TelephonyProvider | null;

  payload: VoiceCallJobData;

  constructor(id: string, payload: VoiceCallJobData) {
    this.id = id;
    this.sttEngine = null;
    this.llmEngine = null;
    this.ttsEngine = null;
    this.telephonyEngine = null;
    this.payload = payload;
  }

  async initialize() {
    // Initialize Telephony
    if (this.payload.telephonyProvider === "twilio") {
      const callId = await twilioOperator.call(
        this.payload.fromNumber,
        this.payload.toNumber
      );

      const phoneCall = await twilioOperator.getPhoneCall(callId);
      this.telephonyEngine = phoneCall;
      telephonyEngines[this.id] = phoneCall;

      phoneCall.onListen((chunk) => {
        eventBus.emit("call.audio.chunk.received", {
          ctx: {
            callId: this.id,
            provider: this.payload.telephonyProvider,
            timestamp: Date.now(),
          },
          data: { chunk, direction: "inbound" },
        });
      });
    } else {
      throw new Error("Invalid telephony provider");
    }

    // Initialize STT
    if (this.payload.sttProvider === "deepgram") {
      const sttEngine = new DeepgramSTTService();
      await sttEngine.initialize();

      this.sttEngine = sttEngine;
      sttEngines[this.id] = sttEngine;

      sttEngine.on("transcription", (transcript: string) => {
        console.log("📝 Transcription received:", transcript);
        eventBus.emit("call.transcription.chunk.created", {
          ctx: {
            callId: this.id,
            provider: this.payload.sttProvider,
            timestamp: Date.now(),
          },
          data: { transcription: transcript },
        });
      });

      sttEngine.on("error", (error: Error) => {
        console.error("❌ STT Error:", error);
        eventBus.emit("call.error", {
          ctx: {
            callId: this.id,
            provider: this.payload.sttProvider,
            timestamp: Date.now(),
          },
          error,
        });
      });
    } else {
      throw new Error("Invalid STT provider");
    }

    if (this.payload.llmProvider === "openai") {
      const llmEngine = new OpenAIService();
      await llmEngine.initialize();

      this.llmEngine = llmEngine;
      llmEngines[this.id] = llmEngine;

      llmEngine.on("chunk", (text: string) => {
        console.log("🤖 AI response chunk:", text);
        eventBus.emit("call.response.chunk.generated", {
          ctx: {
            callId: this.id,
            provider: "openai",
            timestamp: Date.now(),
          },
          data: { text },
        });
      });

      llmEngine.on("error", (error: Error) => {
        console.error("❌ LLM Error:", error);
        eventBus.emit("call.error", {
          ctx: {
            callId: this.id,
            provider: "openai",
            timestamp: Date.now(),
          },
          error,
        });
      });
    } else {
      throw new Error("Invalid LLM provider");
    }

    if (this.payload.ttsProvider === "deepgram") {
      const ttsEngine = new DeepgramTTSService();
      await ttsEngine.initialize();

      this.ttsEngine = ttsEngine;
      ttsEngines[this.id] = ttsEngine;

      ttsEngine.on("chunk", (audioChunk: Buffer) => {
        console.log("🔊 TTS audio chunk generated:", {
          size: audioChunk.length,
          type: audioChunk.constructor.name,
          firstFewBytes: audioChunk.slice(0, 20).toString("hex"),
        });
        eventBus.emit("call.audio.chunk.synthesized", {
          ctx: {
            callId: this.id,
            provider: "deepgram",
            timestamp: Date.now(),
          },
          data: { chunk: audioChunk.toString("base64") },
        });
      });

      ttsEngine.on("error", (error: Error) => {
        console.error("❌ TTS Error:", error);
        eventBus.emit("call.error", {
          ctx: {
            callId: this.id,
            provider: "deepgram",
            timestamp: Date.now(),
          },
          error,
        });
      });
    } else if (this.payload.ttsProvider === "elevenlabs") {
      const ttsEngine = new ElevenLabsTTSService();
      await ttsEngine.initialize();

      this.ttsEngine = ttsEngine;
      ttsEngines[this.id] = ttsEngine;

      ttsEngine.on("chunk", (audioChunk: Buffer) => {
        console.log("🔊 TTS audio chunk generated:", {
          size: audioChunk.length,
          type: audioChunk.constructor.name,
          firstFewBytes: audioChunk.slice(0, 20).toString("hex"),
        });
        eventBus.emit("call.audio.chunk.synthesized", {
          ctx: {
            callId: this.id,
            provider: "elevenlabs",
            timestamp: Date.now(),
          },
          data: { chunk: audioChunk.toString("base64") },
        });
      });

      ttsEngine.on("error", (error: Error) => {
        console.error("❌ TTS Error:", error);
        eventBus.emit("call.error", {
          ctx: {
            callId: this.id,
            provider: "elevenlabs",
            timestamp: Date.now(),
          },
          error,
        });
      });
    } else {
      throw new Error("Invalid TTS provider");
    }
  }

  async cleanup() {
    if (this.sttEngine) {
      await this.sttEngine.close();
      delete sttEngines[this.id];
    }
    if (this.ttsEngine) {
      await this.ttsEngine.close();
      delete ttsEngines[this.id];
    }
    if (this.telephonyEngine) {
      await this.telephonyEngine.hangup();
      delete telephonyEngines[this.id];
    }
    delete llmEngines[this.id];
  }
}

// Event handlers
eventBus.on("call.initiated", async (event) => {
  const { ctx, payload } = event;
  const engine = new PhoneCall(ctx.callId, payload);
  await engine.initialize();
});

eventBus.on("call.audio.chunk.received", async (event) => {
  const { ctx, data } = event;
  const engine = sttEngines[ctx.callId];
  if (engine) {
    await engine.pipe(data.chunk);
  } else {
    console.log("⚠️ No STT engine found for call", ctx.callId);
  }
});

eventBus.on("call.transcription.chunk.created", async (event) => {
  const { ctx, data } = event;
  const engine = llmEngines[ctx.callId];
  if (engine) {
    await engine.pipe(data.transcription);
  } else {
    console.log("⚠️ No LLM engine found for call", ctx.callId);
  }
});

eventBus.on("call.response.chunk.generated", async (event) => {
  const { ctx, data } = event;
  const engine = ttsEngines[ctx.callId];
  if (engine) {
    await engine.pipe(data.text);
  } else {
    console.log("⚠️ No TTS engine found for call", ctx.callId);
  }
});

eventBus.on("call.audio.chunk.synthesized", async (event) => {
  const { ctx, data } = event;
  const engine = telephonyEngines[ctx.callId];
  if (engine) {
    const audioChunk = data.chunk;
    console.log("🔊 Audio chunk details before sending:", {
      isBase64:
        typeof audioChunk === "string" && /^[A-Za-z0-9+/=]+$/.test(audioChunk),
      type: typeof audioChunk,
      constructor: audioChunk.constructor.name,
      size:
        typeof audioChunk === "string"
          ? audioChunk.length
          : (audioChunk as Buffer).length,
      firstFewBytes:
        typeof audioChunk === "string"
          ? audioChunk.slice(0, 20)
          : Buffer.from(audioChunk).slice(0, 20).toString("hex"),
    });
    await engine.send(audioChunk);
  } else {
    console.log("⚠️ No telephony engine found for call", ctx.callId);
  }
});

eventBus.on("call.ended", async (event) => {
  const { ctx } = event;
  const engine = new PhoneCall(ctx.callId, {} as VoiceCallJobData);
  await engine.cleanup();
});

export default eventBus;
