import WebSocket from "ws";
import { TelephonyProvider } from "../../../types/providers/telephony";
import eventBus from "../../../engine";
import { VoiceCallJobData } from "../../../types/voice-call";
import { Client } from "plivo";
import DTMFService from "../../dtmf";
import { DTMFTone } from "../../../types/dtmf";
import { callEnded } from "../../../utils/emit-functions";
import {
  VALID_LANGUAGES,
  VALID_LLM_PROVIDERS,
  VALID_STT_PROVIDERS,
  VALID_TTS_PROVIDERS,
} from "../../../config/valid-parameters";
export class PlivoProvider implements TelephonyProvider {
  private ws: WebSocket | null = null;
  private listenerCallback: ((chunk: string) => void) | null = null;
  private callUuid: string | null = null;
  private id: string;
  private static plivoClient: any;
  private streamId: string | null = null;
  private transferNumber: string | null = null;

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

  async validateInput(
    payload: VoiceCallJobData
  ): Promise<{ isValid: boolean; error: string | null }> {
    try {
      if (!payload.toNumber || !payload.prompt) {
        return { isValid: false, error: "Invalid input" };
      }

      if (!VALID_LLM_PROVIDERS.includes(payload.llmProvider)) {
        return { isValid: false, error: "Invalid LLM provider" };
      }

      if (!VALID_TTS_PROVIDERS.includes(payload.ttsProvider)) {
        return { isValid: false, error: "Invalid TTS provider" };
      }

      if (!VALID_STT_PROVIDERS.includes(payload.sttProvider)) {
        return { isValid: false, error: "Invalid STT provider" };
      }

      if (!payload.language) {
        return { isValid: false, error: "Invalid language" };
      }

      if (!VALID_LANGUAGES.includes(payload.language)) {
        return { isValid: false, error: "Invalid language" };
      }

      if (!(payload.tools.length === 0)) {
        payload.tools.forEach((element) => {
          try {
            if (!element.name) {
              return {
                isValid: false,
                error: "all tool calls should include a name",
              };
            }
            if (!JSON.parse(element.parameters)) {
              return {
                isValid: false,
                error: "schema structure should be an proper JSON",
              };
            }
            if (!element.apiUrl) {
              return { isValid: false, reason: "api url doesnt exists" };
            }
            if (!element.apiUrl.includes("https://")) {
              return { isValid: false, error: "Invalid api url" };
            }

            if (!element.prompt) {
              return { isValid: false, error: "No prompt exists" };
            }
          } catch (err: any) {
            return { isValid: false, error: err.message };
          }
        });
      }
      const numbers = await PlivoProvider.plivoClient.numbers.list({});
      const hasNumber = numbers.some(
        (number: any) => number.number === payload.fromNumber
      );
      if (payload.outputSchema) {
        try {
          JSON.parse(payload.outputSchema);
        } catch (error) {
          return { isValid: false, error: "Invalid output schema" };
        }
      }
      if (!hasNumber) {
        return { isValid: false, error: "Invalid input" };
      }

      return { isValid: true, error: null };
    } catch (error: any) {
      console.error("Failed to validate Plivo phone number:", error);
      return { isValid: false, error: error.message };
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
        const message = JSON.parse(data.toString());

        if (message.event === "start") {
          console.log("Stream started with ID:", message.start.streamId);
          this.streamId = message.start.streamId;
          return;
        }

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

        if (message.event === "dtmf") {
          console.log("Received DTMF event from Plivo:", message);

          if (message.dtmf && message.dtmf.digit) {
            // Format from actual logs
            const tone = message.dtmf.digit as DTMFTone;
            DTMFService.processDTMFTone(this.id, "plivo", tone);
          } else if (message.digit) {
            const tone = message.digit as DTMFTone;
            DTMFService.processDTMFTone(this.id, "plivo", tone);
          } else if (message.tone) {
            // Alternative format if using tone instead of digit (as per docs)
            const tone = message.tone as DTMFTone;
            DTMFService.processDTMFTone(this.id, "plivo", tone);
          } else {
            console.error(
              "Received DTMF event but couldn't extract digit or tone:",
              message
            );
          }
        }

        // if (message.event === "hangup") {
        //   eventBus.emit("call.ended", {
        //     ctx: { callId: this.id },
        //     data: {
        //       errorReason: "Plivo call ended",
        //     },
        //   });
        // }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    });

    this.ws.on("close", () => {
      console.log("Plivo WebSocket connection closed");
      this.ws = null;

      callEnded(this.id, {
        errorReason: "WebSocket connection closed",
      });
    });

    this.ws.on("open", () => {
      console.log("Plivo WebSocket connection opened");
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
        // The event data should be attached to the buffer
        const eventData = (audioData as any).eventData;
        if (eventData?.sequence && typeof eventData.sequence === "string") {
          console.log(
            `[Plivo Provider] Sending DTMF sequence: ${eventData.sequence}`
          );

          try {
            // Send DTMF as PCM 16-bit audio
            const audioMessage = {
              event: "playAudio",
              media: {
                contentType: "audio/x-l16",
                sampleRate: 8000,
                payload: audioData.toString("base64"),
              },
            };
            this.ws.send(JSON.stringify(audioMessage));
            console.log(
              `[Plivo Provider] Sent DTMF sequence: ${eventData.sequence}`
            );
            return;
          } catch (dtmfError) {
            console.error("[Plivo Provider] Error sending DTMF:", dtmfError);
          }
        } else {
          console.error(
            "[Plivo Provider] No DTMF sequence found in event data"
          );
          return;
        }
      }

      // Regular audio streaming (keep as µ-law for non-DTMF audio)
      const audioMessage = {
        event: "playAudio",
        media: {
          contentType: "audio/x-mulaw",
          sampleRate: 8000,
          payload:
            typeof audioData === "string"
              ? audioData
              : audioData.toString("base64"),
        },
      };

      this.ws.send(JSON.stringify(audioMessage));
    } catch (error) {
      console.error("Error sending audio/DTMF to Plivo:", error);
    }
  }

  public async cancel(): Promise<void> {
    if (!this.ws || !this.streamId) {
      console.log("Cannot cancel: WebSocket or streamId not initialized");
      return;
    }

    try {
      const clearAudioMessage = {
        event: "clearAudio",
        stream_id: this.streamId,
      };

      this.ws.send(JSON.stringify(clearAudioMessage));
    } catch (error) {
      console.error("Error sending clearAudio event to Plivo:", error);
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
    this.callUuid = null;
  }

  public setCallUuid(callUuid: string): void {
    this.callUuid = callUuid;
  }

  public getCallUuid(): string | null {
    return this.callUuid;
  }

  public async transfer(toNumber: string): Promise<void> {
    // Import the operator here to avoid circular dependencies
    const operator = (await import("./operator")).default;
    await operator.transfer(this.id, toNumber);
  }

  public setTransferNumber(transferNumber: string): void {
    this.transferNumber = transferNumber;
  }

  public getTransferNumber(): string | null {
    return this.transferNumber;
  }
}

export default PlivoProvider;
