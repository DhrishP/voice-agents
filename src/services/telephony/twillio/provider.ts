import WebSocket from "ws";
import fs from "fs";
import { TelephonyProvider } from "../../../types/providers/telephony";
import { mulaw } from "alawmulaw";

export class TwilioProvider implements TelephonyProvider {
  private ws: WebSocket | null = null;
  private listenerCallback: ((chunk: string) => void) | null = null;
  private isStarted: boolean = false;
  private sid: string | null = null;

  constructor() {}

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
      const rawBuffer = Buffer.from(audioData, "base64");

      const alignedBuffer = Buffer.alloc(rawBuffer.length);
      rawBuffer.copy(alignedBuffer);

      const samples = new Int16Array(
        alignedBuffer.buffer,
        alignedBuffer.byteOffset,
        alignedBuffer.length / 2
      );

      const mulawData = mulaw.encode(samples);

      const mulawBase64 = Buffer.from(mulawData).toString("base64");

      console.log("📞 Audio conversion:", {
        inputLength: audioData.length,
        rawBufferSize: rawBuffer.length,
        samplesLength: samples.length,
        mulawLength: mulawData.length,
        outputLength: mulawBase64.length,
        firstFewSamples: Array.from(samples.slice(0, 3)),
        firstFewMulaw: Array.from(mulawData.slice(0, 3)),
        sampleRate: 8000,
      });

      this.ws.send(
        JSON.stringify({
          event: "media",
          streamSid: this.sid,
          media: {
            payload: mulawBase64,
          },
        })
      );
    } catch (error) {
      console.error("Error converting to mulaw:", error);
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
}

export default TwilioProvider;
