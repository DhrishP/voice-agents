import { EventEmitter } from "events";
import { AIEvents, AIService } from "../../types/providers/ai";
import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateText, streamText } from "ai";
import eventBus from "../../engine";

export class OpenAIService implements AIService {
  private isInitialized = false;
  private currentResponse: string = "";
  private listenerCallback: ((chunk: string) => void) | null = null;
  private id: string;
  private history: CoreMessage[];
  constructor(id: string, history: CoreMessage[]) {
    this.id = id;
    this.history = history;
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

    let fullResponse = "";

    this.history.push({ role: "user", content: text });

    console.log("History:", this.history);

    const { textStream } = await streamText({
      model: openai("gpt-4o-mini"),
      messages: this.history,
    });

    for await (const chunk of textStream) {
      if (this.listenerCallback) {
        this.listenerCallback(chunk);
      }

      fullResponse += chunk;

      eventBus.emit("call.response.chunk.generated", {
        ctx: {
          callId: this.id,
          provider: "openai",
          timestamp: Date.now(),
        },
        data: { text: chunk },
      });
    }

    this.history.push({ role: "assistant", content: fullResponse });

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
