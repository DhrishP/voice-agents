import { z } from "zod";

export const VoiceCallRequestSchema = z.object({
  fromNumber: z.string().min(1, "From number is required"),
  toNumber: z.string().min(1, "To number is required"),
  prompt: z.string().min(1, "Prompt is required"),
  outputSchema: z.record(z.any()).optional(),
  provider: z.string().default("twilio"),
  callId: z.string().optional(),
});

export type VoiceCallRequest = z.infer<typeof VoiceCallRequestSchema>;

export const VoiceCallJobDataSchema = VoiceCallRequestSchema;

export type VoiceCallJobData = z.infer<typeof VoiceCallJobDataSchema>;

export const VoiceCallJobResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  timestamp: z.date(),
});

export type VoiceCallJobResult = z.infer<typeof VoiceCallJobResultSchema>;
