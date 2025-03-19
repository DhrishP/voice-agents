import express, { Request, Response } from "express";
import { Server as HttpServer } from "http";
import WebSocket from "ws";
import cors from "cors";
import fs from "fs";
import path from "path";
import multer from "multer";
import Server from "../../types/server";
import operator from "../../services/telephony/websocket/operator";
import eventBus from "../../events";
import { VoiceCallQueue } from "../../services/queue/voice-call-queue";
import { v4 as uuidv4 } from "uuid";
import prisma from "../../db/client";

const app = express();
const server = new HttpServer(app);
const wss = new WebSocket.Server({ server });
const voiceCallQueue = new VoiceCallQueue();

// Set up middleware
app.use(express.json());
app.use(cors());

// Set up file upload for test audio
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: any) => {
    const uploadDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

// REST API endpoints
app.post("/session", async (req: Request, res: Response) => {
  try {
    const callId = await operator.createSession("");

    // Create the call record first
    await prisma.call.create({
      data: {
        id: callId,
        status: "INITIATED",
        prompt:
          req.body.prompt ||
          "You are a helpful assistant. Answer concisely and clearly.",
        telephonyProvider: "websocket",
        summary: "",
        language: req.body.language || "en-US",
        provider: {
          create: {
            llmProvider: req.body.llmProvider || "openai",
            llmModel: req.body.llmModel || "gpt-4o",
            sttProvider: req.body.sttProvider || "deepgram",
            sttModel: req.body.sttModel || "nova-2",
            ttsProvider: req.body.ttsProvider || "elevenlabs",
            ttsModel: req.body.ttsModel || "eleven_multilingual_v2",
          },
        },
      },
    });

    // Create a job for this session to initialize the engines
    await voiceCallQueue.addJob({
      callId: callId,
      prompt:
        req.body.prompt ||
        "You are a helpful assistant. Answer concisely and clearly.",
      telephonyProvider: "websocket",
      fromNumber: "+15555555555",
      toNumber: "+15555555555",
      llmProvider: req.body.llmProvider || "openai",
      llmModel: req.body.llmModel || "gpt-4o",
      sttProvider: req.body.sttProvider || "deepgram",
      sttModel: req.body.sttModel || "nova-2",
      ttsProvider: req.body.ttsProvider || "elevenlabs",
      ttsModel: req.body.ttsModel || "eleven_multilingual_v2",
      language: req.body.language || "en-US",
    });

    // Get the base URL from the operator
    const baseUrl = await operator.getBaseUrl();

    // Construct the WebSocket URL
    const wsUrl = `${baseUrl}/stream/${callId}`;
    console.log(`Created session with WebSocket URL: ${wsUrl}`);

    res.json({
      callId,
      wsUrl,
      config: {
        prompt: req.body.prompt,
        llmProvider: req.body.llmProvider || "openai",
        llmModel: req.body.llmModel || "gpt-4o",
        sttProvider: req.body.sttProvider || "deepgram",
        sttModel: req.body.sttModel || "nova-2",
        ttsProvider: req.body.ttsProvider || "elevenlabs",
        ttsModel: req.body.ttsModel || "eleven_multilingual_v2",
        language: req.body.language || "en-US",
      },
    });
  } catch (error: any) {
    console.error("Error creating session:", error);
    res.status(500).json({ error: error.message });
  }
});

// Allow creating a session with specific parameters
app.post("/configure-session", async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      llmProvider,
      llmModel,
      sttProvider,
      sttModel,
      ttsProvider,
      ttsModel,
      language,
    } = req.body;

    const callId = await operator.createSession("");

    // Create a job for this session with user-specified parameters
    await voiceCallQueue.addJob({
      callId: callId,
      prompt:
        prompt || "You are a helpful assistant. Answer concisely and clearly.",
      telephonyProvider: "websocket",
      fromNumber: "+15555555555", // Dummy number for websocket
      toNumber: "+15555555555", // Dummy number for websocket
      llmProvider: llmProvider || "openai",
      llmModel: llmModel || "gpt-4o",
      sttProvider: sttProvider || "deepgram",
      sttModel: sttModel || "nova-2",
      ttsProvider: ttsProvider || "elevenlabs",
      ttsModel: ttsModel || "eleven_multilingual_v2",
      language: language || "en-US",
    });

    res.json({
      callId,
      wsUrl: `${await operator.getBaseUrl()}/stream/${callId}`,
      config: {
        prompt,
        llmProvider,
        llmModel,
        sttProvider,
        sttModel,
        ttsProvider,
        ttsModel,
        language,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  "/upload-test-audio",
  upload.single("audio"),
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const { callId } = req.body;
    if (!callId) {
      res.status(400).json({ error: "No callId provided" });
      return;
    }

    try {
      const filePath = req.file.path;
      const audioData = fs.readFileSync(filePath).toString("base64");

      // Find the provider for this callId and process the audio
      operator
        .getPhoneCall(callId)
        .then((provider) => {
          if (provider) {
            // Emit audio received event to simulate client sending audio
            eventBus.emit("call.audio.chunk.received", {
              ctx: {
                callId,
                provider: "websocket",
                timestamp: Date.now(),
              },
              data: {
                chunk: audioData,
                direction: "inbound",
              },
            });

            res.json({
              success: true,
              message: "Test audio uploaded and processed",
            });
          } else {
            res.status(404).json({
              error: "No active session found for the provided callId",
            });
          }
        })
        .catch((error) => {
          res.status(500).json({ error: error.message });
        });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET endpoint to retrieve recordings
app.get("/recordings/:callId", (req: Request, res: Response) => {
  const { callId } = req.params;
  const recordingsDir = operator.getRecordingsDir();
  const recordingPath = path.join(recordingsDir, `${callId}.wav`);

  if (fs.existsSync(recordingPath)) {
    res.sendFile(recordingPath);
  } else {
    res.status(404).json({ error: "Recording not found" });
  }
});

// WebSocket handling
wss.on("connection", async (ws, req) => {
  const pathParts = req.url?.split("/") || [];
  const callId = pathParts[pathParts.length - 1];

  if (!callId) {
    console.log("No callId provided in WebSocket connection");
    ws.close();
    return;
  }

  console.log(`New WebSocket connection for session ${callId}`);

  try {
    // Set the WebSocket object for this connection
    await operator.setWsObject(callId, ws);

    // Wait a short time for engines to initialize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if the call exists and is ready
    const call = await prisma.call.findUnique({
      where: { id: callId },
      include: { provider: true },
    });

    if (!call) {
      throw new Error("Call not found");
    }

    // Emit websocket.ready event
    eventBus.emit("websocket.ready", {
      ctx: {
        callId,
        provider: "websocket",
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    console.error(`Error setting up WebSocket for session ${callId}:`, error);
    ws.close();
    return;
  }

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`WebSocket message received for call ${callId}:`, data);

      if (data.event === "call.started") {
        console.log(`Call.started event received for call ID: ${callId}`);
        // Initialize the call if not already initialized
        eventBus.emit("call.initiated", {
          ctx: {
            callId,
            provider: "websocket",
            timestamp: Date.now(),
          },
          payload: {
            callId,
            telephonyProvider: "websocket",
            prompt:
              "You are a helpful voice assistant. Keep your responses concise and clear. Answer the user's questions helpfully.",
            fromNumber: "+15555555555",
            toNumber: "+15555555555",
            llmProvider: "openai",
            llmModel: "gpt-4o",
            sttProvider: "deepgram",
            sttModel: "nova-2",
            ttsProvider: "elevenlabs",
            ttsModel: "eleven_multilingual_v2",
            language: "en-US",
          },
        });
      }
    } catch (error) {
      console.error(
        `Error processing WebSocket message for call ${callId}:`,
        error
      );
    }
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error for session ${callId}:`, error);
    eventBus.emit("call.error", {
      ctx: { callId },
      error,
    });
  });

  ws.on("close", () => {
    console.log(`WebSocket closed for session ${callId}`);
    operator.hangup(callId).catch((error: any) => {
      console.error(`Error hanging up session ${callId}:`, error);
    });

    eventBus.emit("call.ended", {
      ctx: { callId },
      data: {
        errorReason: "WebSocket connection closed",
      },
    });
  });
});

class WebSocketServer extends Server {
  public async start(): Promise<void> {
    server.listen(this.port, () => {
      console.log(`WebSocket server is running on port ${this.port}`);
    });

    this.instance = server;

    // Use the environment variable or default to localhost
    const host = process.env.HOST || "localhost";
    this.url = `ws://${host}:${this.port}`;
    console.log(`WebSocket server is running on ${this.url}`);

    await operator.setBaseUrl(this.url);
  }

  public async stop(): Promise<void> {
    if (this.instance) {
      this.instance.close();
    }
  }
}

export default WebSocketServer;
