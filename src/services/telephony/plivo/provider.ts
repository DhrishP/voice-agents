import WebSocket from "ws";
import { TelephonyProvider } from "../../../types/providers/telephony";
import eventBus from "../../../engine";
import { VoiceCallJobData } from "../../../types/voice-call";
import { Client } from "plivo";

export class PlivoProvider implements TelephonyProvider {
  private ws: WebSocket | null = null;
  private listenerCallback: ((chunk: string) => void) | null = null;
  private isStarted: boolean = false;
  private callUuid: string | null = null;
  private id: string;
  private static plivoClient: any;
  private streamId: string | null = null;

  constructor(id: string) {
    this.id = id;
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;

    if (!authId || !authToken) {
      throw new Error(
        "PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN environment variables are required"
      );
    }

    if (!PlivoProvider.plivoClient) {
      PlivoProvider.plivoClient = new Client(authId, authToken);
    }
  }

  async validateInput(payload: VoiceCallJobData): Promise<boolean> {
    try {
      if (!payload.toNumber || !payload.prompt) {
        return false;
      }

      const numbers = await PlivoProvider.plivoClient.numbers.list({});
      const hasNumber = numbers.some(
        (number: any) => number.number === payload.fromNumber
      );

      if (!hasNumber) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Failed to validate Plivo phone number:", error);
      throw error;
    }
  }

  setWsObject(ws: WebSocket) {
    this.ws = ws;
    this.setupWebSocket();
  }

  private setupWebSocket() {
    if (!this.ws) return;

    this.ws.on("message", (data: any) => {
      try {
        // Must parse as JSON first
        const message = JSON.parse(data.toString());

        // Handle start event and save streamId
        if (message.event === "start") {
          console.log("Stream started with ID:", message.start.streamId);
          this.streamId = message.start.streamId;
          return;
        }

        // Handle media events
        if (message.event === "media") {
          if (this.listenerCallback) {
            this.listenerCallback(message.media.payload);
          }

          eventBus.emit("call.audio.chunk.received", {
            ctx: {
              callId: this.id,
              provider: "plivo",
              timestamp: Date.now(),
            },
            data: { chunk: message.media.payload, direction: "inbound" },
          });
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    });

    this.ws.on("close", () => {
      console.log("Plivo WebSocket connection closed");
      this.ws = null;

      eventBus.emit("call.ended", {
        ctx: { callId: this.id },
        data: {
          errorReason: "WebSocket connection closed",
        },
      });
    });

    // Mark the connection as started when it's opened
    this.ws.on("open", () => {
      console.log("Plivo WebSocket connection opened");
      this.isStarted = true;
    });
  }

  public async send(audioData: string): Promise<void> {
    if (!this.ws) {
      console.log("WebSocket not connected");
      return;
    }

    try {
      // Must use the proper format that Plivo expects
      const audioMessage = {
        event: "playAudio",
        media: {
          contentType: "audio/x-mulaw",
          sampleRate: 8000,
          payload: audioData, // Already base64 encoded
        },
      };

      this.ws.send(JSON.stringify(audioMessage));
    } catch (error) {
      console.error("Error sending audio to Plivo:", error);
    }
  }

  public async cancel(): Promise<void> {
    if (!this.ws || !this.streamId) return;

    try {
      const clearAudioMessage = {
        event: "clearAudio",
        stream_id: this.streamId, // Must use streamId saved from 'start' event
      };

      this.ws.send(JSON.stringify(clearAudioMessage));
    } catch (error) {
      console.error("Error clearing audio:", error);
    }
  }
  public onListen(callback: (chunk: string) => void): void {
    this.listenerCallback = callback;
  }

  public async hangup(): Promise<void> {
    if (this.ws) {
      console.log("Closing Plivo WebSocket connection");
      try {
        this.ws.close();
      } catch (error) {
        console.log("Error closing WebSocket:", error);
      }
      this.ws = null;
    }

    if (this.callUuid) {
      try {
        await PlivoProvider.plivoClient.calls.hangup(this.callUuid);
      } catch (error: any) {
        if (error.status === 404) {
          console.log(
            `Plivo call ${this.callUuid} already ended, ignoring 404 error`
          );
        } else {
          console.log(
            `Non-critical error hanging up Plivo call:`,
            error.message || error
          );
        }
      }
    }

    this.listenerCallback = null;
    this.isStarted = false;
    this.callUuid = null; 
  }

  setCallUuid(uuid: string): void {
    this.callUuid = uuid;
  }
}

export default PlivoProvider;
