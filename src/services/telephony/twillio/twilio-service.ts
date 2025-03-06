import { EventEmitter } from "events";
import * as twilio from "twilio";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";

export interface TwilioCallEvents {
  connected: () => void;
  disconnected: (reason?: string) => void;
  media: (payload: string) => void;
  mark: (name: string) => void;
  error: (error: Error) => void;
}

export declare interface TwilioCall {
  on<E extends keyof TwilioCallEvents>(
    event: E,
    listener: TwilioCallEvents[E]
  ): this;

  emit<E extends keyof TwilioCallEvents>(
    event: E,
    ...args: Parameters<TwilioCallEvents[E]>
  ): boolean;
}

export class TwilioCall extends EventEmitter {
  private id: string;
  private callSid?: string;
  private streamSid?: string;
  private ws?: WebSocket;
  private client: twilio.Twilio;
  private serverUrl: string;
  private twiml: string;
  private status:
    | "initializing"
    | "connecting"
    | "connected"
    | "disconnected"
    | "completed" = "initializing";
  private audioChunkLogCount: number = 0;
  private maxAudioChunkLogs: number = 5;

  constructor(id: string = uuidv4()) {
    super();
    this.id = id;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.serverUrl = process.env.SERVER_URL || "";

    if (!accountSid || !authToken || !this.serverUrl) {
      throw new Error("Missing required Twilio or server configuration");
    }

    this.client = new twilio.Twilio(accountSid, authToken);
    this.twiml = "";
  }

  async call(
    fromNumber: string,
    toNumber: string,
    initialPrompt?: string
  ): Promise<string> {
    console.log(
      `Call ${this.id}: 📞 Initiating call from ${fromNumber} to ${toNumber}`
    );
    this.status = "connecting";

    this.twiml = this.generateTwiMLWithMessage(initialPrompt ?? "");

    const call = await this.client.calls.create({
      twiml: this.twiml,
      to: toNumber,
      from: fromNumber,
      statusCallback: `${this.serverUrl}/twilio/status/${this.id}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    this.callSid = call.sid;
    console.log(`Call ${this.id}: 📱 Created call with SID ${this.callSid}`);

    return this.id;
  }

  async handleStatusCallback(status: string): Promise<void> {
    console.log(`Call ${this.id}: 📊 Status callback: ${status}`);

    if (
      status === "completed" ||
      status === "failed" ||
      status === "busy" ||
      status === "no-answer"
    ) {
      this.status = "completed";
      this.emit("disconnected", status);
    }
  }

  async cancel(): Promise<void> {
    if (!this.callSid) {
      console.log(`Call ${this.id}: ⚠️ Cannot cancel - no call SID`);
      return;
    }

    if (this.status === "disconnected" || this.status === "completed") {
      console.log(`Call ${this.id}: ⚠️ Call already ended`);
      return;
    }

    console.log(`Call ${this.id}: 🛑 Cancelling call ${this.callSid}`);
    await this.client.calls(this.callSid).update({ status: "canceled" });
    this.status = "disconnected";
    this.emit("disconnected", "canceled");
  }

  async hangup(): Promise<void> {
    if (!this.callSid) {
      console.log(`Call ${this.id}: ⚠️ Cannot hangup - no call SID`);
      return;
    }

    if (this.status === "disconnected" || this.status === "completed") {
      console.log(`Call ${this.id}: ⚠️ Call already ended`);
      return;
    }

    console.log(`Call ${this.id}: 📵 Hanging up call ${this.callSid}`);
    await this.client.calls(this.callSid).update({ status: "completed" });
    this.status = "disconnected";
    this.emit("disconnected", "completed");
  }

  public async sendAudio(
    message: string,
    pauseLength: number = 2
  ): Promise<boolean> {
    if (!this.callSid || this.status !== "connected") {
      console.log(`Call ${this.id}: ⚠️ Cannot send audio - call not connected`);
      return false;
    }

    try {
      const twiml = this.generateTwiMLWithMessage(message, pauseLength);

      await this.client.calls(this.callSid).update({
        twiml: twiml,
      });

      console.log(`Call ${this.id}: 🔊 Sent message: "${message}"`);
      return true;
    } catch (error) {
      console.error(`Call ${this.id}: ❌ Error sending audio:`, error);
      return false;
    }
  }

  getId(): string {
    return this.id;
  }

  getCallSid(): string | undefined {
    return this.callSid;
  }

  getStatus(): string {
    return this.status;
  }

  public registerWebSocket(ws: any): void {
    this.ws = ws;
    console.log(`Call ${this.id}: 🔄 WebSocket registered`);

    let pingInterval: NodeJS.Timeout;

    ws.on("open", () => {
      console.log(`Call ${this.id}: 📡 WebSocket connection opened`);

      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30000);
    });

    ws.on("message", (message: any) => {
      try {
        if (typeof message === "string") {
          const data = JSON.parse(message);

          if (data.event === "media") {
            if (this.audioChunkLogCount < this.maxAudioChunkLogs) {
              this.audioChunkLogCount++;

              if (this.audioChunkLogCount === this.maxAudioChunkLogs) {
                console.log(
                  `Call ${this.id}: 📝 Further audio chunks will not be logged`
                );
              }
            }

            if (data.media && data.media.payload) {
              this.emit("media", data.media.payload);
            }
          } else if (data.event === "start") {
            this.streamSid = data.start.streamSid;
            this.status = "connected";
            this.emit("connected");
            console.log(
              `Call ${this.id}: 🔌 Stream connected with SID ${this.streamSid}`
            );
          } else if (data.event === "stop") {
            console.log(
              `Call ${this.id}: ⚠️ Stream stop event received: ${
                data.stop?.reason || "unknown reason"
              }`
            );

            console.log(
              `Call ${this.id}: WebSocket stream stopped, but call remains active`
            );
            clearInterval(pingInterval);
          } else if (data.event === "mark") {
            console.log(
              `Call ${this.id}: 🔖 Mark received: ${data.mark?.name}`
            );
            this.emit("mark", data.mark?.name);
          }
        } else if (Buffer.isBuffer(message)) {
          console.log(
            `Call ${this.id}: 📦 Received binary message of ${message.length} bytes`
          );
        }
      } catch (error) {
        console.error(
          `Call ${this.id}: ❌ Error processing WebSocket message:`,
          error
        );
      }
    });

    ws.on("close", (code: number, reason: string) => {
      console.log(
        `Call ${this.id}: 🔒 WebSocket connection closed: ${code} ${reason}`
      );
      clearInterval(pingInterval);
    });

    ws.on("error", (error: Error) => {
      console.error(`Call ${this.id}: ❌ WebSocket error:`, error);
      this.emit("error", error);
      clearInterval(pingInterval);
    });
  }

  public generateTwiMLWithMessage(
    message: string,
    pauseLength: number = 2
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>${message}</Say>
      <Pause length="${pauseLength}"/>
      <Connect>
        <Stream url="wss://${this.serverUrl.replace(
          /^https?:\/\//,
          ""
        )}/twilio/media/${this.id}">
          <Parameter name="callSid" value="{{CallSid}}"/>
        </Stream>
      </Connect>
      <Gather 
        action="${this.serverUrl.replace(
          /^https?:\/\//,
          "https://"
        )}/twilio/gather/${this.id}"
        method="POST"
        input="speech"
        timeout="60"
        speechTimeout="auto">
      </Gather>
      <Pause length="120"/>
    </Response>`;
  }
}

class TwilioService {
  private activeCalls: Map<string, TwilioCall> = new Map();
  private speechListeners: Map<string, (text: string) => void> = new Map();

  async makeCall(
    fromNumber: string,
    toNumber: string,
    initialPrompt: string
  ): Promise<{
    callId: string;
    callSid: string;
  }> {
    const call = new TwilioCall();
    const callId = call.getId();

    this.activeCalls.set(callId, call);

    call.on("disconnected", (reason) => {
      if (
        reason &&
        (reason.includes("completed") ||
          reason.includes("busy") ||
          reason.includes("failed") ||
          reason.includes("no-answer") ||
          reason.includes("canceled") ||
          reason.includes("hung up"))
      ) {
        console.log(`Call ${callId}: Will be removed due to reason: ${reason}`);
        setTimeout(() => {
          this.activeCalls.delete(callId);
          console.log(`Call ${callId}: Removed from active calls`);
        }, 5000);
      } else {
        console.log(
          `Call ${callId}: WebSocket disconnected but call is still active. Reason: ${
            reason || "unknown"
          }`
        );
      }
    });

    const callSid = await call.call(fromNumber, toNumber, initialPrompt);

    return { callId, callSid };
  }

  getCall(callId: string): TwilioCall | undefined {
    return this.activeCalls.get(callId);
  }

  removeCall(callId: string): boolean {
    this.speechListeners.delete(callId);
    return this.activeCalls.delete(callId);
  }

  async sendAudio(
    callId: string,
    message: string,
    pauseLength?: number
  ): Promise<boolean> {
    const call = this.activeCalls.get(callId);
    if (!call) {
      console.error(`No active call found with ID: ${callId}`);
      return false;
    }

    return await call.sendAudio(message, pauseLength);
  }

  async hangupCall(callId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) {
      console.error(`No active call found with ID: ${callId} to hang up`);
      return;
    }

    await call.hangup();
  }

  async cancelCall(callId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) {
      console.error(`No active call found with ID: ${callId} to cancel`);
      return;
    }

    await call.cancel();
  }

