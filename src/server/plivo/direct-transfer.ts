import express from "express";

// Export a function that sets up the direct-transfer endpoint
export function setupDirectTransferEndpoint(app: express.Express) {
  app.post("/plivo/direct-transfer/:callId", (req, res) => {
    const { callId } = req.params;
    const toNumber = req.query.number || process.env.TRANSFER_PHONE_NUMBER;

    console.log(`DIRECT TRANSFER for call ${callId} to ${toNumber}`);

    // Create the simplest possible XML for a transfer
    const transferXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Transferring your call to a human agent. Please hold.</Speak>
  <Dial>${toNumber}</Dial>
</Response>`;

    console.log(`Transfer XML: ${transferXml}`);

    res.set("Content-Type", "application/xml");
    res.send(transferXml);
  });

  console.log("Direct transfer endpoint setup complete");
}
