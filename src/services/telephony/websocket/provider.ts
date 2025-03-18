import WebSocket from "ws";
import { TelephonyProvider } from "../../../types/providers/telephony";
import eventBus from "../../../engine";
import { VoiceCallJobData } from "../../../types/voice-call";

export class WebSocketProvider implements TelephonyProvider {
  private ws: WebSocket | null = null;
  private listenerCallback: ((chunk: string) => void) | null = null;
  private isStarted: boolean = false;
  private id: string;
  private callId: string | null = null;

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
          `WebSocket message received for call ${this.id}, event: ${message.event}`
        );

        if (message.event === "audio") {
          console.log(`Received audio data for call ${this.id}, processing...`);

          if (!message.data || typeof message.data !== "string") {
            throw new Error("Invalid audio data format");
          }

          try {
            const audioBuffer = Buffer.from(message.data, "base64");
            console.log(
              `Received audio chunk size: ${audioBuffer.length} bytes for call ${this.id}`
            );

            if (this.listenerCallback) {
              console.log(
                `Forwarding audio chunk to listener for call ${this.id}`
              );
              this.listenerCallback(message.data);
            }

            eventBus.emit("call.audio.chunk.received", {
              ctx: {
                callId: this.id,
                provider: "websocket",
                timestamp: Date.now(),
              },
              data: {
                chunk: message.data,
                direction: "inbound",
              },
            });

            if (message.text) {
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
        } else if (message.event === "text") {
          console.log(
            `Text message received for call ${this.id}: ${message.data}`
          );

          if (message.data && typeof message.data === "string") {
            eventBus.emit("call.transcription.chunk.created", {
              ctx: {
                callId: this.id,
                provider: "websocket",
                timestamp: Date.now(),
              },
              data: {
                transcription: message.data,
              },
            });

            eventBus.emit("call.speech.detected", {
              ctx: {
                callId: this.id,
              },
              data: {
                transcription: message.data,
              },
            });
          }
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

  public setCallId(callId: string): void {
    this.callId = callId;
  }

  public getCallId(): string | null {
    return this.callId;
  }
}
export default WebSocketProvider;
