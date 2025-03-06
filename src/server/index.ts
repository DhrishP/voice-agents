import API from "./api";
import PhoneWorker from "./worker";
import { apiConfig } from "../config/api";
import { workerConfig } from "../config/worker";
import { twilioConfig } from "../config/twilio";
import TwilioServer from "./twilio";

async function initialize() {
  const api = new API(apiConfig.port);
  const worker = new PhoneWorker(workerConfig.observabilityPort);
  const twilio = new TwilioServer(twilioConfig.port);

  await api.start();
  await worker.start();
  await twilio.start();

  
  process.on("SIGINT", async () => {
    await api.stop();
    await worker.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await api.stop();
    await worker.stop();
    process.exit(0);
  });
}

export default initialize;
