import { EventEmitter } from "events";
import { OpenAIService } from "../services/ai/openai";

export interface AIEvents {
  chunk: (text: string) => void;
  error: (error: Error) => void;
}

export interface AIProvider {
  initialize(): Promise<void>;
  generate(systemPrompt: string, prompt: string): Promise<string>;
  pipe(text: string): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
}

export default class AIService extends EventEmitter {
  private provider: AIProvider;
  private currentResponse: string = "";

  constructor() {
    super();

    this.provider = new OpenAIService();

    this.provider.on("chunk", (text: string) => {
      this.onChunk(text);
    });

    this.provider.on("error", (error: Error) => {
      this.emit("error", error);
    });
  }

  private onChunk(text: string): void {
    console.log("🤖 AI chunk received:", text);
    this.currentResponse += text;
    this.emit("chunk", text);

    if (text.match(/[.!?](\s|$)/)) {
      this.emit("response", this.currentResponse);
      this.currentResponse = "";
    }
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
  }

  async generate(systemPrompt: string, prompt: string): Promise<string> {
    return await this.provider.generate(systemPrompt, prompt);
  }

  async pipe(text: string): Promise<void> {
    await this.provider.pipe(text);
  }
}
