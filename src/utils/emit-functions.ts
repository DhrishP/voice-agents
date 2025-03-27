import eventBus from "../events";

export const engineError = (callId: string, error: Error) => {
  eventBus.emit("call.error", {
    ctx: {
      callId: callId,
    },
    error: error,
  });
};


export const callEnded = (callId: string, data: any) => {
  eventBus.emit("call.ended", {
    ctx: { callId: callId },
    data: data,
  });
};

