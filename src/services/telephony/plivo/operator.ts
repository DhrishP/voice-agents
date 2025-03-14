import { Client } from "plivo";
import { v4 as uuidv4 } from "uuid";
import { PlivoProvider } from "./provider";
import { Call } from "@prisma/client";

export class PlivoOperator {
  private activeCallIds: Set<string> = new Set();
  private plivoClient: Client;
  private callIdToPhoneCall: Map<string, PlivoProvider> = new Map();
  private baseUrl: string;
  private callIdToCall: Map<string, Call> = new Map();
  constructor() {
    this.baseUrl = "";
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;

    if (!authId || !authToken) {
      throw new Error(
        "PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN environment variables are required"
      );
    }

    this.plivoClient = new Client(authId, authToken);
  }

  public async call(
    id: string,
    fromNumber: string,
    toNumber: string
  ): Promise<string> {
    const callId = id;

    try {
      const answerUrl = `${this.baseUrl}/plivo/answer/${callId}`;

      const response = await this.plivoClient.calls.create(
        fromNumber,
        toNumber,
        answerUrl
      );

      this.activeCallIds.add(callId);
      const phoneCall = new PlivoProvider(callId);
      this.callIdToPhoneCall.set(callId, phoneCall);

      if (response && response.requestUuid) {
        phoneCall.setCallUuid(response.requestUuid as string);
      }

      console.log(`Call initiated with ID: ${callId}`);
      return callId;
    } catch (error: any) {
      throw new Error(`Failed to initiate Plivo call: ${error.message}`);
    }
  }

  public generateXml(callId: string): string {
    try {
      if (!this.activeCallIds.has(callId)) {
        console.warn(
          `Warning: XML requested for unknown call ID ${callId}, providing default response`
        );
        return `<?xml version="1.0" encoding="UTF-8"?><Response><Speak>The call has ended.</Speak></Response>`;
      }

      const baseWsUrl = this.baseUrl.replace("https://", "ws://");
      const streamUrl = `${baseWsUrl}/plivo/stream/${callId}`;

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Stream streamTimeout="86400" keepCallAlive="true" bidirectional="true" contentType="audio/x-mulaw;rate=8000" audioTrack="inbound">
            ${streamUrl}
          </Stream>
        </Response>`;

      return xml;
    } catch (error) {
      console.error(`Error generating XML for call ${callId}:`, error);
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Speak>An error occurred.</Speak></Response>`;
    }
  }

  public async hangup(callId: string): Promise<void> {
    if (!this.activeCallIds.has(callId)) {
      throw new Error("Invalid call ID");
    }

    const provider = this.callIdToPhoneCall.get(callId);
    if (provider) {
      await provider.hangup();
    }

    this.activeCallIds.delete(callId);
  }

  public async setWsObject(callId: string, wsObject: any): Promise<void> {
    if (!this.callIdToPhoneCall.has(callId)) {
      throw new Error("Invalid call ID");
    }
    this.callIdToPhoneCall.get(callId)?.setWsObject(wsObject);
  }

  public async getPhoneCall(callId: string): Promise<PlivoProvider> {
    const phoneCall = this.callIdToPhoneCall.get(callId);
    if (!phoneCall) {
      throw new Error("Invalid call ID");
    }
    return phoneCall;
  }

  public async getBaseUrl(): Promise<string> {
    return this.baseUrl;
  }

  public async setBaseUrl(baseUrl: string): Promise<void> {
    this.baseUrl = baseUrl;
  }

  public async transfer(callId: string, toNumber: string): Promise<void> {
    try {
      if (!this.activeCallIds.has(callId)) {
        throw new Error(`No active call found for ID ${callId}`);
      }

      const phoneCall = await this.getPhoneCall(callId);
      const callUuid = phoneCall.getCallUuid();

      if (!callUuid) {
        throw new Error(`No call UUID found for call ID ${callId}`);
      }

      phoneCall.setTransferNumber(toNumber);

      console.log(`Initiating transfer for call ${callId} to ${toNumber}`);

      // Simplest possible approach with minimal parameters
      const authId = process.env.PLIVO_AUTH_ID as string;
      const authToken = process.env.PLIVO_AUTH_TOKEN as string;

      // Very simple formulation with only the minimum required parameters
      const url = `https://api.plivo.com/v1/Account/${authId}/Call/${callUuid}/`;
      const body = JSON.stringify({
        url: `${
          this.baseUrl
        }/plivo/direct-transfer/${callId}?number=${encodeURIComponent(
          toNumber
        )}`,
      });

      console.log(`POST ${url}`);
      console.log(`Body: ${body}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${authId}:${authToken}`
          ).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body,
      });

      const responseText = await response.text();
      console.log(`Response ${response.status}: ${responseText}`);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} - ${responseText}`);
      }

      console.log(`✅ Call transfer initiated successfully`);
    } catch (error) {
      console.error(`❌ Error transferring call ${callId}:`, error);
      throw error;
    }
  }
}

const operator = new PlivoOperator();

export default operator;
