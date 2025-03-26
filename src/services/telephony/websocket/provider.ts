import WebSocket from "ws";
import { TelephonyProvider } from "../../../types/providers/telephony";
import eventBus from "../../../engine";
import { VoiceCallJobData } from "../../../types/voice-call";
const alawmulaw = require("alawmulaw");

interface AudioChunk {
  data: Buffer;
  id: number;
}

export class WebSocketProvider implements TelephonyProvider {
  private ws: WebSocket | null = null;
  private id: string;
  private callUuid: string | null = null;
  private listenerCallback: ((chunk: string) => void) | null = null;
  private audioChunks: AudioChunk[] = [];
  private isProcessing: boolean = false;
  private nextChunkId: number = 0;
  private isGenerating: boolean = false;

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

  private async processAudioChunks(): Promise<void> {
    if (this.isProcessing || this.audioChunks.length === 0) return;

    this.isProcessing = true;

    try {
      // Sort chunks by ID to ensure correct sequence (though they should already be in sequence from ElevenLabs)
      this.audioChunks.sort((a, b) => a.id - b.id);

      // Log chunk sequence for debugging
      console.log(
        `[${this.id}] Processing chunks in sequence:`,
        this.audioChunks.map((c) => c.id).join(", ")
      );

      // Combine all PCM data
      let combinedPcmData: Int16Array[] = [];
      let totalSamples = 0;

      for (const chunk of this.audioChunks) {
        try {
          const pcmData = alawmulaw.mulaw.decode(new Uint8Array(chunk.data));
          combinedPcmData.push(new Int16Array(pcmData.buffer));
          totalSamples += pcmData.length;
        } catch (error) {
          console.error(
            `[${this.id}] Error decoding chunk ${chunk.id}:`,
            error
          );
        }
      }

      // Create combined buffer
      const combinedBuffer = new Int16Array(totalSamples);
      let offset = 0;

      for (const pcmChunk of combinedPcmData) {
        combinedBuffer.set(pcmChunk, offset);
        offset += pcmChunk.length;
      }

      // Create WAV header
      const wavHeader = this.createWavHeader(
        combinedBuffer.length * 2,
        8000,
        1,
        16
      );

      // Combine header and PCM data
      const wavBuffer = Buffer.concat([
        wavHeader,
        Buffer.from(combinedBuffer.buffer),
      ]);

      // Send combined audio
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            event: "audio.out",
            data: wavBuffer.toString("base64"),
            format: "wav",
            sampleRate: 8000,
            timestamp: Date.now(),
            totalChunks: this.audioChunks.length,
            processedIds: this.audioChunks.map((c) => c.id),
          })
        );

        console.log(
          `[${this.id}] Sent combined audio of ${this.audioChunks.length} chunks, ` +
            `total size: ${wavBuffer.length} bytes, ` +
            `chunk IDs: ${this.audioChunks.map((c) => c.id).join(", ")}`
        );
      }

      // Clear the chunks
      this.audioChunks = [];
    } catch (error) {
      console.error(`[${this.id}] Error processing audio chunks:`, error);
    } finally {
      this.isProcessing = false;
      // If we're not generating anymore and this was the last chunk, reset the chunk counter
      if (!this.isGenerating) {
        this.nextChunkId = 0;
      }
    }
  }

  public async send(audioData: string | Buffer): Promise<void> {
    if (!this.ws) {
      console.log(`[${this.id}] WebSocket not connected for call`);
      return;
    }

    try {
      const dataBuffer = Buffer.isBuffer(audioData)
        ? audioData
        : Buffer.from(audioData, "base64");

      // Mark that we're receiving chunks
      this.isGenerating = true;

      // Add chunk to queue
      this.audioChunks.push({
        data: dataBuffer,
        id: this.nextChunkId++,
      });

      console.log(
        `[${this.id}] Added audio chunk ${this.nextChunkId - 1}. ` +
          `Queue size: ${this.audioChunks.length}, ` +
          `Chunk size: ${dataBuffer.length} bytes`
      );

      // Process chunks if we have accumulated enough or if this seems to be the last chunk
      if (dataBuffer.length < 10000 || this.audioChunks.length >= 5) {
        this.isGenerating = false;
        await this.processAudioChunks();
      }
    } catch (error: any) {
      console.error(`[${this.id}] Error queueing audio:`, error);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            event: "error",
            message: error.message || "Failed to queue audio",
            timestamp: Date.now(),
          })
        );
      }
    }
  }

  private createWavHeader(
    dataLength: number,
    sampleRate: number,
    numChannels: number,
    bitsPerSample: number
  ): Buffer {
    const buffer = Buffer.alloc(44);

    // RIFF chunk descriptor
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write("WAVE", 8);

    // fmt sub-chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // audio format (PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28); // byte rate
    buffer.writeUInt16LE((numChannels * bitsPerSample) / 8, 32); // block align
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataLength, 40);

    return buffer;
  }

  public async cancel(): Promise<void> {
    if (this.ws) {
      // Clear any pending chunks
      this.audioChunks = [];
      this.isProcessing = false;
      this.isGenerating = false;
      this.nextChunkId = 0;

      // Emit cancel event
      eventBus.emit("call.audio.cancelled", {
        ctx: {
          callId: this.id,
          provider: "websocket",
          timestamp: Date.now(),
        },
      });

      // Send cancel event to client
      this.ws.send(
        JSON.stringify({
          event: "cancel",
          timestamp: Date.now(),
        })
      );

      console.log(`[${this.id}] Audio queue cleared and playback cancelled`);
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
