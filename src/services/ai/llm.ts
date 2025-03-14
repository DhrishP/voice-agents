import { AIService } from "../../types/providers/ai";
import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateText,  } from "ai";
import eventBus from "../../engine";
import prisma from "../../db/client";
import { TranscriptType } from "@prisma/client";
import { SDKServices } from "../sdk/ai";
export class LLMService implements AIService {
  private isInitialized = false;
  private listenerCallback: ((chunk: string) => void) | null = null;
  private id: string;
  private history: CoreMessage[];
  private model: string;
  private provider: string;
  private sdkService: SDKServices;
  constructor(
    id: string,
    history: CoreMessage[],
    model: string,
    provider: string
  ) {
    this.id = id;
    this.history = history;
    this.model = model;
    this.provider = provider;
    this.sdkService = new SDKServices();
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
    this.history.push({ role: "user", content: text });

    await prisma.transcript.create({
      data: {
        callId: this.id,
        type: TranscriptType.USER,
        transcript: text,
      },
    });

    const { textStream } = await this.sdkService.streamText({
      model: this.model,
      provider: this.provider,
      history: this.history,
      callId: this.id,
    });

    if (textStream) {
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
      eventBus.emit("call.response.chunk.generated", {
        ctx: {
          callId: this.id,
          provider: "openai",
          timestamp: Date.now(),
        },
        data: { text: "" },
      });
    }
    console.log("History:", this.history);
  }
}
