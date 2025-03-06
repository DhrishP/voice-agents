import eventBus from "../events";
import { AIProvider } from "../providers/ai";
import { STTProvider } from "../providers/stt";
import { TelephonyProvider } from "../types/providers/telephony";
import { TTSProvider } from "../providers/tts";
import { VoiceCallJobData } from "../types";

import twilioOperator from "../services/telephony/twillio/operator";

const sttEngines: Record<string, STTProvider> = {};
const ttsEngines: Record<string, TTSProvider> = {};
const telephonyEngines: Record<string, TelephonyProvider> = {};
const llmEngines: Record<string, AIProvider> = {};

class PhoneCall {
  id: string;
  sttEngine: STTProvider | null;
  llmEngine: AIProvider | null;
  ttsEngine: TTSProvider | null;
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
    // TODO: Initialize all the engines

    if (this.payload.telephonyProvider === "twilio") {
      const callId = await twilioOperator.call(
        this.payload.fromNumber,
        this.payload.toNumber
      );

      const phoneCall = await twilioOperator.getPhoneCall(callId);
      this.telephonyEngine = phoneCall;

      phoneCall.onListen((chunk) => {
        console.log("Chunk received", chunk);
        eventBus.emit("call.audio.chunk.received", {
          ctx: {
            callId,
            provider: this.payload.telephonyProvider,
            timestamp: Date.now(),
          },
          data: { chunk, direction: "inbound" },
        });
      });
    } else {
      throw new Error("Invalid telephony provider");
    }

    // this.sttEngine = new STTProvider();
    // this.llmEngine = new AIProvider();
    // this.ttsEngine = new TTSProvider();
  }
}

eventBus.on("call.initiated", (event) => {
  const { ctx, payload } = event;
  const engine = new PhoneCall(ctx.callId, payload);
  engine.initialize();
});

eventBus.on("call.audio.chunk.received", (event) => {
  const { ctx, data } = event;
  const engine = sttEngines[ctx.callId];
  if (engine) {
    engine.pipe(data.chunk);
  } else {
    console.log("No engine found for call", ctx.callId);
  }
});

eventBus.on("call.transcription.chunk.created", (event) => {
  const { ctx, data } = event;
  const engine = llmEngines[ctx.callId];
  if (engine) {
    engine.pipe(data.transcription);
  }
});

eventBus.on("call.response.chunk.generated", (event) => {
  const { ctx, data } = event;
  const engine = ttsEngines[ctx.callId];
  if (engine) {
    engine.pipe(data.text);
  }
});

eventBus.on("call.audio.chunk.synthesized", (event) => {
  const { ctx, data } = event;
  const engine = telephonyEngines[ctx.callId];
  if (engine) {
    engine.send(data.chunk);
  }
});

export default eventBus;
