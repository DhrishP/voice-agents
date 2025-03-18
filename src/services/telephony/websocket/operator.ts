import { v4 as uuidv4 } from "uuid";
import WebSocketProvider from "./provider";
import fs from "fs";
import path from "path";
import WebSocket from "ws";

export class WebSocketOperator {
  private activeCallIds: Set<string> = new Set();
  private callIdToPhoneCall: Map<string, WebSocketProvider> = new Map();
  private baseUrl: string;
  private recordingsDir: string;

  constructor() {
    this.baseUrl = "";
    this.recordingsDir = path.join(process.cwd(), "recordings");

    // Create recordings directory if it doesn't exist
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  public async createSession(id: string): Promise<string> {
    const callId = id || uuidv4();

    try {
      this.activeCallIds.add(callId);
      const provider = new WebSocketProvider(callId);
      this.callIdToPhoneCall.set(callId, provider);

      console.log(`WebSocket session created with ID: ${callId}`);
      return callId;
    } catch (error: any) {
      throw new Error(`Failed to create WebSocket session: ${error.message}`);
    }
  }

  /**
   * Ends a WebSocket session
   */
  public async hangup(callId: string): Promise<void> {
    if (!this.activeCallIds.has(callId)) {
      throw new Error("Invalid call ID");
    }

    const provider = this.callIdToPhoneCall.get(callId);
    if (provider) {
      await provider.hangup();
    }

    this.activeCallIds.delete(callId);
    this.callIdToPhoneCall.delete(callId);
  }

  /**
   * Sets the WebSocket object for a specific call ID
   */
  public async setWsObject(callId: string, wsObject: WebSocket): Promise<void> {
    if (!this.callIdToPhoneCall.has(callId)) {
      // Create a new session if it doesn't exist
      await this.createSession(callId);
    }

    this.callIdToPhoneCall.get(callId)?.setWsObject(wsObject);
  }

  /**
   * Gets the phone call provider for a specific call ID
   */
  public async getPhoneCall(callId: string): Promise<WebSocketProvider> {
    const phoneCall = this.callIdToPhoneCall.get(callId);
    if (!phoneCall) {
      throw new Error("Invalid call ID");
    }
    return phoneCall;
  }

  /**
   * Gets the base URL for the WebSocket server
   */
  public async getBaseUrl(): Promise<string> {
    return this.baseUrl;
  }

  /**
   * Sets the base URL for the WebSocket server
   */
  public async setBaseUrl(baseUrl: string): Promise<void> {
    this.baseUrl = baseUrl;
  }

  /**
   * Gets the directory where recordings are stored
   */
  public getRecordingsDir(): string {
    return this.recordingsDir;
  }
}

const operator = new WebSocketOperator();
export default operator;
