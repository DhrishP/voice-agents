import { VoiceCallQueue } from "../services/queue/voice-call-queue";
import { VoiceCallWorker } from "../services/queue/voice-call-worker";
import { VoiceCallRequest, VoiceCallRequestSchema } from "../types/voice-call";
import twilioService from "../services/telephony/twillio/twilio-service";
import { convertJsonSchemaToZod } from "../utils/schema";

export class TelephonyProvider {
  private static instance: TelephonyProvider;
  private queue: VoiceCallQueue;
  private worker: VoiceCallWorker;
  private isInitialized: boolean = false;
  private twilioService: typeof twilioService;

  private constructor() {
    this.queue = new VoiceCallQueue();
    this.worker = new VoiceCallWorker();
    this.twilioService = twilioService;
  }

  public static getInstance(): TelephonyProvider {
    if (!TelephonyProvider.instance) {
      TelephonyProvider.instance = new TelephonyProvider();
    }
    return TelephonyProvider.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
  }

  public async getCallIdFromJobId(jobId: string): Promise<string> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new Error(`Job with ID ${jobId} not found`);
    }
    return job.data.callId || "";
  }

  public async makeCall(request: VoiceCallRequest): Promise<string> {
    try {
      VoiceCallRequestSchema.parse(request);

      const job = await this.queue.addJob(request);

      if (!job.id) {
        throw new Error("Failed to create job: Job ID is undefined");
      }

      return job.id;
    } catch (error) {
      console.error("Error creating voice call:", error);
      throw error;
    }
  }

  public async send(callId: string, text: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const success = await this.twilioService.sendAudio(callId, text);
    if (!success) {
      throw new Error(`Failed to send audio to call ${callId}`);
    }
  }

  public async hangup(callId: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    await this.twilioService.hangupCall(callId);
  }

  public async cancel(callId: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    await this.twilioService.cancelCall(callId);
  }

  public onListen(callId: string, callback: (text: string) => void): void {
    if (!this.isInitialized) {
      console.warn("TelephonyProvider not initialized. Initializing now.");
      this.initialize().catch((error) => {
        console.error("Failed to initialize TelephonyProvider:", error);
      });
    }

    if (!this.twilioService.hasCall(callId)) {
      console.error(`No active call found with ID: ${callId} to listen to`);
      return;
    }

    this.twilioService.registerListener(callId, callback);
    console.log(`Listener registered for call ${callId}`);
  }

  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    await Promise.all([this.queue.close(), this.worker.close()]);

    this.isInitialized = false;
  }
}
