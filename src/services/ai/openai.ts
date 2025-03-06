import { EventEmitter } from "events";
import { AIProvider } from "../../providers/ai";
import { openai } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";

export class OpenAIService extends EventEmitter implements AIProvider {
  private isInitialized = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key not found");
    }
    this.isInitialized = true;
  }

  async generate(systemPrompt: string, prompt: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const { text } = await generateText({
        model: openai("gpt-4"),
        system: systemPrompt,
        prompt: prompt,
      });

      return text;
    } catch (error) {
      console.error("Error in generate:", error);
      throw error;
    }
  }

  async pipe(text: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const { textStream } = await streamText({
        model: openai("gpt-4"),
        prompt: text,
      });

      for await (const chunk of textStream) {
        this.emit("chunk", chunk);
      }
    } catch (error) {
      console.error("Error in pipe:", error);
      this.emit("error", error as Error);
    }
  }
}
