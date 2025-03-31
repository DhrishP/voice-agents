import { openai, OpenAIProvider, createOpenAI } from "@ai-sdk/openai";
import {
  CoreMessage,
  generateObject,
  generateText,
  streamText,
  tool,
} from "ai";
import {
  createGoogleGenerativeAI,
  GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { z } from "zod";
import eventBus from "../../events";
import prisma from "../../db/client";
import { TranscriptType } from "@prisma/client";
import { DTMFService } from "../audio/dtmf";
import {
  DEFAULT_AUDIO_FORMAT,
  DEFAULT_AUDIO_FORMAT_PCM_S16LE,
} from "../../lib/audio/format";

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

  private getProviderModel(provider: string, model: string) {
    const providerModel =
      provider === "openai"
        ? this.openai(model)
        : provider === "gemini"
        ? this.google("gemini-2.0-flash-001")
        : null;
    if (!providerModel) {
      throw new Error(`Provider ${provider} not supported`);
    }
    return providerModel;
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
    telephonyProvider,
  }: {
    model: string;
    provider: string;
    history: CoreMessage[];
    callId: string;
    telephonyProvider: "twilio" | "plivo" | "websocket";
  }) {
    try {
      const providerModel = this.getProviderModel(provider, model);
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
              if (telephonyProvider === "websocket") {
                return {
                  success: true,
                  message: "returned to websocket",
                };
              }
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
          dtmf: tool({
            description:
              "Generate DTMF tones for a sequence of numbers or symbols (0-9, *, #, A-D) or whenever the user says to dial. dont ask reason for dialing",
            parameters: z.object({
              sequence: z
                .string()
                .describe(
                  "The sequence of numbers/symbols to generate DTMF tones for"
                ),
              reason: z
                .string()
                .describe("The reason for generating DTMF tones"),
            }),
            execute: async ({ sequence, reason }) => {
              const dtmfService = DTMFService.getInstance();
              let result;
              console.log("provider", telephonyProvider);
              if (telephonyProvider === "twilio") {
                console.log("Generating DTMF tones for twilio");
                result = await dtmfService.generateTones({
                  sequence,
                  callId,
                  audioFormat: DEFAULT_AUDIO_FORMAT,
                });
              } else if (telephonyProvider === "plivo") {
                console.log("Generating DTMF tones for plivo");
                result = await dtmfService.generateTones({
                  sequence,
                  callId,
                  audioFormat: DEFAULT_AUDIO_FORMAT_PCM_S16LE,
                });
              }
              if (!result?.success) {
                return {
                  success: false,
                  message: result?.message || "Failed to generate DTMF tones",
                };
              }

              return {
                success: result.success,
                message: result.message,
              };
            },
          }),
        },
        onFinish: async ({ text, toolResults, usage }) => {
          if (toolResults.length) {
            await prisma.transcript.create({
              data: {
                callId: callId,
                type: TranscriptType.TOOL,
                transcript: toolResults[0].args.reason,
              },
            });
            history.push({
              role: "data",
              content: `[${toolResults[0].toolName}] : ${toolResults[0].args.reason}`,
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

  async generateOutputSchema(
    callId: string,
    outputSchema: Record<string, any>,
    provider: string,
    model: string,
    transcription: CoreMessage[]
  ) {
    const providerModel = this.getProviderModel(provider, model);

    const zodSchema = z.object(outputSchema);
    const { object, usage } = await generateObject({
      model: providerModel,
      schema: zodSchema,
      messages: [
        ...transcription,
        {
          role: "user",
          content: `generate a structured output using the call transcription based on the provided history in the given output format`,
        },
      ],
    });
    const parsedObject = zodSchema.parse(object);
    if (!parsedObject) {
      return { parsedObject: null, usage };
    }

    return { parsedObject, usage };
  }
}
