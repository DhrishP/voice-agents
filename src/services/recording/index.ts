import s3Service from "../storage/s3";
import { s3Config } from "../../config/s3";
import { Buffer } from "buffer";
import eventBus from "../../events";
import prisma from "../../db/client";
import path from "path";
import fs from "fs";
import { promisify } from "util";

const writeFileAsync = promisify(fs.writeFile);

const LOCAL_RECORDINGS_DIR = path.join(process.cwd(), "recordings");
try {
  if (!fs.existsSync(LOCAL_RECORDINGS_DIR)) {
    fs.mkdirSync(LOCAL_RECORDINGS_DIR, { recursive: true });
  }
} catch (error) {
  console.error("Failed to create recordings directory:", error);
}

export class RecordingService {
  private recordings: Map<
    string,
    {
      audioChunks: Array<{
        chunk: Buffer;
        timestamp: number;
        source: "user" | "assistant";
      }>;
      startTime: number;
    }
  > = new Map();

  startRecording(callId: string): void {
    this.recordings.set(callId, {
      audioChunks: [],
      startTime: Date.now(),
    });

    console.log(`🎙️ Started recording for call ${callId}`);
  }

  addAudioChunk(
    callId: string,
    chunk: string | Buffer,
    source: "user" | "assistant"
  ): void {
    const recording = this.recordings.get(callId);
    if (!recording) {
      console.warn(`⚠️ No recording found for call ${callId}`);
      return;
    }

    try {
      let buffer: Buffer;

      if (typeof chunk === "string") {
        buffer = Buffer.from(chunk, "base64");
      } else if (Buffer.isBuffer(chunk)) {
        buffer = chunk;
      } else {
        console.warn(`⚠️ Unrecognized chunk format for call ${callId}`);
        return;
      }

      console.log(`Adding ${source} audio chunk: ${buffer.length} bytes`);

      recording.audioChunks.push({
        chunk: buffer,
        timestamp: Date.now(),
        source,
      });
    } catch (error) {
      console.error(
        `❌ Error adding audio chunk to recording for call ${callId}:`,
        error
      );
    }
  }

  async finishRecording(callId: string): Promise<string | null> {
    const recording = this.recordings.get(callId);
    if (!recording) {
      console.warn(`⚠️ No recording found for call ${callId}`);
      return null;
    }

    try {
      const sortedChunks = [...recording.audioChunks].sort(
        (a, b) => a.timestamp - b.timestamp
      );

      console.log(`Chronological chunk sequence for call ${callId}:`);
      sortedChunks.forEach((chunk, index) => {
        console.log(
          `  ${index + 1}. ${chunk.source} at ${new Date(
            chunk.timestamp
          ).toISOString()} - ${chunk.chunk.length} bytes`
        );
      });

      let lastMeaningfulChunkIndex = sortedChunks.length - 1;
      const MIN_MEANINGFUL_CHUNK_SIZE = 50;

      for (let i = sortedChunks.length - 1; i >= 0; i--) {
        if (sortedChunks[i].chunk.length >= MIN_MEANINGFUL_CHUNK_SIZE) {
          lastMeaningfulChunkIndex = i;
          break;
        }
      }

      const BUFFER_CHUNKS = 3;
      const lastIncludedIndex = Math.min(
        lastMeaningfulChunkIndex + BUFFER_CHUNKS,
        sortedChunks.length - 1
      );

      console.log(
        `Trimming recording: Including chunks 0 to ${lastIncludedIndex} out of ${
          sortedChunks.length - 1
        } total`
      );

      const trimmedChunks = sortedChunks.slice(0, lastIncludedIndex + 1);

      const combinedChunks = Buffer.concat(
        trimmedChunks.map((item) => item.chunk)
      );

      const durationMs =
        trimmedChunks.length > 0
          ? trimmedChunks[trimmedChunks.length - 1].timestamp -
            recording.startTime
          : 0;
      const durationSec = Math.ceil(durationMs / 1000);

      // Generate filenames
      const timestamp = Date.now();
      const fileName = `call-${callId}-${timestamp}.ulaw`;
      const key = path.join("recordings", fileName);

      // Save locally - only one combined file
      const localFilePath = path.join(LOCAL_RECORDINGS_DIR, fileName);
      await writeFileAsync(localFilePath, combinedChunks);
      console.log(`✅ Local recording saved to: ${localFilePath}`);

      // Try to upload to S3 if credentials are available
      let url = null;
      try {
        url = await s3Service.uploadFile(key, combinedChunks, "audio/basic");
        console.log(`✅ S3 URL: ${url}`);

        // Update call record in database with S3 details
        await prisma.call.update({
          where: { id: callId },
          data: {
            recordingUrl: url,
            recordingDuration: durationSec,
            recordingS3Key: key,
            recordingS3Bucket: s3Config.bucket,
            recordingS3Region: s3Config.region,
            recordingFormat: "ulaw",
          },
        });
      } catch (s3Error: any) {
        console.warn(
          `⚠️ S3 upload failed, recording saved locally only: ${s3Error.message}`
        );
        // Still update duration in database
        await prisma.call.update({
          where: { id: callId },
          data: {
            recordingDuration: durationSec,
          },
        });
      }

      this.recordings.delete(callId);

      console.log(
        `✅ Recording saved for call ${callId}, duration: ${durationSec}s`
      );

      eventBus.emit("call.recording.saved", {
        // !for future usecase
        ctx: { callId },
        data: {
          url: url || localFilePath,
          durationSec,
          localFilePath,
        },
      });

      return url;
    } catch (error) {
      console.error(`❌ Error finishing recording for call ${callId}:`, error);
      return null;
    }
  }
}

export default new RecordingService();
