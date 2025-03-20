import WebSocket from "ws";
import { TelephonyProvider } from "../../../types/providers/telephony";
import eventBus from "../../../engine";
import { VoiceCallJobData } from "../../../types/voice-call";
import alawmulaw from "alawmulaw";

export class WebSocketProvider implements TelephonyProvider {
  private ws: WebSocket | null = null;
  private listenerCallback: ((chunk: string) => void) | null = null;
  private isStarted: boolean = false;
  private id: string;
  private callUuid: string | null = null;

  constructor(id: string) {
    this.id = id;
    console.log(`WebSocketProvider created with ID: ${id}`);

    // Subscribe to audio chunk events
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
    console.log(`Setting WebSocket object for call ID: ${this.id}`);
    this.ws = ws;
    this.setupWebSocket();

    // Immediately mark as started without emitting an event
    this.isStarted = true;

    // Send a confirmation to the client that we're connected
    try {
      this.ws.send(
        JSON.stringify({
          event: "call.connected",
          message: "WebSocket connection successfully established",
        })
      );

      // Emit an event to signal that the WebSocket connection is ready
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
      console.error(
        `Error sending connection confirmation for call ${this.id}:`,
        error
      );
    }
  }

  private setupWebSocket() {
    if (!this.ws) return;

    console.log(
      `Setting up WebSocket for call ID: ${this.id}, isStarted=${this.isStarted}`
    );

    this.isStarted = true;

    this.ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(
          `WebSocket message received for call ${this.id}, event: ${
            message.event
          }, data length: ${message.data?.length || 0}`
        );

        if (message.event === "audio") {
          console.log(`Received audio data for call ${this.id}, processing...`);

          if (!message.data || typeof message.data !== "string") {
            console.error(
              `Invalid audio data format for call ${this.id}:`,
              message.data
            );
            throw new Error("Invalid audio data format");
          }

          try {
            // Decode base64 to get the binary audio data
            const audioBuffer = Buffer.from(message.data, "base64");
            console.log(
              `Received audio chunk size: ${audioBuffer.length} bytes for call ${this.id}`
            );

            // Validate audio buffer
            if (audioBuffer.length === 0) {
              console.warn(`Received empty audio buffer for call ${this.id}`);
              return;
            }

            // Check if we have actual audio data
            const hasAudio = audioBuffer.some((byte) => byte !== 0);
            if (!hasAudio) {
              console.warn(`Received silent audio buffer for call ${this.id}`);
              return;
            }

            // Convert audio to A-Law format if needed
            let processedAudio = message.data;
            if (
              message.format === "audio/wav" ||
              message.format === "audio/pcm"
            ) {
              try {
                console.log(
                  `Converting ${message.format} to A-Law encoding for call ${this.id}`
                );
                processedAudio = this.encodeAudio(audioBuffer);
                console.log(
                  `Encoded audio with A-Law, original size: ${audioBuffer.length}`
                );
              } catch (encodeError) {
                console.error(
                  `Error encoding audio with A-Law: ${encodeError}`
                );
                // Continue with original audio data
                console.log(
                  `Using original ${message.format} audio data for call ${this.id}`
                );
              }
            } else {
              console.log(
                `Using original audio format (${
                  message.format || "unknown"
                }) for call ${this.id}`
              );
            }

            if (this.listenerCallback) {
              console.log(
                `Forwarding audio chunk to listener for call ${this.id}`
              );
              this.listenerCallback(processedAudio);
            }

            // Store audio format info for debugging
            const audioFormat = message.format || "audio/wav";
            const sampleRate = message.sampleRate || 16000;
            const channels = message.channels || 1;

            console.log(
              `Audio info for call ${this.id}: format=${audioFormat}, sampleRate=${sampleRate}, channels=${channels}`
            );

            // Emit event with essential audio metadata
            console.log(
              `Emitting audio.chunk.received event for call ${this.id}`
            );
            eventBus.emit("call.audio.chunk.received", {
              ctx: {
                callId: this.id,
                provider: "websocket",
                timestamp: Date.now(),
              },
              data: {
                chunk: processedAudio,
                direction: "inbound",
              },
            });

            if (message.text) {
              console.log(
                `Received transcription for call ${this.id}: ${message.text}`
              );
              eventBus.emit("call.transcription.chunk.created", {
                ctx: {
                  callId: this.id,
                  provider: "websocket",
                  timestamp: Date.now(),
                },
                data: {
                  transcription: message.text,
                },
              });

              eventBus.emit("call.speech.detected", {
                ctx: {
                  callId: this.id,
                },
                data: {
                  transcription: message.text,
                },
              });
            }

            console.log(
              `Audio chunk processed successfully for call ${this.id}`
            );
          } catch (e) {
            console.error(
              `Error processing audio chunk for call ${this.id}:`,
              e
            );
            throw new Error("Invalid base64 audio data");
          }
        } else if (message.event === "call.started") {
          console.log(`Call.started event received for call ID: ${this.id}`);
          this.ws?.send(
            JSON.stringify({
              event: "call.connected",
              message: "WebSocket connection established and ready for audio",
            })
          );

          // Emit call.initiated event similar to Plivo
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

  private encodeAudio(
    audioBuffer: Buffer,
    format: "alaw" | "mulaw" = "alaw"
  ): string {
    try {
      // Create Int16Array view of the buffer for encoding
      const samples = new Int16Array(
        audioBuffer.buffer,
        audioBuffer.byteOffset,
        audioBuffer.byteLength / 2
      );

      let encodedData;

      // Encode to either A-Law or mu-Law based on the format parameter
      if (format === "alaw") {
        encodedData = alawmulaw.alaw.encode(samples);
        console.log(
          `Encoded audio with A-Law encoding, original size: ${audioBuffer.length}`
        );
      } else {
        encodedData = alawmulaw.mulaw.encode(samples);
        console.log(
          `Encoded audio with mu-Law encoding, original size: ${audioBuffer.length}`
        );
      }

      // Convert back to base64 and return
      return Buffer.from(encodedData).toString("base64");
    } catch (error) {
      console.error(`Error encoding to ${format}: ${error}`);
      // Return original data as fallback
      return audioBuffer.toString("base64");
    }
  }

  public async send(audioData: string): Promise<void> {
    if (!this.ws) {
      console.log(`WebSocket not connected for call ${this.id}`);
      return;
    }

    try {
      console.log(`Preparing to send audio data for call ${this.id}`);

      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(audioData)) {
        throw new Error("Invalid base64 data received");
      }

      const audioBuffer = Buffer.from(audioData, "base64");
      console.log(
        `Sending audio data of size ${audioBuffer.length} bytes for call ${this.id}`
      );

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            event: "audio.out",
            data: audioData,
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
    this.isStarted = false;
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
