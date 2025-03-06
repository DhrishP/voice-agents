import { Router } from "express";
import operator from "./operator";

function setupServer(app: Router) {
  app.post("/twiml/:callId", (req, res) => {
    const { callId } = req.params;
    const baseWsUrl = `wss://${req.get("host")}/stream`;

    try {
      const twiml = operator.generateTwiml(baseWsUrl, callId);
      console.log(twiml);
      res.type("text/xml").send(twiml);
    } catch (error) {
      console.log("error", error);
      res.status(404).json({ error: "Invalid call ID" });
    }
  });
}
