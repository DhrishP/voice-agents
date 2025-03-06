import express, { Request, Response } from "express";
import { Server } from "http";
import WebSocket from "ws";
import { Operator } from "./Operator";
import { TwilioPhoneCall } from "./TwilioPhoneCall";

const app = express();
const server = new Server(app);
const wss = new WebSocket.Server({ server });
const operator = new Operator();

const activeCalls = new Map<string, TwilioPhoneCall>();

app.use(express.json());

// Endpoint to initiate a call
app.post("/call", (async (req: Request, res: Response) => {
  const { baseApiUrl, fromNumber, toNumber } = req.body;

  if (!baseApiUrl || !fromNumber || !toNumber) {
    return res.status(400).json({
      error: "baseApiUrl, fromNumber, and toNumber are required",
      missing: [
        !baseApiUrl && "baseApiUrl",
        !fromNumber && "fromNumber",
        !toNumber && "toNumber",
      ].filter(Boolean),
    });
  }

  try {
    const callId = await operator.call(baseApiUrl, fromNumber, toNumber);
    res.json({ callId });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to initiate call";
    res.status(500).json({ error: errorMessage });
  }
  return;
}) as any);

// Endpoint to get TwiML for a call
app.post("/twiml/:callId", (req, res) => {
  const { callId } = req.params;
  const baseWsUrl = `wss://${req.get(
    "host"
  )}/stream`;

  try {
    const twiml = operator.generateTwiml(baseWsUrl, callId);
    console.log(twiml);
    res.type("text/xml").send(twiml);
  } catch (error) {
    console.log("error", error);
    res.status(404).json({ error: "Invalid call ID" });
  }
});

// Endpoint to hang up a call
app.post("/hangup/:callId", (req, res) => {
  const { callId } = req.params;

  try {
    operator.hangup(callId);
    const call = activeCalls.get(callId);
    if (call) {
      call.hangup();
      activeCalls.delete(callId);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(404).json({ error: "Invalid call ID" });
  }
});

// WebSocket connection handler
wss.on("connection", (ws, req) => {
  const callId = req.url?.split("/").pop();
  if (!callId) {
    console.log("no callId");
    ws.close();
    return;
  }

  const call = new TwilioPhoneCall(ws);
  activeCalls.set(callId, call);

  ws.on("close", () => {
    activeCalls.delete(callId);
    operator.hangup(callId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
