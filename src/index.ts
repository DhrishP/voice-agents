import "dotenv/config";
import initialize from "./server";
import { validateEnv } from "./utils/env-validator";
import dotenv from "dotenv";

dotenv.config();

try {
  validateEnv();
  console.log("✅ Environment variables validated successfully");

  // Initialize servers
  initialize();
} catch (error) {
  console.error("Failed to start the application:");
  console.error(error);
  process.exit(1);
}
