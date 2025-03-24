import WebSocket from "ws";
import { TelephonyProvider } from "../../../types/providers/telephony";
import eventBus from "../../../engine";
import { VoiceCallJobData } from "../../../types/voice-call";
const alawmulaw = require("alawmulaw");
export class WebSocketProvider implements TelephonyProvider {
  private ws: WebSocket | null = null;
  private id: string;
  private callUuid: string | null = null;
  private listenerCallback: ((chunk: string) => void) | null = null;

  constructor(id: string) {
    this.id = id;
  }

  async validateInput(payload: VoiceCallJobData): Promise<boolean> {
    return !!payload.prompt;
  }

  setWsObject(ws: WebSocket) {
    console.log(
      `[${this.id}] setWsObject called, previous ws state:`,
      this.ws?.readyState
    );
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log(
        `[${this.id}] Warning: Attempting to set new WebSocket while existing one is still open`
      );
      return;
    }
    this.ws = ws;
    this.setupWebSocket();

    try {
      this.ws.send(
        JSON.stringify({
          event: "call.connected",
          message: "WebSocket connection successfully established",
        })
      );
      console.log(
        `[${this.id}] WebSocket connection established, current state:`,
        this.ws.readyState
      );

      eventBus.emit("websocket.ready", {
        ctx: {
          callId: this.id,
          provider: "websocket",
          timestamp: Date.now(),
        },
        data: {
          status: "connected",
        },
      });
    } catch (error) {
      console.error(`[${this.id}] Error in setWsObject:`, error);
    }
  }

  private setupWebSocket() {
    if (!this.ws) {
      console.log(`[${this.id}] setupWebSocket called but this.ws is null`);
      return;
    }
    console.log(
      `[${this.id}] Setting up WebSocket handlers, current state:`,
      this.ws.readyState
    );

    this.ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.event === "audio") {
          if (!message.data || typeof message.data !== "string") {
            throw new Error("Invalid audio data format");
          }

          try {
            const audioBuffer = Buffer.from(message.data, "base64");

            if (audioBuffer.length === 0) {
              return;
            }

            const hasAudio = audioBuffer.some((byte) => byte !== 0);
            if (!hasAudio) {
              return;
            }

            const audioFormat = message.format || "audio/l16";
            const sourceSampleRate = message.sampleRate || 8000;
            const targetSampleRate = 8000;
            const channels = message.channels || 1;

            let processedAudio;

            try {
              let samples = new Int16Array(
                audioBuffer.buffer,
                audioBuffer.byteOffset,
                audioBuffer.byteLength / 2
              );

              if (sourceSampleRate !== targetSampleRate) {
                if (sourceSampleRate > targetSampleRate) {
                  const ratio = Math.floor(sourceSampleRate / targetSampleRate);
                  const resampledLength = Math.floor(samples.length / ratio);
                  const resampledSamples = new Int16Array(resampledLength);

                  for (let i = 0; i < resampledLength; i++) {
                    resampledSamples[i] = samples[i * ratio];
                  }

                  samples = resampledSamples;
                  console.log(
                    `[${this.id}] Downsampled to ${samples.length} samples`
                  );
                }
              }

              processedAudio = this.encodeToMuLaw(samples);

              eventBus.emit("call.audio.chunk.received", {
                ctx: {
                  callId: this.id,
                  provider: "websocket",
                  timestamp: Date.now(),
                },
                data: {
                  chunk: Buffer.from(processedAudio).toString("base64"),
                  direction: "inbound",
                },
              });
            } catch (encodeError) {
              console.error(
                `[${this.id}] Error encoding audio to μ-Law:`,
                encodeError
              );
              throw encodeError;
            }
          } catch (e) {
            console.error(`[${this.id}] Error processing audio chunk:`, e);
            throw new Error("Invalid audio data");
          }
        }
      } catch (error: any) {
        console.error(
          `[${this.id}] Error processing WebSocket message:`,
          error
        );

        this.ws?.send(
          JSON.stringify({
            event: "error",
            message: error.message || "Unknown error occurred",
          })
        );
      }
    });

    this.ws.on("error", (error) => {
      console.error(`[${this.id}] WebSocket error:`, error);
      eventBus.emit("call.error", {
        ctx: { callId: this.id },
        error,
      });
    });

    this.ws.on("close", () => {
      console.log(
        `[${this.id}] WebSocket connection closed, previous state:`,
        this.ws?.readyState
      );
      this.ws = null;
      eventBus.emit("call.ended", {
        ctx: { callId: this.id },
        data: {
          errorReason: "WebSocket connection closed",
        },
      });
    });
  }

  private encodeToMuLaw(input: Buffer | Int16Array): Buffer {
    try {
      // Convert input to Int16Array if it's a Buffer
      let samples: Int16Array;
      if (Buffer.isBuffer(input)) {
        console.log(`Converting Buffer to Int16Array, length: ${input.length}`);
        samples = new Int16Array(
          input.buffer,
          input.byteOffset,
          input.byteLength / 2
        );
        console.log(`Created Int16Array with ${samples.length} samples`);
      } else {
        // Input is already Int16Array
        samples = input;
      }

      let encodedData;

      // Use only the library implementation
      try {
        if (alawmulaw && alawmulaw.mulaw) {
          encodedData = alawmulaw.mulaw.encode(samples);
        } else {
          throw new Error("alawmulaw library is required but not available");
        }
      } catch (libraryError) {
        console.error(`Error using μ-Law library: ${libraryError}`);
        throw libraryError; // Re-throw to prevent fallback to custom implementation
      }

      // Return the raw μ-law data as Buffer for use with Deepgram
      const result = Buffer.from(encodedData.buffer);

      return result;
    } catch (error) {
      console.error(`Error encoding to μ-Law: ${error}`);

      // Return original data as fallback if it's a buffer
      if (Buffer.isBuffer(input)) {
        console.log(
          `Returning original buffer as fallback, length: ${input.length}`
        );
        return input;
      }
      // Or convert Int16Array to Buffer
      console.log(
        `Returning original Int16Array as Buffer fallback, length: ${input.length}`
      );
      return Buffer.from(input.buffer);
    }
  }

  public async send(audioData: string | Buffer): Promise<void> {
    console.log(
      `[${this.id}] Send called, WebSocket state:`,
      this.ws?.readyState
    );
    if (!this.ws) {
      console.log(`[${this.id}] WebSocket not connected for call`);
      return;
    }

    try {
      console.log(`[${this.id}] Preparing to send audio data`);

      // Convert to string if buffer
      const dataToSend = Buffer.isBuffer(audioData)
        ? audioData.toString("base64")
        : audioData;

      if (
        typeof dataToSend === "string" &&
        !/^[A-Za-z0-9+/]*={0,2}$/.test(dataToSend)
      ) {
        throw new Error("Invalid base64 data received");
      }

      const audioBuffer = Buffer.isBuffer(audioData)
        ? audioData
        : Buffer.from(audioData, "base64");

      console.log(
        `Sending audio data of size ${audioBuffer.length} bytes for call ${this.id}`
      );

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            event: "audio.out",
            data: dataToSend,
            format: "audio/x-mulaw",
            sampleRate: 8000,
            timestamp: Date.now(),
          })
        );
        console.log(`Audio data sent successfully for call ${this.id}`);
      } else {
        console.error(
          `WebSocket not in OPEN state for call ${this.id}, current state: ${this.ws.readyState}`
        );
      }
    } catch (error: any) {
      console.error(`Error sending audio for call ${this.id}:`, error);

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            event: "error",
            message: error.message || "Failed to send audio",
            timestamp: Date.now(),
          })
        );
      }
    }
  }

  public async cancel(): Promise<void> {
    if (this.ws) {
      this.ws.send(
        JSON.stringify({
          event: "cancel",
        })
      );
    }
  }

  public onListen(callback: (chunk: string) => void): void {
    this.listenerCallback = callback;
  }

  public async hangup(): Promise<void> {
    console.log("hangup");
    if (this.ws) {
      this.ws.send(
        JSON.stringify({
          event: "call.ended",
        })
      );

      this.ws.close();
      this.ws = null;
    }

    this.listenerCallback = null;
  }

  public async transfer(toNumber: string): Promise<void> {
    // Transfer not implemented for WebSocket provider
    console.log("Transfer not supported in WebSocket provider");
    await this.hangup();
  }

  public setCallUuid(callUuid: string): void {
    this.callUuid = callUuid;
  }

  public getCallUuid(): string | null {
    return this.callUuid;
  }
}
export default WebSocketProvider;
