import { DEFAULT_AUDIO_FORMAT } from "../../lib/audio/format";
import {
  generateDTMFSequence,
  type DTMFTone,
  dtmfFrequencies,
} from "../../lib/audio/dtmf";
import eventBus from "../../events";

export class DTMFService {
  private static instance: DTMFService;

  private constructor() {}

  public static getInstance(): DTMFService {
    if (!DTMFService.instance) {
      DTMFService.instance = new DTMFService();
    }
    return DTMFService.instance;
  }

  public async generateTones({
    sequence,
    callId,
  }: {
    sequence: string;
    callId: string;
  }): Promise<{
    success: boolean;
    message: string;
    frequencies?: Array<{ digit: string; frequencies: number[] }>;
  }> {
    try {
      console.log(
        `[DTMF] Generating tones for sequence: ${sequence} in call ${callId}`
      );

      const validChars = sequence
        .toUpperCase()
        .split("")
        .filter((char): char is DTMFTone => char in dtmfFrequencies);

      if (validChars.length === 0) {
        console.warn(
          `[DTMF] No valid DTMF characters found in sequence: ${sequence}`
        );
        return {
          success: false,
          message: "No valid DTMF characters found in sequence",
        };
      }

      const frequencies = validChars.map((char) => ({
        digit: char,
        frequencies: [...dtmfFrequencies[char]],
      }));

      // Log each digit and its frequencies
      frequencies.forEach(({ digit, frequencies }) => {
        console.log(
          `[DTMF] Digit ${digit}: Low freq = ${frequencies[0]}Hz, High freq = ${frequencies[1]}Hz`
        );
      });

      const buffer = generateDTMFSequence({
        sequence: validChars,
        toneDurationMs: 100, // Standard DTMF tone duration
        pauseDurationMs: 50, // Standard DTMF pause duration
        audioFormat: DEFAULT_AUDIO_FORMAT,
      });

      console.log(`[DTMF] Generated buffer size: ${buffer.length} bytes`);

      // Attach the sequence data to the buffer
      (buffer as any).eventData = {
        sequence: validChars.join(""),
        frequencies,
      };

      eventBus.emit("call.dtmf.tone.generated", {
        ctx: { callId: callId, timestamp: Date.now() },
        data: {
          buffer,
          sequence: validChars.join(""),
          frequencies,
        },
      });

      return {
        success: true,
        message: `Generated DTMF tones for sequence: ${validChars.join("")}`,
        frequencies,
      };
    } catch (error) {
      console.error("[DTMF] Error generating DTMF tones:", error);
      return {
        success: false,
        message: "Failed to generate DTMF tones",
      };
    }
  }
}
