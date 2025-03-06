import { Queue, QueueEvents } from "bullmq";
import connection, { QUEUE_NAMES } from "../../config/worker";
import { VoiceCallJobData, VoiceCallJobResult } from "../../types/voice-call";

export class VoiceCallQueue {
  private queue: Queue<VoiceCallJobData, VoiceCallJobResult>;
  private queueEvents: QueueEvents;

  constructor() {
    this.queue = new Queue<VoiceCallJobData, VoiceCallJobResult>(
      QUEUE_NAMES.VOICE_CALL,
      {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
          removeOnComplete: {
            age: 24 * 3600,
            count: 1000,
          },
          removeOnFail: {
            age: 7 * 24 * 3600,
          },
        },
      }
    );

    this.queueEvents = new QueueEvents(QUEUE_NAMES.VOICE_CALL, {
      connection,
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.queueEvents.on("completed", ({ jobId, returnvalue }) => {
      console.log(`Job ${jobId} completed with result:`, returnvalue);
    });

    this.queueEvents.on("failed", ({ jobId, failedReason }) => {
      console.error(`Job ${jobId} failed with reason:`, failedReason);
    });

    this.queueEvents.on("stalled", ({ jobId }) => {
      console.warn(`Job ${jobId} stalled`);
    });
  }

  async addJob(
    data: VoiceCallJobData,
    opts?: { priority?: number; delay?: number; jobId?: string }
  ) {
    return this.queue.add("voice-call", data, {
      priority: opts?.priority,
      delay: opts?.delay,
      jobId: opts?.jobId,
    });
  }

  async getJob(jobId: string) {
    return this.queue.getJob(jobId);
  }

  async removeJob(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
      return true;
    }
    return false;
  }

  getQueue(): Queue<VoiceCallJobData, VoiceCallJobResult> {
    return this.queue;
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.queueEvents.close();
  }
}
