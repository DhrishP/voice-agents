import express, { Request, Response } from "express";
import { Server as HttpServer } from "http";
import WebSocket from "ws";
import cors from "cors";
import Server from "../../types/server";
import operator from "../../services/telephony/websocket/operator";
import eventBus from "../../events";
import { queue } from "../worker";
import prisma from "../../db/client";
import { engineError } from "../../utils/emit-functions";

const app = express();
const server = new HttpServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(cors());

app.post("/session", async (req: Request, res: Response) => {
  try {
    const callId = await operator.createSession("");

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

    await queue.add("voice-call", {
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
    const call = await prisma.call.findUnique({
      where: { id: callId },
      include: { provider: true },
    });

    if (!call) {
      console.error(`Call ${callId} not found in database`);
      ws.close();
      return;
    }

    await operator.setWsObject(callId, ws);

    console.log(`WebSocket connection established for call ${callId}`);
  } catch (error) {
    console.error(`Error setting up WebSocket for session ${callId}:`, error);
    ws.close();
    return;
  }

  ws.on("error", (error) => {
    console.error(`WebSocket error for session ${callId}:`, error);
    engineError(callId, error);
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
