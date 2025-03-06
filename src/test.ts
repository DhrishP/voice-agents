import dotenv from "dotenv";
import { TelephonyProvider } from "./providers/telephony";
import { VoiceCallRequest } from "./types/voice-call";
import twilioServer from "./services/server";
import STTService from "./providers/stt";
import AIService from "./providers/ai";
import TTSService from "./providers/tts";
import twilioService from "./services/telephony/twillio/twilio-service";
import ngrok from "ngrok";

let ngrokUrl: string | null = null;

dotenv.config();

async function initialize() {
  const telephonyProvider = TelephonyProvider.getInstance();
  await telephonyProvider.initialize();
  console.log("Telephony provider initialized");
  return telephonyProvider;
}

async function exampleVoiceCall() {
  const telephonyProvider = await initialize();

  try {
    const callRequest: VoiceCallRequest = {
      fromNumber: "+16692312259",
      toNumber: "+13025222900",
      prompt:
        "Hello! This is a test call from our voice agent. Please say something, and I will respond.",
      telephonyProvider: "twilio",
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      ttsProvider: "elevenlabs",
      ttsModel: "eleven_turbo_v2_5",
      sttProvider: "assemblyai",
      sttModel: "assemblyai_whisper_1",
      outputSchema: {
        type: "object",
        properties: {
          callStatus: {
            type: "string"
          },
          callDuration: {
            type: "number"
          },
          userResponse: {
            type: "string"
          }
        },
      },
    };

    console.log(
      `Making call from ${callRequest.fromNumber} to ${callRequest.toNumber}`
    );

    const jobId = await telephonyProvider.makeCall(callRequest);
    console.log(`Call initiated with ID: ${jobId}`);

    await new Promise((resolve) => setTimeout(resolve, 20000));
    const callId = await telephonyProvider.getCallIdFromJobId(jobId);
    console.log(`Call ID: ${callId}`);

    if (!callId) {
      throw new Error("Failed to get call ID");
    }

    const call = await twilioService.getCall(callId);
    console.log(`Call: ${call?.getStatus()}`);

    // Initialize services
    const sttService = new STTService();
    const aiService = new AIService();
    const ttsService = new TTSService();

    console.log("🎙️ Initializing AI and TTS services...");
    await aiService.initialize();
    await ttsService.initialize();
    console.log("✅ Services initialized");

    telephonyProvider.onListen(callId, async (speechChunk) => {
      try {
        if (call?.getStatus() === "connected") {
          await sttService.pipe(speechChunk);
        }
      } catch (error) {
        console.error("❌ Error processing speech chunk:", error);
      }
    });

    sttService.on("transcription", (text: string) => {
      console.log("📝 Transcribed:", text);

      if (
        text.toLowerCase().includes("goodbye") ||
        text.toLowerCase().includes("hang up")
      ) {
        aiService
          .pipe("Thank you for your time. Goodbye!")
          .then(() => hangupCall(callId))
          .catch((error) => console.error("Error in goodbye sequence:", error));
        return;
      }

      aiService.pipe(text).catch((error) => {
        console.error("Error piping to AI:", error);
      });
    });

    aiService.on("response", (response: string) => {
      console.log("🤖 AI Response:", response);
      console.log("🔊 Sending to telephony...");
      telephonyProvider.send(callId, response).catch((error) => {
        console.error("Error sending to telephony:", error);
      });
    });

    sttService.on("error", (error: Error) => {
      console.error("❌ STT error:", error);
    });

    aiService.on("error", (error: Error) => {
      console.error("❌ AI error:", error);
    });

    return callId;
  } catch (error) {
    console.error("Error in voice call example:", error);
    throw error;
  }
}

async function hangupCall(callId: string) {
  const telephonyProvider = await initialize();
  await telephonyProvider.hangup(callId);
}

async function initializeTwilioServer() {
  try {
    await ngrok.authtoken(process.env.NGROK_AUTHTOKEN || "");
    ngrokUrl = await ngrok.connect({
      addr: process.env.TWILIO_SERVER_PORT || 3000,
      region: "us",
    });
    console.log("Ngrok tunnel created:", ngrokUrl);
    process.env.SERVER_URL = ngrokUrl;
    await TelephonyProvider.getInstance();
    console.log("Voice Agent initialized and ready to process calls");

    await twilioServer.start();
    console.log(
      `Twilio server listening on port ${
        process.env.TWILIO_SERVER_PORT || 3000
      }`
    );

    await exampleVoiceCall();
  } catch (error) {
    console.error("Error during initialization:", error);
    process.exit(1);
  }
}

initializeTwilioServer();

process.on("SIGINT", async () => {
  console.log("Received SIGINT signal");
  await TelephonyProvider.getInstance().shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM signal");
  await TelephonyProvider.getInstance().shutdown();
  process.exit(0);
});
