import dotenv from "dotenv";

dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD,
};

export const QUEUE_NAMES = {
  VOICE_CALL: "voice-call-queue",
};

export const workerConfig = {
  connection,
  queueNames: QUEUE_NAMES,
  observabilityPort: parseInt(process.env.OBSERVABILITY_PORT || "4000"),
};

export default connection;
