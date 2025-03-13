import API from "./api";
import PhoneWorker from "./worker";
import { apiConfig } from "../config/api";
import { workerConfig } from "../config/worker";
import { twilioConfig } from "../config/twilio";
import TwilioServer from "./twilio";
import PlivoServer from "./plivo";
import { plivoConfig } from "../config/plivo";

async function initialize() {
  const api = new API(apiConfig.port);
  const worker = new PhoneWorker(workerConfig.observabilityPort);
  const twilio = new TwilioServer(twilioConfig.port);
  const plivo = new PlivoServer(plivoConfig.port);

  await api.start();
  await worker.start();
  await twilio.start();
  await plivo.start();

  process.on("SIGINT", async () => {
    await api.stop();
    await worker.stop();
    await twilio.stop();
    await plivo.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await api.stop();
    await worker.stop();
    await twilio.stop();
    await plivo.stop();
    process.exit(0);
  });
}

export default initialize;
