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
  private responseStartTime: number | null = null;
  private lastChunkTime: number | null = null;
  private CHUNK_TIMEOUT = 300;
  private inputProcessor: ScriptProcessorNode | null = null;
  private inputStream: MediaStream | null = null;

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

    this.ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.event === "audio") {
          if (!message.data || typeof message.data !== "string") {
            throw new Error("Invalid audio data format");
          }

          await this.processInputAudio(message.data);
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

  private async processInputAudio(audioData: string): Promise<void> {
    try {
      // Convert base64 to Float32Array (raw audio from frontend)
      const audioBuffer = Buffer.from(audioData, "base64");
      const float32Data = new Float32Array(audioBuffer.buffer);

      // Convert Float32Array to Int16Array
      const samples = new Int16Array(float32Data.length);
      for (let i = 0; i < float32Data.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Data[i]));
        samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Encode to µ-law
      const mulawData = this.encodeToMuLaw(samples);

      // Emit the processed chunk
      eventBus.emit("call.audio.chunk.received", {
        ctx: {
          callId: this.id,
          provider: "websocket",
          timestamp: Date.now(),
        },
        data: {
          chunk: mulawData.toString("base64"),
          direction: "inbound",
        },
      });
    } catch (error) {
      console.error(`[${this.id}] Error processing input audio:`, error);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            event: "error",
            message: "Failed to process audio input",
            timestamp: Date.now(),
          })
        );
      }
    }
  }

  private encodeToMuLaw(input: Int16Array): Buffer {
    try {
      if (!alawmulaw?.mulaw) {
        throw new Error("alawmulaw library is required but not available");
      }

      const encodedData = alawmulaw.mulaw.encode(input);
      return Buffer.from(encodedData.buffer);
    } catch (error) {
      console.error(`[${this.id}] Error encoding to μ-Law:`, error);
      return Buffer.from(input.buffer);
    }
  }

  private async processAudioChunks(): Promise<void> {
    if (this.isProcessing || this.audioChunks.length === 0) return;

    this.isProcessing = true;

    try {
      // Sort chunks by ID to ensure correct sequence
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
            `chunk IDs: ${this.audioChunks.map((c) => c.id).join(", ")}, ` +
            `total response time: ${
              this.responseStartTime
                ? Date.now() - this.responseStartTime
                : "unknown"
            }ms`
        );
      }
      this.audioChunks = [];
      this.nextChunkId = 0;
      this.responseStartTime = null;
      this.lastChunkTime = null;
    } catch (error) {
      console.error(`[${this.id}] Error processing audio chunks:`, error);
    } finally {
      this.isProcessing = false;
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

      const now = Date.now();

      // If this is the first chunk of a new response
      if (this.audioChunks.length === 0) {
        this.responseStartTime = now;
      }
      this.lastChunkTime = now;

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

      // Clear any existing timeout
      if (this._processTimeout) {
        clearTimeout(this._processTimeout);
      }

      // Set a timeout to process chunks if no new chunks arrive
      this._processTimeout = setTimeout(async () => {
        const timeSinceLastChunk = Date.now() - (this.lastChunkTime || 0);
        if (timeSinceLastChunk >= this.CHUNK_TIMEOUT) {
          await this.processAudioChunks();
        }
      }, this.CHUNK_TIMEOUT);
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
      // Clear any pending chunks and state
      this.audioChunks = [];
      this.isProcessing = false;
      this.nextChunkId = 0;
      this.responseStartTime = null;
      this.lastChunkTime = null;
      if (this._processTimeout) {
        clearTimeout(this._processTimeout);
      }

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

  private _processTimeout: NodeJS.Timeout | null = null;
}
export default WebSocketProvider;
