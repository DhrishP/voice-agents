import { EventEmitter } from "events";
import { AIEvents, AIService } from "../../types/providers/ai";
import { openai } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";

export class OpenAIService extends EventEmitter implements AIService {
  private isInitialized = false;
  private currentResponse: string = "";

  constructor() {
    super();
  }

  private onChunk(text: string): void {
    this.currentResponse += text;
    this.emit("chunk", text);

    if (text.match(/[.!?](\s|$)/)) {
      this.emit("response", this.currentResponse);
      this.currentResponse = "";
    }
  }

  async initialize(): Promise<void> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key not found");
    }
    this.isInitialized = true;
  }

  async generate(prompt: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: prompt,
    });

    return text;
  }

  async pipe(text: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const { textStream } = await streamText({
      model: openai("gpt-4o-mini"),
      prompt: text,
    });

    for await (const chunk of textStream) {
      this.onChunk(chunk);
    }
  }
}
