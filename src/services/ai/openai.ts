import { AIEvents, AIService } from "../../types/providers/ai";
import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateText, streamText } from "ai";
import eventBus from "../../engine";
import prisma from "../../db/client";
import { TranscriptType } from "@prisma/client";
export class OpenAIService implements AIService {
  private isInitialized = false;
  private currentResponse: string = "";
  private listenerCallback: ((chunk: string) => void) | null = null;
  private id: string;
  private history: CoreMessage[];
  private model: string;
  constructor(id: string, history: CoreMessage[], model: string) {
    this.id = id;
    this.history = history;
    this.model = model;
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
      model: openai(this.model),
      prompt: prompt,
    });

    return text;
  }

  async pipe(text: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    let fullResponse = "";
    let tokensUsed = 0;

    this.history.push({ role: "user", content: text });

    await prisma.transcript.create({
      data: {
        callId: this.id,
        type: TranscriptType.USER,
        transcript: text,
      },
    });

    console.log("History:", this.history);

    const { textStream, usage } = await streamText({
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
    tokensUsed = (await usage).totalTokens;

    this.history.push({ role: "assistant", content: fullResponse });
    const call = await prisma.call.findUnique({
      where: { id: this.id },
    });

    await prisma.transcript.create({
      data: {
        callId: this.id,
        type: TranscriptType.ASSISTANT,
        transcript: fullResponse,
      },
    });

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
