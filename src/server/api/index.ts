import express, { Request, Response, NextFunction } from "express";
import expressWs from "express-ws";
import cors from "cors";
import morgan from "morgan";
import Server from "../../types/server";
import { QUEUE_NAMES } from "../../config/worker";
import { queue } from "../worker";
import { Job } from "bullmq";
import { v4 } from "uuid";

const app = expressWs(express()).app;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  morgan(":method :url :status :response-time ms - :res[content-length]")
);

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.get("/test", (req, res) => {
  queue.add(QUEUE_NAMES.VOICE_CALL, { 
    callId: v4(),
    fromNumber: process.env.FROM_NUMBER,
    toNumber: process.env.TO_NUMBER,
    prompt:
      "You are a voice agent. You will talk to the user and help them with their questions.",
    telephonyProvider: "twilio",
    sttProvider: "deepgram",
    ttsProvider: "elevenlabs",
    llmProvider: "openai",
  });
  res.send("Call initiated");
});

app.post("/api/calls", (req, res) => {
  try {
    const {
      fromNumber,
      toNumber,
      prompt,
      telephonyProvider = "twilio",
      sttProvider = "deepgram",
      ttsProvider = "elevenlabs",
      llmProvider = "openai",
    } = req.body;

    if (!fromNumber || !toNumber || !prompt) {
      res.status(400).json({
        error:
          "Missing required fields: fromNumber, toNumber, and prompt are required",
      });
    }

    queue
      .add(QUEUE_NAMES.VOICE_CALL, {
        fromNumber,
        toNumber,
        prompt,
        telephonyProvider,
        sttProvider,
        ttsProvider,
        llmProvider,
      })
      .then((job) => {
        res.status(201).json({
          message: "Call initiated successfully",
          jobId: job.id,
        });
      })
      .catch((error) => {
        console.error("Failed to initiate call:", error);
        res.status(500).json({ error: "Failed to initiate call" });
      });
  } catch (error) {
    console.error("Failed to initiate call:", error);
    res.status(500).json({ error: "Failed to initiate call" });
  }
});

app.get("/api/calls/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;

  queue
    .getJob(jobId)
    .then((job: Job | null) => {
      if (!job) {
        return res.status(404).json({ error: "Call not found" });
      }

      job
        .getState()
        .then((state: string) => {
          res.json({
            id: job.id,
            state,
            progress: job.progress,
            data: job.data,
          });
        })
        .catch((error: Error) => {
          console.error("Failed to get call status:", error);
          res.status(500).json({ error: "Failed to get call status" });
        });
    })
    .catch((error: Error) => {
      console.error("Failed to get call status:", error);
      res.status(500).json({ error: "Failed to get call status" });
    });
});

app.delete("/api/calls/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;

  queue
    .getJob(jobId)
    .then((job: Job | null) => {
      if (!job) {
        return res.status(404).json({ error: "Call not found" });
      }

      job
        .remove()
        .then(() => {
          res.json({ message: "Call cancelled successfully" });
        })
        .catch((error: Error) => {
          console.error("Failed to cancel call:", error);
          res.status(500).json({ error: "Failed to cancel call" });
        });
    })
    .catch((error: Error) => {
      console.error("Failed to cancel call:", error);
      res.status(500).json({ error: "Failed to cancel call" });
    });
});

app.post("/api/calls/:jobId/hangup", (req, res) => {
  const { jobId } = req.params;

  queue
    .getJob(jobId)
    .then(async (job) => {
      if (!job) {
        return res.status(404).json({ error: "Call not found" });
      }

      try {
        const callId = job.data.callId;

        if (!callId) {
          return res
            .status(400)
            .json({ error: "Call ID not found in job data" });
        }

        const telephonyProvider = job.data.telephonyProvider || "twilio";

        const { Operator } = await import(
          `../../services/telephony/${telephonyProvider}/operator`
        );
        const operator = new Operator();

        await operator.hangup(callId);

        await job.moveToCompleted("Call terminated by API request", job.id);

        res.json({
          message: "Call terminated successfully",
          jobId,
          callId,
        });
      } catch (error: any) {
        console.error("Failed to hangup call:", error);
        res
          .status(500)
          .json({ error: "Failed to hangup call", details: error.message });
      }
    })
    .catch((error) => {
      console.error("Failed to retrieve job:", error);
      res.status(500).json({ error: "Failed to retrieve job" });
    });
});

app.delete("/api/queue/empty", (req, res) => {
  try {
    queue
      .getJobCounts()
      .then(async (counts) => {
        const totalJobs = Object.values(counts).reduce(
          (sum, count) => sum + count,
          0
        );

        try {
          // Empty the queue
          await queue.obliterate({ force: true });

          res.json({
            message: "Queue emptied successfully",
            removedJobs: totalJobs,
            details: counts,
          });
        } catch (error: any) {
          console.error("Failed to empty queue:", error);
          res
            .status(500)
            .json({ error: "Failed to empty queue", details: error.message });
        }
      })
      .catch((error) => {
        console.error("Failed to get job counts:", error);
        res.status(500).json({ error: "Failed to get job counts" });
      });
  } catch (error) {
    console.error("Error emptying queue:", error);
    res.status(500).json({ error: "Server error while emptying queue" });
  }
});

class Api extends Server {
  public async start(): Promise<void> {
    app.listen(this.port, () => {
      console.log(`API is running on port ${this.port}`);
    });
    this.instance = app;
    this.url = `${process.env.HOST_URL}:${this.port}`;
  }

  public async stop(): Promise<void> {
    this.instance.close();
  }
}

export default Api;
