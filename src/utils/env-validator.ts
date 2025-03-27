import { z } from "zod";

const envSchema = z.object({
  // Redis Configuration
  REDIS_HOST: z.string(),
  REDIS_PORT: z.string().transform(Number),
  REDIS_PASSWORD: z.string().optional(),

  // Voice Agent Configuration
  VOICE_AGENT_CONCURRENCY: z.string().transform(Number),

  // API Keys
  DEEPGRAM_API_KEY: z.string(),
  OPENAI_API_KEY: z.string(),
  GEMINI_API_KEY: z.string(),
  ELEVENLABS_API_KEY: z.string(),

  // Twilio Configuration
  TWILIO_ACCOUNT_SID: z.string(),
  TWILIO_AUTH_TOKEN: z.string(),

  // Ngrok Configuration
  NGROK_AUTHTOKEN: z.string(),
  SERVER_URL: z.string(),
  HOST_URL: z.string(),

  // Database Configuration
  DATABASE_URL: z.string(),

  // AWS Configuration
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string(),
  AWS_S3_ACCESS_KEY: z.string(),
  AWS_S3_SECRET_KEY: z.string(),

  // Plivo Configuration
  PLIVO_AUTH_TOKEN: z.string(),
  PLIVO_AUTH_ID: z.string(),
  PLIVO_PORT: z.string().transform(Number),

  // WebSocket Configuration
  WEBSOCKET_PORT: z.string().transform(Number).optional(),

  // Transfer Configuration
  TRANSFER_PHONE_NUMBER: z.string(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(): EnvConfig {
  try {
    const config = envSchema.parse(process.env);
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Invalid environment variables:");
      error.errors.forEach((err) => {
        console.error(`   - ${err.path.join(".")}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}
