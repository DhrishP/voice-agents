import eventBus from "../../events";
import { DTMFTone } from "../../types/dtmf";

export class DTMFService {
  public static processDTMFTone(
    callId: string,
    provider: string,
    tone: DTMFTone
  ): void {
    console.log(`Received DTMF tone ${tone} from ${provider} call ${callId}`);

    eventBus.emit("call.dtmf.received", {
      ctx: {
        callId,
        provider,
        timestamp: Date.now(),
      },
      data: {
        tone,
      },
    });
  }
}

export default DTMFService;
