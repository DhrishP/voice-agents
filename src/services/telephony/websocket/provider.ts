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

    eventBus.on("call.audio.chunk.synthesized", (event) => {
      if (event.ctx.callId === this.id && event.data.chunk) {
        this.send(
          typeof event.data.chunk === "string"
            ? event.data.chunk
            : event.data.chunk.toString("base64")
        );
      }
    });
  }

  async validateInput(payload: VoiceCallJobData): Promise<boolean> {
    return !!payload.prompt;
  }

  setWsObject(ws: WebSocket) {
    this.ws = ws;
    this.setupWebSocket();

    try {
      this.ws.send(
        JSON.stringify({
          event: "call.connected",
          message: "WebSocket connection successfully established",
        })
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
    } catch (error) {}
  }

  private setupWebSocket() {
    if (!this.ws) return;

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
                    `Downsampled to ${samples.length} samples for call ${this.id}`
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

              console.log(
                `Audio chunk processed successfully for call ${this.id} - μ-law at ${targetSampleRate}Hz`
              );

              const firstFewBytes = Buffer.from(processedAudio).slice(0, 10);
              console.log(`First bytes of μ-law audio: ${[...firstFewBytes]}`);
            } catch (encodeError) {
              console.error(`Error encoding audio to μ-Law: ${encodeError}`);
              throw encodeError;
            }
          } catch (e) {
            console.error(
              `Error processing audio chunk for call ${this.id}:`,
              e
            );
            throw new Error("Invalid audio data");
          }
        } else if (message.event === "call.started") {
          console.log(`Call.started event received for call ID: ${this.id}`);
          this.ws?.send(
            JSON.stringify({
              event: "call.connected",
              message: "WebSocket connection established and ready for audio",
            })
          );

          eventBus.emit("call.initiated", {
            ctx: {
              callId: this.id,
              provider: "websocket",
              timestamp: Date.now(),
            },
            payload: {
              callId: this.id,
              telephonyProvider: "websocket",
              prompt:
                "You are a helpful voice assistant. Keep your responses concise and clear. Answer the user's questions helpfully.",
              fromNumber: "+15555555555",
              toNumber: "+15555555555",
              llmProvider: "openai",
              llmModel: "gpt-4o",
              sttProvider: "deepgram",
              sttModel: "nova-2",
              ttsProvider: "elevenlabs",
              ttsModel: "eleven_multilingual_v2",
              language: "en-US",
            },
          });
        }
      } catch (error: any) {
        console.error(
          `Error processing WebSocket message for call ${this.id}:`,
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
      console.error(`WebSocket error for call ${this.id}:`, error);
      eventBus.emit("call.error", {
        ctx: { callId: this.id },
        error,
      });
    });

    this.ws.on("close", () => {
      console.log(`WebSocket connection closed for call ${this.id}`);
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
        console.log(`Using provided Int16Array with ${samples.length} samples`);
      }

      let encodedData;

      // Use only the library implementation
      try {
        if (alawmulaw && alawmulaw.mulaw) {
          console.log(
            `Using alawmulaw library to encode ${samples.length} samples to μ-law`
          );
          encodedData = alawmulaw.mulaw.encode(samples);
          console.log(
            `Successfully encoded to μ-law using library, result length: ${encodedData.length}`
          );
        } else {
          throw new Error("alawmulaw library is required but not available");
        }
      } catch (libraryError) {
        console.error(`Error using μ-Law library: ${libraryError}`);
        throw libraryError; // Re-throw to prevent fallback to custom implementation
      }

      // Return the raw μ-law data as Buffer for use with Deepgram
      const result = Buffer.from(encodedData.buffer);
      console.log(
        `Returning μ-law encoded buffer with size: ${result.length} bytes`
      );
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
    if (!this.ws) {
      console.log(`WebSocket not connected for call ${this.id}`);
      return;
    }

    try {
      console.log(`Preparing to send audio data for call ${this.id}`);

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
