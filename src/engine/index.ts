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
import { SarvamTTSService } from "../services/tts/sarvam";
import { CoreMessage } from "ai";
import prisma from "../db/client";

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
  history: CoreMessage[] = [];

  transcription: {
    from: "agent" | "user";
    text: string;
  }[] = [];

  constructor(id: string, payload: VoiceCallJobData) {
    this.id = id;
    this.sttEngine = null;
    this.llmEngine = null;
    this.ttsEngine = null;
    this.telephonyEngine = null;
    this.payload = payload;
    this.history = [
      {
        role: "assistant",
        content: this.payload.prompt,
      },
    ];
  }

  public async initializeCallRecord() {
    try {
      await prisma.call.create({
        data: {
          id: this.id,
          status: "INITIATED",
          prompt: this.payload.prompt,
          telephonyProvider: this.payload.telephonyProvider,
          llmProvider: this.payload.llmProvider,
          sttProvider: this.payload.sttProvider,
          ttsProvider: this.payload.ttsProvider,
          transcript_without_tools: "",
          transcript_with_tools: "",
          summary: "",
        },
      });
    } catch (error) {
      console.error("Failed to create call record:", error);
      throw error;
    }
  }

  async initialize() {
    if (this.payload.telephonyProvider === "twilio") {
      const callId = await twilioOperator.call(
        this.id,
        this.payload.fromNumber,
        this.payload.toNumber
      );
      const phoneCall = await twilioOperator.getPhoneCall(callId);
      this.telephonyEngine = phoneCall;
      telephonyEngines[this.id] = phoneCall;
    } else {
      throw new Error("Invalid telephony provider");
    }

    // Initialize STT
    if (this.payload.sttProvider === "deepgram") {
      const sttEngine = new DeepgramSTTService(this.id);
      await sttEngine.initialize();
      this.sttEngine = sttEngine;
      sttEngines[this.id] = sttEngine;
    } else {
      throw new Error("Invalid STT provider");
    }

    if (this.payload.llmProvider === "openai") {
      const llmEngine = new OpenAIService(this.id, this.history);
      await llmEngine.initialize();

      this.llmEngine = llmEngine;
      llmEngines[this.id] = llmEngine;
    } else {
      throw new Error("Invalid LLM provider");
    }

    if (this.payload.ttsProvider === "deepgram") {
      const ttsEngine = new DeepgramTTSService(this.id);
      await ttsEngine.initialize();
      this.ttsEngine = ttsEngine;
      ttsEngines[this.id] = ttsEngine;
    } else if (this.payload.ttsProvider === "elevenlabs") {
      const ttsEngine = new ElevenLabsTTSService(this.id);
      await ttsEngine.initialize();

      this.ttsEngine = ttsEngine;
      ttsEngines[this.id] = ttsEngine;
    } else if (this.payload.ttsProvider === "sarvam") {
      const ttsEngine = new SarvamTTSService(this.id);
      await ttsEngine.initialize();

      this.ttsEngine = ttsEngine;
      ttsEngines[this.id] = ttsEngine;
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

  await engine.initializeCallRecord();

  await engine.initialize();

  try {
    await prisma.call.update({
      where: { id: ctx.callId },
      data: { status: "IN_PROGRESS" },
    });
  } catch (error) {
    console.error("Failed to update call status:", error);
  }
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
  const telephonyEngine = telephonyEngines[ctx.callId];

  if (engine) {
    await engine.pipe(data.transcription);
  } else {
    console.log("⚠️ No LLM engine found for call", ctx.callId);
  }

  if (telephonyEngine) {
    await telephonyEngine.cancel();
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

    await engine.send(audioChunk);
  } else {
    console.log("⚠️ No telephony engine found for call", ctx.callId);
  }
});

eventBus.on("call.ended", async (event) => {
  const { ctx, data } = event;
  const engine = new PhoneCall(ctx.callId, {} as VoiceCallJobData);

  try {
    await prisma.call.update({
      where: { id: ctx.callId },
      data: {
        status: "COMPLETED",
      },
    });
  } catch (error) {
    console.error("Failed to update call completion:", error);
  }

  await engine.cleanup();
});

eventBus.on("call.error", async (event) => {
  const { ctx, error } = event;

  try {
    await prisma.call.update({
      where: { id: ctx.callId },
      data: {
        status: "FAILED",
        errorReason: error.message,
      },
    });
  } catch (dbError) {
    console.error("Failed to update call error status:", dbError);
  }
});

export default eventBus;
