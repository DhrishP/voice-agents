import WebSocket from "ws";
import fs from "fs";
import { TelephonyProvider } from "../../../types/providers/telephony";

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

          // test the send, cancel, and hangup functions
          this.test();
          setTimeout(() => {
            this.cancel();
          }, 5000);
          setTimeout(() => {
            this.hangup();
          }, 10000);
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

  private async test() {
    if (!this.isStarted || !this.ws) {
      console.log("Cannot play audio: call not started or WebSocket closed");
      return;
    }

    try {
      // Convert audio to mulaw using ffmpeg
      const audioData = fs.readFileSync("output.mulaw").toString("base64");
      this.send(audioData);
      console.log("Audio sent");
    } catch (error) {
      console.error("Error playing audio file:", error);
    }
  }

  public async send(base64Audio: string): Promise<void> {
    if (!this.ws) {
      console.log("WebSocket not connected");
      return;
    }

    console.log("Sending audio to Twilio", {
      event: "media",
      streamSid: this.sid,
      media: {
        payload: base64Audio,
      },
    });

    this.ws.send(
      JSON.stringify({
        event: "media",
        streamSid: this.sid,
        media: {
          payload: base64Audio,
        },
      })
    );
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
