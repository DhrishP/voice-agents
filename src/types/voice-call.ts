import { z } from "zod";
import validator from "validator";

export const CallStatusSchema = z.enum([
  "INITIATED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const TranscriptTypeSchema = z.enum(["USER", "ASSISTANT", "TOOL"]);

export const UsageTypeSchema = z.enum(["LLM", "STT", "TTS", "TELEPHONY"]);

export const VoiceCallRequestSchema = z.object({
  fromNumber: z
    .string()
    .min(1, "From number is required")
    .refine(validator.isMobilePhone),
  toNumber: z
    .string()
    .min(1, "To number is required")
    .refine(validator.isMobilePhone),
  prompt: z.string().min(1, "Prompt is required"),
  outputSchema: z.record(z.string(), z.any()).optional(),
  telephonyProvider: z.string().default("twilio"),
  llmProvider: z.string().default("openai"),
  llmModel: z.string().default("gpt-4o"),
  sttProvider: z.string().default("deepgram"),
  sttModel: z.string().default("nova-2"),
  ttsProvider: z.string().default("elevenlabs"),
  ttsModel: z.string().default("eleven_multilingual_v2"),
  language: z.string().default("en-US"),
  callId: z.string().optional(),
});

export type VoiceCallRequest = z.infer<typeof VoiceCallRequestSchema>;
export type CallStatus = z.infer<typeof CallStatusSchema>;
export type TranscriptType = z.infer<typeof TranscriptTypeSchema>;
export type UsageType = z.infer<typeof UsageTypeSchema>;

export const VoiceCallJobDataSchema = VoiceCallRequestSchema;

export type VoiceCallJobData = z.infer<typeof VoiceCallJobDataSchema>;

export const VoiceCallJobResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  timestamp: z.date(),
});

export type VoiceCallJobResult = z.infer<typeof VoiceCallJobResultSchema>;
