import prisma from "../../db/client";

class UsageTrackingService {
  private callMetrics: Map<
    string,
    {
      startTime: number;
      lastActivityTime: number;
      firstAudioTime?: number;
      lastAudioTime?: number;
      ttsCharCount: number;
      sttDuration: number;
      hasHadAudioActivity: boolean;
    }
  > = new Map();

  initializeTracking(callId: string): void {
    const now = Date.now();
    this.callMetrics.set(callId, {
      startTime: now,
      lastActivityTime: now,
      ttsCharCount: 0,
      sttDuration: 0,
      hasHadAudioActivity: false,
    });
    console.log(`📊 Initialized usage tracking for call ${callId}`);
  }

  updateActivity(callId: string): void {
    const metrics = this.callMetrics.get(callId);
    if (!metrics) return;

    metrics.lastActivityTime = Date.now();
    this.callMetrics.set(callId, metrics);
  }

  trackAudioActivity(callId: string): void {
    const metrics = this.callMetrics.get(callId);
    if (!metrics) return;

    const now = Date.now();

    if (!metrics.hasHadAudioActivity) {
      metrics.firstAudioTime = now;
      metrics.hasHadAudioActivity = true;
    }

    metrics.lastAudioTime = now;
    this.callMetrics.set(callId, metrics);
  }

  trackSTTUsage(callId: string, chunkSize: number): void {
    const metrics = this.callMetrics.get(callId);
    if (!metrics) return;

    const audioSeconds = chunkSize * 0.000125;
    metrics.sttDuration += audioSeconds;
    this.trackAudioActivity(callId);
    this.callMetrics.set(callId, metrics);
  }

  trackTTSUsage(callId: string, text: string): void {
    if (!text) return;

    const metrics = this.callMetrics.get(callId);
    if (!metrics) return;

    metrics.ttsCharCount += text.length;
    this.callMetrics.set(callId, metrics);
  }

  async saveUsageMetrics(callId: string): Promise<void> {
    const metrics = this.callMetrics.get(callId);
    if (!metrics) return;

    try {
      const setupOverhead = 2000;

      let callDurationMs: number;
      if (metrics.firstAudioTime && metrics.lastAudioTime) {
        callDurationMs = metrics.lastAudioTime - metrics.firstAudioTime + 1000;
        console.log(`Using audio-based duration: ${callDurationMs / 1000}s`);
      } else {
        callDurationMs =
          metrics.lastActivityTime - metrics.startTime - setupOverhead;
        console.log(`Using activity-based duration: ${callDurationMs / 1000}s`);
      }

      const callDurationSeconds = Math.max(
        1,
        Math.round(callDurationMs / 1000)
      );

      console.log(`📊 Saving usage metrics for call ${callId}:`);
      console.log(`  - Call Duration: ${callDurationSeconds} seconds`);
      console.log(`  - STT Usage: ${Math.round(metrics.sttDuration)} seconds`);
      console.log(`  - TTS Usage: ${metrics.ttsCharCount} characters`);

      await prisma.call.update({
        where: { id: callId },
        data: {
          telephonyDuration: callDurationSeconds,
          sttUsage: Math.round(metrics.sttDuration),
          ttsUsage: metrics.ttsCharCount,
        },
      });

      this.callMetrics.delete(callId);
    } catch (error) {
      console.error(`❌ Error saving usage metrics for call ${callId}:`, error);
    }
  }
}

export default new UsageTrackingService();
