import { EventEmitter } from "events";
import { AIEvents, AIService } from "../../types/providers/ai";
import { openai } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import eventBus from "../../engine";

export class OpenAIService implements AIService {
  private isInitialized = false;
  private currentResponse: string = "";
  private listenerCallback: ((chunk: string) => void) | null = null;
  private id: string;

  constructor(id: string) {
    this.id = id;
  }

   onChunk(listenerCallback: (chunk: string) => void): void {
    this.listenerCallback = listenerCallback;
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
      if (this.listenerCallback) {
        this.listenerCallback(chunk);
      }
      eventBus.emit("call.response.chunk.generated", {
        ctx: {
          callId: this.id,
          provider: "openai",
          timestamp: Date.now(),
        },
        data: { text: chunk },
      });
    }

    eventBus.emit("call.response.chunk.generated", {
      ctx: {
        callId: this.id,
        provider: "openai",
        timestamp: Date.now(),
      },
      data: { text: "" },
    });
  }
}
