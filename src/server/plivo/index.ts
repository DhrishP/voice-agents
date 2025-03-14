import express, { Request, Response } from "express";
import { Server as HttpServer } from "http";
import WebSocket from "ws";
const app = express();
const server = new HttpServer(app);
const wss = new WebSocket.Server({ server });
import operator from "../../services/telephony/plivo/operator";
import Server from "../../types/server";
import ngrok from "ngrok";
import eventBus from "../../events";
import prisma from "../../db/client";
import recordingService from "../../services/recording";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/plivo/answer/:callId", (req, res) => {
  const { callId } = req.params;

  try {
    const xml = operator.generateXml(callId);
    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (error) {
    console.log("Error generating Plivo XML:", error);
    res.status(404).json({ error: "Invalid call ID" });
  }
});

app.post("/plivo/stream-events/:callId", (req, res) => {
  const { callId } = req.params;
  const event = req.body;

  console.log(`Stream event for call ${callId}:`, event);

  // Handle various stream events (start, stop, etc.)
  if (event.event === "streamStopped") {
    eventBus.emit("call.ended", {
      ctx: { callId },
      data: {
        errorReason: "Stream stopped",
      },
    });
  }

  res.status(200).send();
});

app.post("/plivo/stream-callback/:callId", (req, res) => {
  const { callId } = req.params;

  console.log(`Stream callback for call ${callId}`);

  res.set("Content-Type", "application/xml");
  res.send("<Response></Response>");
});

app.post("/plivo/transfer/:callId", (req, res) => {
  const { callId } = req.params;
  const toNumber = req.query.number || process.env.TRANSFER_PHONE_NUMBER;

  console.log(`Handling transfer for call ${callId} to ${toNumber}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Speak>Transferring your call to a human agent. Please hold.</Speak>
      <Record callbackUrl="${req.protocol}://${req.get(
    "host"
  )}/plivo/recording-callback/${callId}" 
              callbackMethod="POST" />
      <Dial recordingCallbackUrl="${req.protocol}://${req.get(
    "host"
  )}/plivo/recording-callback/${callId}"
            recordingCallbackMethod="POST">${toNumber}</Dial>
    </Response>`;

  res.set("Content-Type", "application/xml");
  res.send(xml);
});

app.post("/plivo/recording-callback/:callId", async (req, res) => {
  const { callId } = req.params;
  const recordingUrl = req.body.recording_url || req.body.url;
  const recordingDuration = parseInt(
    req.body.recording_duration || req.body.duration || "0",
    10
  );

  console.log(`Recording complete for call ${callId}: ${recordingUrl}`);

  try {
    // Save the recording URL to your database
    await prisma.recording.upsert({
      where: { callId },
      update: {
        recordingUrl,
        recordingDuration,
      },
      create: {
        callId,
        recordingUrl,
        recordingDuration,
      },
    });

    // Start a new recording session that will capture the human conversation
    recordingService.startRecording(callId);

    res.status(200).send("OK");
  } catch (error) {
    console.error(`Error processing recording for call ${callId}:`, error);
    res.status(500).send("Error processing recording");
  }
});

app.post("/plivo/direct-transfer/:callId", (req, res) => {
  const { callId } = req.params;
  const toNumber = req.query.number || process.env.TRANSFER_PHONE_NUMBER;

  console.log(`Processing direct transfer for call ${callId} to ${toNumber}`);

  // Create a simpler XML with proper Plivo structure
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Speak>Transferring your call to a human agent. Please hold.</Speak>
      <Dial callbackUrl="${req.protocol}://${req.get(
    "host"
  )}/plivo/transfer-status/${callId}"
            callbackMethod="POST"
            action="${req.protocol}://${req.get(
    "host"
  )}/plivo/transfer-status/${callId}"
            method="POST"
            redirect="true">${toNumber}</Dial>
    </Response>`;

  console.log(`Generated XML for transfer: ${xml}`);
  res.set("Content-Type", "application/xml");
  res.send(xml);
});

app.post("/plivo/transfer-status/:callId", (req, res) => {
  const { callId } = req.params;
  const status = req.body.DialStatus || req.body.status;

  console.log(`Transfer status for call ${callId}: ${status}`);

  // Update call status in database
  try {
    prisma.call.update({
      where: { id: callId },
      data: {
        summary: `Call transferred to human agent. Status: ${status}`,
      },
    });
  } catch (error) {
    console.error(`Error updating transfer status: ${error}`);
  }

  res.status(200).send("OK");
});

wss.on("connection", (ws, req) => {
  const pathParts = req.url?.split("/") || [];
  const callId = pathParts[pathParts.length - 1];

  if (!callId) {
    console.log("No callId provided in WebSocket connection");
    ws.close();
    return;
  }

  console.log(`New Plivo WebSocket connection for call ${callId}`);

  // Try-catch around the setWsObject call
  try {
    operator.setWsObject(callId, ws);
  } catch (error) {
    console.error(`Error setting WebSocket for call ${callId}:`, error);
    // Don't close the connection yet - we'll handle it within the error/close handlers
  }

  ws.on("error", (error) => {
    console.error(`Plivo WebSocket error for call ${callId}:`, error);
    try {
      eventBus.emit("call.error", {
        ctx: { callId },
        error,
      });
    } catch (emitError) {
      console.error(
        `Error emitting error event for call ${callId}:`,
        emitError
      );
    }
  });

  ws.on("close", () => {
    console.log(`Plivo WebSocket closed for call ${callId}`);

    try {
      operator.hangup(callId).catch((error: any) => {
        console.error(`Error hanging up Plivo call ${callId}:`, error);
      });
    } catch (error) {
      console.error(`Error in hangup for call ${callId}:`, error);
    }

    try {
      eventBus.emit("call.ended", {
        ctx: { callId },
        data: {
          errorReason: "WebSocket connection closed",
        },
      });
    } catch (emitError) {
      console.error(
        `Error emitting ended event for call ${callId}:`,
        emitError
      );
    }
  });
});

class PlivoServer extends Server {
  public async start(): Promise<void> {
    server.listen(this.port, () => {
      console.log(`Plivo server is running on port ${this.port}`);
    });
    this.instance = server;

    // Setup ngrok tunnel for public access
    await ngrok.authtoken(process.env.NGROK_AUTHTOKEN || "");
    const ngrokUrl = await ngrok.connect({
      addr: this.port,
      region: "us",
    });
    this.url = `${ngrokUrl}`;
    console.log(`Plivo server is running on ${this.url}`);
    operator.setBaseUrl(this.url);
  }

  public async stop(): Promise<void> {
    this.instance.close();
  }
}

export default PlivoServer;
