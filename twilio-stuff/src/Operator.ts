import VoiceResponse = require("twilio/lib/twiml/VoiceResponse");
import { v4 as uuidv4 } from "uuid";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

export class Operator {
  private activeCallIds: Set<string> = new Set();
  private twilioClient: twilio.Twilio;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      throw new Error(
        "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables are required"
      );
    }

    this.twilioClient = twilio(accountSid, authToken);
  }

  public async call(
    baseApiUrl: string,
    fromNumber: string,
    toNumber: string
  ): Promise<string> {
    const callId = uuidv4();

    try {
      const call = await this.twilioClient.calls.create({
        from: fromNumber,
        to: toNumber,
        url: `${baseApiUrl}/twiml/${callId}`,
      });

      this.activeCallIds.add(callId);
      return callId;
    } catch (error: any) {
      throw new Error(`Failed to initiate Twilio call: ${error.message}`);
    }
  }

  public generateTwiml(baseWsUrl: string, callId: string): string {
    if (!this.activeCallIds.has(callId)) {
      throw new Error("Invalid call ID");
    }

    const twiml = new VoiceResponse();
    twiml.connect().stream({
      url: `${baseWsUrl}/${callId}`,
    });

    return twiml.toString();
  }

  public async hangup(callId: string): Promise<void> {
    if (!this.activeCallIds.has(callId)) {
      throw new Error("Invalid call ID");
    }
    this.activeCallIds.delete(callId);
  }
}
