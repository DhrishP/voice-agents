import express, { Request, Response } from "express";
import { Server as HttpServer } from "http";
import WebSocket from "ws";
const app = express();
const server = new HttpServer(app);
const wss = new WebSocket.Server({ server });
import operator from "../../services/telephony/twillio/operator";
import Server from "../../types/server";
import ngrok from "ngrok";
import eventBus from "../../events";

app.use(express.json());

// Endpoint to get TwiML for a call
app.post("/twiml/:callId", (req, res) => {
  const { callId } = req.params;
  const baseWsUrl = `wss://${req.get("host")}/stream`;

  try {
    const twiml = operator.generateTwiml(baseWsUrl, callId);
    console.log(twiml);
    res.type("text/xml").send(twiml);
  } catch (error) {
    console.log("error", error);
    res.status(404).json({ error: "Invalid call ID" });
  }
});

wss.on("connection", (ws, req) => {
  const callId = req.url?.split("/").pop();
  if (!callId) {
    console.log("No callId provided in WebSocket connection");
    ws.close();
    return;
  }

  console.log(`New WebSocket connection for call ${callId}`);
  operator.setWsObject(callId, ws);

  ws.on("error", (error) => {
    console.error(`WebSocket error for call ${callId}:`, error);
    eventBus.emit("call.error", {
      ctx: { callId },
      error,
    });
  });

  ws.on("close", () => {
    console.log(`WebSocket closed for call ${callId}`);
    operator.hangup(callId).catch((error: any) => {
      console.error(`Error hanging up call ${callId}:`, error);
    });
    eventBus.emit("call.ended", {
      ctx: { callId },
      data: {
        errorReason: "Call ended",
      },
    });
  });
});

class TwilioServer extends Server {
  public async start(): Promise<void> {
    server.listen(this.port, () => {
      console.log(`Twilio server is running on port ${this.port}`);
    });
    this.instance = server;
    await ngrok.authtoken(process.env.NGROK_AUTHTOKEN || "");
    const ngrokUrl = await ngrok.connect({
      addr: this.port,
      region: "us",
    });
    this.url = `${ngrokUrl}`;
    console.log(`Twilio server is running on ${this.url}`);
    operator.setBaseUrl(this.url);
  }

  public async stop(): Promise<void> {
    this.instance.close();
  }
}

export default TwilioServer;
