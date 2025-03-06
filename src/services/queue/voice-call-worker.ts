import { Worker, Job } from "bullmq";
import connection, { QUEUE_NAMES } from "../../config/worker";
import { VoiceCallJobData, VoiceCallJobResult } from "../../types/voice-call";
import twilioService, { TwilioCall } from "../telephony/twillio/twilio-service";

export class VoiceCallWorker {
  private worker: Worker<VoiceCallJobData, VoiceCallJobResult>;

  constructor() {
    this.worker = new Worker<VoiceCallJobData, VoiceCallJobResult>(
      QUEUE_NAMES.VOICE_CALL,
      async (job: Job<VoiceCallJobData>) => this.processJob(job),
      {
        connection,
        concurrency: 5,
        autorun: true,
        lockDuration: 300000,
        stalledInterval: 60000,
      }
    );

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.worker.on("completed", (job) => {
      console.log(`Worker completed job ${job.id}`);
    });

    this.worker.on("failed", (job, error) => {
      console.error(`Worker failed job ${job?.id}:`, error);
    });

    this.worker.on("error", (error) => {
      console.error("Worker error:", error);
    });
  }

  private async processJob(
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

  getWorker(): Worker<VoiceCallJobData, VoiceCallJobResult> {
    return this.worker;
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
