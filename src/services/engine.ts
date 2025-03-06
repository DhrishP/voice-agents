import eventBus from "../events";
import { AIProvider } from "../providers/ai";
import { STTProvider } from "../providers/stt";
import { TelephonyProvider } from "../providers/telephony";
import { TTSProvider } from "../providers/tts";

const sstEngines: Record<string, STTProvider> = {};
const ttsEngines: Record<string, TTSProvider> = {};
const telephonyEngines: Record<string, TelephonyProvider> = {};
const llmEngines: Record<string, AIProvider> = {};

eventBus.on("call.audio.chunk.received", (event) => {
  const { ctx, data } = event;
  const engine = sstEngines[ctx.callId];
  if (engine) {
    engine.pipe(data.chunk);
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
    engine.send(ctx.callId, data.chunk);
  }
});
