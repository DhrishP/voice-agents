import { useMemo, useState, useCallback } from "react";
import { useInducedCall, EventType } from "./useInducedCall";

export enum CallState {
  IDLE = "idle",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  ENDED = "ended",
  ERROR = "error",
}

export interface CreateCallOptions {
  phoneNumber?: string;
  metadata?: Record<string, any>;
}

export interface CallResponse {
  callId: string;
  status: string;
}

export async function createCall(
  options?: CreateCallOptions
): Promise<CallResponse> {
  const baseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3033";

  try {
    const response = await fetch(`${baseUrl}/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options || {}),
    });

    if (!response.ok) {
      throw new Error(`Failed to create call: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error creating call:", error);
    throw error;
  }
}

export interface UseInducedCallResult {
  callState: CallState;
  callDuration: number;
  transcript: string[];
  hangup: () => void;
  pipe: (data: string) => boolean;
  on: (event: EventType, callback: (data: any) => void) => () => void;
  startCall: (options?: CreateCallOptions) => Promise<void>;
  isLoading: boolean;
}

class NoActiveCallError extends Error {
  constructor() {
    super("No active call. Please start a call first.");
    this.name = "NoActiveCallError";
  }
}

export function useInducedCallSdk(): UseInducedCallResult {
  const [callId, setCallId] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const {
    callActive,
    callDuration,
    transcript,
    hangup: originalHangup,
    pipe: originalPipe,
    events,
  } = useInducedCall(callId || "", {
    onError: (error) => {
      console.error("InducedCall SDK Error:", error);
    },
  });

  const startCall = useCallback(async (options?: CreateCallOptions) => {
    try {
      setIsLoading(true);
      const response = await createCall(options);
      setCallId(response.callId);
    } catch (error) {
      console.error("Failed to start call:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleHangup = useCallback(() => {
    if (!callId) {
      throw new NoActiveCallError();
    }
    originalHangup();
    setCallId(undefined);
  }, [callId, originalHangup]);

  const handlePipe = useCallback(
    (data: string) => {
      if (!callId) {
        throw new NoActiveCallError();
      }
      return originalPipe(data);
    },
    [callId, originalPipe]
  );

  const handleOn = useCallback(
    (event: EventType, callback: (data: any) => void) => {
      if (!callId) {
        throw new NoActiveCallError();
      }
      return events.on(event, callback);
    },
    [callId, events]
  );

  const callState = useMemo(() => {
    if (!callId) return CallState.IDLE;
    if (!callActive) return CallState.CONNECTING;
    return CallState.CONNECTED;
  }, [callId, callActive]);

  return {
    callState,
    callDuration,
    transcript,
    hangup: handleHangup,
    pipe: handlePipe,
    on: handleOn,
    startCall,
    isLoading,
  };
}

// Export types for better developer experience
export type { UseInducedCallOptions } from "./useInducedCall";
