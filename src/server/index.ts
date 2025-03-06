import API from "./api";
import PhoneWorker from "./worker";
import { apiConfig } from "../config/api";
import { workerConfig } from "../config/worker";

async function initialize() {
  const api = new API(apiConfig.port);
  const worker = new PhoneWorker(workerConfig.observabilityPort);

  await api.start();
  await worker.start();

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