  getCallStatus(callId: string): string | undefined {
    const call = this.activeCalls.get(callId);
    return call?.getStatus();
  }

  getCallSid(callId: string): string | undefined {
    const call = this.activeCalls.get(callId);
    return call?.getCallSid();
  }

  registerListener(callId: string, callback: (text: string) => void): void {
    this.speechListeners.set(callId, callback);

    const call = this.getCall(callId);
    if (!call) {
      throw new Error(`Call with ID ${callId} not found`);
    }

    const wsEmitter = new EventEmitter();

    const wsAdapter = {
      on: (event: string, handler: (...args: any[]) => void) =>
        wsEmitter.on(event, handler),
      send: (data: any) => {
        console.log("WebSocket send called:", data);
      },
      close: () => {
        console.log("WebSocket connection closed");
      },
    };

    call.on("media", (payload) => {
      const listener = this.speechListeners.get(callId);
      if (listener) {
        listener(payload);
      }
    });

    call.registerWebSocket(wsAdapter);
  }

  removeListener(callId: string): void {
    this.speechListeners.delete(callId);
  }

  getListeners(): Map<string, (text: string) => void> {
    return this.speechListeners;
  }

  getActiveCalls(): Map<string, TwilioCall> {
    return this.activeCalls;
  }

  hasCall(callId: string): boolean {
    return this.activeCalls.has(callId);
  }

  generateTwiML(
    callId: string,
    message: string,
    pauseLength: number = 2
  ): string | null {
    const call = this.activeCalls.get(callId);
    if (!call) {
      return null;
    }

    return call.generateTwiMLWithMessage(message, pauseLength);
  }

  registerWebSocketForCall(callId: string, ws: any): boolean {
    const call = this.activeCalls.get(callId);
    if (!call) {
      return false;
    }

    call.registerWebSocket(ws);
    return true;
  }
}

export default new TwilioService();
