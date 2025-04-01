import WebSocket from "ws";
import { TelephonyProvider } from "../../../types/providers/telephony";
import eventBus from "../../../engine";
import { VoiceCallJobData, AudioChunkData } from "../../../types/voice-call";
import { engineError, callEnded } from "../../../utils/emit-functions";
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
  private FINAL_CHUNK_TIMEOUT = 800;
  private inputBuffer: Int16Array[] = [];
  private inputBufferSize = 0;
  private readonly MAX_INPUT_BUFFER_SIZE = 16000;
  private _processTimeoutId: NodeJS.Timeout | null = null;
  private _responseComplete: boolean = false;
  private _responsePending: boolean = false;

  constructor(id: string) {
    this.id = id;
  }

  async validateInput(payload: VoiceCallJobData): Promise<boolean> {
    if (payload.outputSchema) {
      try {
        JSON.parse(payload.outputSchema);
      } catch (error) {
        return false;
      }
    }
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
      engineError(this.id, error);
    });

    this.ws.on("close", () => {
      console.log(
        `[${this.id}] WebSocket connection closed, previous state:`,
        this.ws?.readyState
      );
      this.ws = null;
      callEnded(this.id, {
        errorReason: "WebSocket connection closed",
      });
    });
  }

  private async processInputAudio(audioData: string): Promise<void> {
    try {
      const audioBuffer = Buffer.from(audioData, "base64");
      const float32Data = new Float32Array(audioBuffer.buffer);

      const samples = new Int16Array(float32Data.length);
      for (let i = 0; i < float32Data.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Data[i]));
        samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      this.inputBuffer.push(samples);
      this.inputBufferSize += samples.length;

      if (this.inputBufferSize >= this.MAX_INPUT_BUFFER_SIZE) {
        await this.processAndSendInputBuffer();
      }
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

  private async processAndSendInputBuffer(): Promise<void> {
    try {
      if (this.inputBuffer.length === 0) return;

      const totalSamples = this.inputBufferSize;
      const combinedSamples = new Int16Array(totalSamples);
      let offset = 0;

      for (const buffer of this.inputBuffer) {
        combinedSamples.set(buffer, offset);
        offset += buffer.length;
      }

      const mulawData = this.encodeToMuLaw(combinedSamples);

      const eventData: AudioChunkData = {
        chunk: mulawData.toString("base64"),
        direction: "inbound",
        sampleRate: 8000,
        format: "mulaw",
        samples: totalSamples,
      };

      eventBus.emit("call.audio.chunk.received", {
        ctx: {
          callId: this.id,
          provider: "websocket",
          timestamp: Date.now(),
        },
        data: eventData,
      });

      this.inputBuffer = [];
      this.inputBufferSize = 0;

      console.log(
        `[${this.id}] Processed and sent ${totalSamples} input samples`
      );
    } catch (error) {
      console.error(`[${this.id}] Error processing input buffer:`, error);
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

    const now = Date.now();
    const timeSinceLastChunk = now - (this.lastChunkTime || now);

    if (
      timeSinceLastChunk < this.FINAL_CHUNK_TIMEOUT &&
      !this._responseComplete &&
      this._responsePending
    ) {
      console.log(
        `[${this.id}] Delaying chunk processing - only ${timeSinceLastChunk}ms since last chunk, waiting for more chunks`
      );
      if (this._processTimeoutId) {
        clearTimeout(this._processTimeoutId);
      }
      this._processTimeoutId = setTimeout(
        () => this.processAudioChunks(),
        this.FINAL_CHUNK_TIMEOUT
      );
      return;
    }

    this.isProcessing = true;
    this._responsePending = false;

    try {
      this.audioChunks.sort((a, b) => a.id - b.id);

      console.log(
        `[${this.id}] Processing ${this.audioChunks.length} chunks in sequence:`,
        this.audioChunks.map((c) => c.id).join(", ")
      );

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

      const combinedBuffer = new Int16Array(totalSamples);
      let offset = 0;

      for (const pcmChunk of combinedPcmData) {
        combinedBuffer.set(pcmChunk, offset);
        offset += pcmChunk.length;
      }

      const wavHeader = this.createWavHeader(
        combinedBuffer.length * 2,
        8000,
        1,
        16
      );

      const wavBuffer = Buffer.concat([
        wavHeader,
        Buffer.from(combinedBuffer.buffer),
      ]);

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
      this._responseComplete = false;
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

      if (this.audioChunks.length === 0) {
        this.responseStartTime = now;
        this._responsePending = true;
      }
      this.lastChunkTime = now;

      this.audioChunks.push({
        data: dataBuffer,
        id: this.nextChunkId++,
      });

      console.log(
        `[${this.id}] Added audio chunk ${this.nextChunkId - 1}. ` +
          `Queue size: ${this.audioChunks.length}, ` +
          `Chunk size: ${dataBuffer.length} bytes`
      );

      if (this._processTimeoutId) {
        clearTimeout(this._processTimeoutId);
      }

      const isSmallChunk = dataBuffer.length < 100;
      const timeoutDuration = isSmallChunk
        ? this.CHUNK_TIMEOUT
        : this.FINAL_CHUNK_TIMEOUT;

      this._processTimeoutId = setTimeout(async () => {
        const timeSinceLastChunk = Date.now() - (this.lastChunkTime || 0);

        if (timeSinceLastChunk >= timeoutDuration || isSmallChunk) {
          this._responseComplete = true;
          await this.processAudioChunks();
        }
      }, timeoutDuration);
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

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write("WAVE", 8);

    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
    buffer.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    buffer.write("data", 36);
    buffer.writeUInt32LE(dataLength, 40);

    return buffer;
  }

  public async cancel(): Promise<void> {
    await this.processAndSendInputBuffer();

    if (this.ws) {
      this.audioChunks = [];
      this.isProcessing = false;
      this.nextChunkId = 0;
      this.responseStartTime = null;
      this.lastChunkTime = null;
      this.inputBuffer = [];
      this.inputBufferSize = 0;
      this._responseComplete = false;
      this._responsePending = false;

      if (this._processTimeoutId) {
        clearTimeout(this._processTimeoutId);
        this._processTimeoutId = null;
      }

      eventBus.emit("call.audio.cancelled", {
        ctx: {
          callId: this.id,
          provider: "websocket",
          timestamp: Date.now(),
        },
      });

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
