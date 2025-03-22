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

        // if (message.event === "hangup") {
        //   eventBus.emit("call.ended", {
        //     ctx: { callId: this.id },
        //     data: {
        //       errorReason: "Twilio call ended",
        //     },
        //   });
        // }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    });

    this.ws.on("close", () => {
      console.log("WebSocket connection closed");
      this.ws = null;
    });
  }

  public async send(audioData: string | Buffer): Promise<void> {
    if (!this.ws) {
      console.log("WebSocket not connected");
      return;
    }

    try {
      // If it's a Buffer and we detect it's a DTMF tone
      if (Buffer.isBuffer(audioData)) {
        if (this.callSid) {
          // The event data should be attached to the buffer
          const eventData = (audioData as any).eventData;
          console.log(eventData, "eventData");
          if (eventData?.sequence && typeof eventData.sequence === "string") {
            console.log(
              `[Twilio Provider] Sending DTMF sequence: ${eventData.sequence}`
            );

            try {
              this.ws.send(
                JSON.stringify({
                  event: "media",
                  streamSid: this.sid,
                  media: {
                    payload: audioData.toString("base64"),
                  },
                })
              );
              console.log(
                `[Twilio Provider] Sent DTMF sequence: ${eventData.sequence}`
              );
              return;
            } catch (dtmfError) {
              console.error("[Twilio Provider] Error sending DTMF:", dtmfError);
            }
          } else {
            console.error(
              "[Twilio Provider] No DTMF sequence found in event data"
            );
            return;
          }
        } else {
          console.error("[Twilio Provider] No callSid available for DTMF");
          return;
        }
      }

      // Regular audio streaming
      if (
        typeof audioData === "string" &&
        !/^[A-Za-z0-9+/]*={0,2}$/.test(audioData)
      ) {
        throw new Error("Invalid base64 data received");
      }

      this.ws.send(
        JSON.stringify({
          event: "media",
          streamSid: this.sid,
          media: {
            payload:
              typeof audioData === "string"
                ? audioData
                : audioData.toString("base64"),
          },
        })
      );
    } catch (error) {
      console.error("Error sending audio/DTMF:", error);
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
