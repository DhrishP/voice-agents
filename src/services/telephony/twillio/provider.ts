import WebSocket from "ws";
import { TelephonyProvider } from "../../../types/providers/telephony";
import eventBus from "../../../engine";
import twilio from "twilio";
import { VoiceCallJobData } from "../../../types/voice-call";
import DTMFService from "../../dtmf";
import { DTMFTone } from "../../../types/dtmf";

export class TwilioProvider implements TelephonyProvider {
  private ws: WebSocket | null = null;
  private listenerCallback: ((chunk: string) => void) | null = null;
  private isStarted: boolean = false;
  private sid: string | null = null;
  private id: string;
  private static twilioClient: twilio.Twilio;
  private callSid: string | null = null;

  constructor(id: string) {
    this.id = id;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      throw new Error(
        "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables are required"
      );
    }

    if (!TwilioProvider.twilioClient) {
      TwilioProvider.twilioClient = twilio(accountSid, authToken);
    }
  }

  async validateInput(payload: VoiceCallJobData): Promise<boolean> {
    try {
      if (!payload.toNumber || !payload.prompt) {
        return false;
      }
      const incomingPhoneNumbers =
        await TwilioProvider.twilioClient.incomingPhoneNumbers.list();

      const hasNumber = incomingPhoneNumbers.some(
        (number) => number.phoneNumber === payload.fromNumber
      );
      if (!hasNumber) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Failed to validate Twilio phone number:", error);
      throw error;
    }
  }

  setWsObject(ws: WebSocket) {
    this.ws = ws;
    this.setupWebSocket();
  }

  private setupWebSocket() {
    if (!this.ws) return;

    this.ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.event === "start") {
          console.log(message);
          console.log("Received start event from Twilio");
          this.isStarted = true;
          this.sid = message.streamSid;
        }

        if (message.event === "media") {
          if (this.listenerCallback) {
            this.listenerCallback(message.media.payload);
          }
          eventBus.emit("call.audio.chunk.received", {
            ctx: {
              callId: this.id,
              provider: "twilio",
              timestamp: Date.now(),
            },
            data: { chunk: message.media.payload, direction: "inbound" },
          });
        }

        if (message.event === "dtmf") {
          console.log("Received DTMF event from Twilio:", message.dtmf);
          const tone = message.dtmf.digit as DTMFTone;
          DTMFService.processDTMFTone(this.id, "twilio", tone);
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    });

    this.ws.on("close", () => {
      console.log("WebSocket connection closed");
      this.ws = null;
    });
  }

  public async send(audioData: string): Promise<void> {
    if (!this.ws) {
      console.log("WebSocket not connected");
      return;
    }

    try {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(audioData)) {
        throw new Error("Invalid base64 data received");
      }

      this.ws.send(
        JSON.stringify({
          event: "media",
          streamSid: this.sid,
          media: {
            payload: audioData,
          },
        })
      );
    } catch (error) {
      console.error("Error sending audio:", error);
      console.error(error);
    }
  }

  public async cancel(): Promise<void> {
    this.ws?.send(
      JSON.stringify({
        event: "clear",
        streamSid: this.sid,
      })
    );
  }

  public onListen(callback: (chunk: string) => void): void {
    this.listenerCallback = callback;
  }

  public async hangup(): Promise<void> {
    if (this.ws) {
      console.log("Hanging up call");
      this.ws.close();
      this.ws = null;
    }
    this.listenerCallback = null;
    this.isStarted = false;
  }

  public async transfer(toNumber: string): Promise<void> {
    const operator = (await import("./operator")).default;
    await operator.transfer(this.id, toNumber);
  }

  public setCallSid(callSid: string): void {
    this.callSid = callSid;
  }

  public getCallSid(): string | null {
    return this.callSid;
  }
}

export default TwilioProvider;
