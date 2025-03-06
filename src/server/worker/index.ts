import { Queue, Worker, QueueEvents, Job } from "bullmq";
import connection, { QUEUE_NAMES } from "../../config/worker";
import Server from "../../types/server";
import express from "express";
import { createQueueDashExpressMiddleware } from "@queuedash/api";
import { VoiceCallJobData, VoiceCallJobResult } from "../../types/voice-call";
import { TwilioCall } from "../../services/telephony/twillio";
import twilioService from "../../services/telephony/twillio/twilio-service";

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
): Promise<VoiceCallJobResult> {
  try {
    console.log(`Processing job ${job.id} with data:`, job.data);

    await job.updateProgress(10);

    const { fromNumber, toNumber, prompt, outputSchema, telephonyProvider } =
      job.data;
    let call: TwilioCall | undefined = undefined;

    if (telephonyProvider === "twilio") {
      const { callId } = await twilioService.makeCall(
        fromNumber,
        toNumber,
        prompt
      );
      call = twilioService.getCall(callId);
      job.data.callId = call?.getId();
      console.log("Call ID:", job.data.callId);

      await job.updateData({
        ...job.data,
        callId,
      });
    }
    if (!call) {
      throw new Error("Failed to create call");
    }

    const audioData: string[] = [];

    call.on("media", (payload: any) => {
      audioData.push(payload);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Call connection timeout"));
      }, 60000);

      call.on("connected", () => {
        clearTimeout(timeout);
        resolve();
      });

      call.on("disconnected", (reason?: string) => {
        clearTimeout(timeout);
        if (reason && !reason.includes("Call completed")) {
          reject(new Error(`Call disconnected: ${reason}`));
        } else {
          console.log(`Call completed normally: ${reason}`);
          resolve();
        }
      });

      call.on("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    await job.updateProgress(50);

    await new Promise<void>((resolve) => {
      call.on("disconnected", () => {
        resolve();
      });
    });

    await job.updateProgress(100);

    return {
      success: true,
      data: {
        fromNumber,
        toNumber,
        prompt,
        callSid: call.getCallSid(),
        audioData,
        callId: call ? call.getId() : undefined,
        result: "Voice call processed successfully",
      },
      timestamp: new Date(),
    };
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date(),
    };
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
              queue: new Queue("report", {
                connection,
              }),
              displayName: "Reports Processing",
              type: "bullmq" as any,
            },
            {
              queue: new Queue("work-order", {
                connection,
              }),
              displayName: "Work Order Processing",
              type: "bullmq" as any,
            },
            {
              queue: new Queue("opendental-work-order", {
                connection,
              }),
              displayName: "OpenDental Work Order Processing",
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
