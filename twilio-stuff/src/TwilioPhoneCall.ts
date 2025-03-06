import WebSocket from "ws";

export class TwilioPhoneCall {
  private messageQueue: string[] = [];
  private ws: WebSocket | null = null;
  private listenerCallback: ((chunk: Buffer) => void) | null = null;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupWebSocket();
  }

  private setupWebSocket() {
    if (!this.ws) return;

    this.ws.on("message", (data: Buffer) => {
      console.log("message", data);
      if (this.listenerCallback) {
        this.listenerCallback(data);
      }
    });

    this.ws.on("close", () => {
      this.ws = null;
    });
  }

  public send(base64Audio: string): void {
    console.log("send", base64Audio);
    if (!this.ws) {
      this.messageQueue.push(base64Audio);
      return;
    }

    this.ws.send(Buffer.from(base64Audio, "base64"));
  }

  public cancel(): void {
    this.messageQueue = [];
  }

  public onListen(callback: (chunk: Buffer) => void): void {
    this.listenerCallback = callback;
  }

  public hangup(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageQueue = [];
    this.listenerCallback = null;
  }
}
