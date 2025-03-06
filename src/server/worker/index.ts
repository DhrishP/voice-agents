import { Queue, Worker, QueueEvents, Job } from "bullmq";
import connection, { QUEUE_NAMES } from "../../config/worker";
import Server from "../../types/server";
import express from "express";
import { createQueueDashExpressMiddleware } from "@queuedash/api";
import { VoiceCallJobData, VoiceCallJobResult } from "../../types/voice-call";
import eventBus from "../../engine";

// Initialize queue
const queue = new Queue(QUEUE_NAMES.VOICE_CALL, {
  connection,
});

// Initialize queue events
const queueEvents = new QueueEvents(QUEUE_NAMES.VOICE_CALL, {
  connection,
});

async function processJob(
  job: Job<VoiceCallJobData>
  // ): Promise<VoiceCallJobResult> {
): Promise<void> {
  try {
    console.log(`Processing job ${job.id} with data:`, job.data);
    eventBus.emit("call.initiated", {
      ctx: {
        callId: job.data.callId || "",
        provider: job.data.telephonyProvider,
        timestamp: Date.now(),
      },
      payload: job.data,
    });

    
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
  }
}

class PhoneWorker extends Server {
  public async start(): Promise<void> {
    // Initialize worker with enhanced monitoring settings
    const worker = new Worker(QUEUE_NAMES.VOICE_CALL, processJob, {
      connection,
      concurrency: 5,
      lockDuration: 30000, // Lock job for 30 seconds
      stalledInterval: 15000, // Check for stalled jobs every 15 seconds
      maxStalledCount: 3, // Allow 3 stalls before marking as failed
    });

    // Enhanced event listeners
    worker.on("active", (job) => {
      console.log(`Job ${job.id} has started processing`);
    });

    worker.on("completed", (job, result) => {
      console.log(`Job ${job.id} completed. Result:`, result);
    });

    worker.on("failed", (job, err) => {
      console.error(`Job ${job?.id} failed with error:`, err);
    });

    worker.on("progress", (job, progress) => {
      console.log(`Job ${job.id} progress: ${progress}%`);
    });

    worker.on("stalled", (job) => {
      console.warn(`Job ${job} has stalled`);
    });

    worker.on("error", (err) => {
      console.error("Worker error:", err);
    });

    queueEvents.on("completed", ({ jobId, returnvalue }) => {
      console.log(
        `Queue event: Job ${jobId} completed with result:`,
        returnvalue
      );
    });

    queueEvents.on("failed", ({ jobId, failedReason }) => {
      console.error(
        `Queue event: Job ${jobId} failed with reason:`,
        failedReason
      );
    });

    queueEvents.on("stalled", ({ jobId }) => {
      console.warn(`Queue event: Job ${jobId} has stalled`);
    });

    queueEvents.on("progress", ({ jobId, data }) => {
      console.log(`Queue event: Job ${jobId} progress:`, data);
    });

    // Monitor queue metrics
    setInterval(async () => {
      const metrics = {
        completed: await queue.getMetrics("completed"),
        failed: await queue.getMetrics("failed"),
      };
      const jobCounts = await queue.getJobCounts();
      console.log("Queue metrics:", metrics);
      console.log("Job counts:", jobCounts);
    }, 60000);

    const app = express();

    app.use(
      "/",
      createQueueDashExpressMiddleware({
        ctx: {
          queues: [
            {
              queue: new Queue(QUEUE_NAMES.VOICE_CALL, {
                connection,
              }),
              displayName: "Voice Call Processing",
              type: "bullmq" as any,
            },
          ],
        },
      })
    );

    app.listen(this.port, () => {
      console.log(`Worker Observability is running on port ${this.port}`);
    });

    this.instance = worker;
    this.url = `${process.env.HOST_URL}:${this.port}`;
  }

  public async stop(): Promise<void> {
    await this.instance.close();
  }
}

export { queue, queueEvents };
export default PhoneWorker;
