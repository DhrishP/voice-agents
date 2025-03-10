import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateText } from "ai";

export class AI {
  constructor(private readonly provider: string) {}

  async generateText(transcription: CoreMessage[]) {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `summarize the given transcription ${transcription}`,
    });
    return text;
  }
}
