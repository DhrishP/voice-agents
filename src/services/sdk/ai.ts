import { openai, OpenAIProvider, createOpenAI } from "@ai-sdk/openai";
import { CoreMessage, generateText, streamText, tool } from "ai";
import {
  createGoogleGenerativeAI,
  GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { z } from "zod";
import eventBus from "../../events";
import prisma from "../../db/client";
import { TranscriptType } from "@prisma/client";

export class SDKServices {
  private google: GoogleGenerativeAIProvider;
  private openai: OpenAIProvider;
  constructor() {
    this.google = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    this.openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateText(transcription: CoreMessage[]) {
    // future use if any
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `summarize the given transcription ${transcription}`,
    });
    return text;
  }

  async streamText({
    model,
    provider,
    history,
    callId,
  }: {
    model: string;
    provider: string;
    history: CoreMessage[];
    callId: string;
  }) {
    try {
      const providerModel =
        provider === "openai"
          ? this.openai(model)
          : provider === "gemini"
          ? this.google("gemini-2.0-flash-001")
          : null;
      if (!providerModel) {
        throw new Error(`Provider ${provider} not supported`);
      }
      const { textStream } = await streamText({
        model: providerModel,
        messages: history,
        tools: {
          hangupcall: tool({
            description: "Hang up the call",
            parameters: z.object({
              reason: z.string().describe("The reason for hanging up the call"),
            }),
            execute: async ({ reason }) => {
              eventBus.emit("call.hangup.requested", {
                ctx: { callId: callId },
                data: { reason },
                provider: provider,
              });
              return {
                success: true,
              };
            },
          }),
          transfer: tool({
            description: "Transfer the call to a human agent",
            parameters: z.object({
              reason: z
                .string()
                .describe("The reason for transferring the call"),
            }),
            execute: async ({ reason }) => {
              eventBus.emit("call.transfer.requested", {
                ctx: { callId: callId },
                data: {
                  reason,
                  transferNumber: process.env.TRANSFER_PHONE_NUMBER || "",
                },
                provider: provider,
              });
              return {
                success: true,
                message: `Call transfer initiated to ${process.env.TRANSFER_PHONE_NUMBER}.`,
              };
            },
          }),
        },
        onFinish: async ({ text, toolResults, usage }) => {
          if (toolResults.length) {
            console.log("hi");
            history.push({
              role: "tool",
              content: toolResults[0].args.reason as any,
            });
            await prisma.transcript.create({
              data: {
                callId: callId,
                type: TranscriptType.TOOL,
                transcript: toolResults[0].args.reason as any,
              },
            });
          } else {
            history.push({ role: "assistant", content: text });
            await prisma.transcript.create({
              data: {
                callId: callId,
                type: TranscriptType.ASSISTANT,
                transcript: text,
              },
            });
          }
          if (usage) {
            await prisma.usage.create({
              data: {
                callId: callId,
                type: "LLM",
                usage: usage.totalTokens,
              },
            });
          }
        },
      });
      return { textStream };
    } catch (error) {
      console.error("Error streaming text:", error);
      return { textStream: null };
    }
  }
}
