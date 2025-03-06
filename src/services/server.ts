import express from "express";
import expressWs from "express-ws";
import { Server } from "http";
import twilioService from "./telephony/twillio/twilio-service";

export class AgentServer {
  private static instance: AgentServer;
  private app: express.Application & { ws: expressWs.Application["ws"] };
  private server?: Server;
  private port: number;
  private isRunning: boolean = false;

  private constructor() {
    this.app = expressWs(express()).app;
    this.port = parseInt(process.env.TWILIO_SERVER_PORT || "3000");

    this.setupRoutes();
  }

  public static getInstance(): AgentServer {
    if (!AgentServer.instance) {
      AgentServer.instance = new AgentServer();
    }
    return AgentServer.instance;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      if (this.isRunning) {
        console.log("Twilio server already running");
        resolve();
        return;
      }

      this.server = this.app.listen(this.port, () => {
        console.log(`Twilio server listening on port ${this.port}`);
        this.isRunning = true;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server || !this.isRunning) {
        this.isRunning = false;
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          console.error("Error stopping Twilio server:", err);
          reject(err);
          return;
        }

        console.log("Twilio server stopped");
        this.isRunning = false;
        this.server = undefined;
        resolve();
      });
    });
  }

  private setupRoutes(): void {
    this.app.get("/", (req, res) => {
      res.send("Twilio server is running");
    });

    this.app.get("/twilio/health", (req, res) => {
      res.send({ status: "ok" });
    });

    this.app.post("/twilio/voice", (req, res) => {
      const callId = req.query.callId as string;
      const initialPrompt = req.query.prompt as string;

      console.log(
        `Received TwiML request for call ID: ${callId} (redirect or initial)`
      );

      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const protocol = req.headers["x-forwarded-proto"] || "http";

      console.log(
        `Using host: ${host}, protocol: ${protocol} for TwiML generation`
      );

      const twiml = twilioService.generateTwiML(callId, initialPrompt ?? "", 2);
      if (twiml) {
        console.log(`Sending TwiML response for call ${callId}`);
        res.type("text/xml");
        res.send(twiml);
      } else {
        console.error(`No call found for ID: ${callId} when requesting TwiML`);
        let errorTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';
        errorTwiml += `<Say>Sorry, this call could not be processed.</Say>`;
        errorTwiml += "</Response>";
        res.type("text/xml");
        res.send(errorTwiml);
      }
    });

    this.app.post("/twilio/call-status/:callId", (req, res) => {
      try {
        const callId = req.params.callId;
        const callStatus = req.body?.CallStatus || "unknown";
        console.log(
          `📞 Call ${callId}: Status callback received: ${callStatus}`
        );

        res.status(200).send("OK");

        setTimeout(() => {
          try {
            if (!twilioService.hasCall(callId)) {
              console.log(`⚠️ Call ${callId}: Not found for status update`);
              return;
            }

            console.log(`📊 Call ${callId}: Status update: ${callStatus}`, {
              body: req.body || {},
            });

            if (
              callStatus === "completed" ||
              callStatus === "busy" ||
              callStatus === "failed" ||
              callStatus === "no-answer" ||
              callStatus === "canceled"
            ) {
              console.log(
                `📞 Call ${callId}: Ending call with status: ${callStatus}`
              );

              twilioService.removeCall(callId);
            } else {
              console.log(
                `📞 Call ${callId}: Maintaining call connection - non-terminal status: ${callStatus}`
              );

              if (
                callStatus === "unknown" &&
                req.body &&
                Object.keys(req.body).length === 0
              ) {
                console.log(
                  `📞 Call ${callId}: Empty status update, likely from WebSocket disconnect. NOT removing call.`
                );
              }
            }
          } catch (error) {
            console.error(
              `❌ Error in async processing of call status for ${callId}:`,
              error
            );
          }
        }, 0);
      } catch (error) {
        console.error("❌ Error in call-status endpoint:", error);
      }
    });
    this.app.ws("/twilio/media/:callId", (ws, req) => {
      try {
        const callId = req.params.callId;
        console.log(`💬 WebSocket connection opened for call ${callId}`);

        if (!twilioService.registerWebSocketForCall(callId, ws)) {
          console.error(`⚠️ No call found for ID: ${callId}`);
          ws.close(1000, "Call not found");
          return;
        }

        ws.on("error", (error) => {
          console.error(`⚠️ WebSocket error for call ${callId}:`, error);
        });

        ws.on("close", (code, reason) => {
          console.log(
            `💬 WebSocket closed for call ${callId}: ${code} - ${reason}`
          );
        });
      } catch (error) {
        console.error("❌ Error in WebSocket connection:", error);
        ws.close(1011, "Internal server error");
      }
    });

    this.app.post("/twilio/make-call", async (req, res) => {
      try {
        const { fromNumber, toNumber, initialPrompt } = req.body;

        if (!fromNumber || !toNumber) {
          res.status(400).json({
            error: "Missing required parameters: fromNumber and toNumber",
          });
          return;
        }

        const result = await twilioService.makeCall(
          fromNumber,
          toNumber,
          initialPrompt
        );

        res.json(result);
      } catch (error) {
        console.error("Error making call:", error);
        res.status(500).json({
          error: "Failed to make call",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    this.app.post("/twilio/hangup/:callId", async (req, res) => {
      try {
        const callId = req.params.callId;

        if (!twilioService.hasCall(callId)) {
          res.status(404).json({ error: "Call not found" });
          return;
        }

        await twilioService.hangupCall(callId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error hanging up call:", error);
        res.status(500).json({
          error: "Failed to hang up call",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    this.app.get("/twilio/calls", (req, res) => {
      try {
        res.json({ callCount: 0 });
      } catch (error) {
        console.error("Error getting calls:", error);
        res.status(500).json({
          error: "Failed to get calls",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    this.app.get("/twilio/call/:callId", (req, res) => {
      try {
        const callId = req.params.callId;

        if (!twilioService.hasCall(callId)) {
          res.status(404).json({ error: "Call not found" });
          return;
        }

        res.json({
          callId,
          callSid: twilioService.getCallSid(callId),
          status: twilioService.getCallStatus(callId),
        });
      } catch (error) {
        console.error("Error getting call:", error);
        res.status(500).json({
          error: "Failed to get call",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}

export default AgentServer.getInstance();
