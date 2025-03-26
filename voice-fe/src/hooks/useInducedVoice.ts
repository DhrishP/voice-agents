import { useState, useEffect, useCallback, useRef, useMemo } from "react";

export enum CallState {
  IDLE = "idle",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  ENDED = "ended",
  ERROR = "error",
}

export type EventType =
  | "audio.out"
  | "call.started"
  | "call.ended"
  | "error"
  | "call.audio.cancelled";

interface CreateCallOptions {
  prompt?: string;
  sttProvider?: string;
  ttsProvider?: string;
  llmProvider?: string;
  llmModel?: string;
  sttModel?: string;
  ttsModel?: string;
  language?: string;
}

async function createCall(options?: CreateCallOptions) {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3033";
    const response = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt:
          options?.prompt ||
          "You are a helpful voice assistant. Keep your responses concise and clear. Answer the user's questions helpfully.",
        sttProvider: "deepgram",
        ttsProvider: "elevenlabs",
        llmProvider: "openai",
        llmModel: "gpt-4",
        sttModel: "nova-2",
        ttsModel: "eleven_multilingual_v2",
        language: "en-US",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create call: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      callId: data.callId,
      status: data.status,
    };
  } catch (error) {
    console.error("Error creating call:", error);
    throw error;
  }
}

export function useInducedVoice() {
  const [callId, setCallId] = useState<string>("");
  const [callState, setCallState] = useState<CallState>(CallState.IDLE);
  const [callDuration, setCallDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const webSocketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const isConnectingRef = useRef(false);
  const eventListeners = useRef<Map<EventType, Set<(data: any) => void>>>(
    new Map()
  );

  const handleCallEnd = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (webSocketRef.current) {
      if (webSocketRef.current.readyState === WebSocket.OPEN) {
        webSocketRef.current.close();
      }
      webSocketRef.current = null;
    }

    setCallState(CallState.ENDED);
    startTimeRef.current = null;
    isConnectingRef.current = false;
  }, []);

  useEffect(() => {
    if (!callId) return;

    const connectToWebSocket = () => {
      if (
        isConnectingRef.current ||
        webSocketRef.current?.readyState === WebSocket.OPEN
      ) {
        return;
      }

      isConnectingRef.current = true;
      setCallState(CallState.CONNECTING);

      const wsUrl = `${
        process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:3033"
      }/stream/${callId}`;
      console.log("Connecting to WebSocket:", wsUrl);

      if (webSocketRef.current) {
        try {
          webSocketRef.current.close();
        } catch (err) {
          console.error("Error closing existing WebSocket:", err);
        }
        webSocketRef.current = null;
      }

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("WebSocket connection established");
        setCallState(CallState.CONNECTED);
        isConnectingRef.current = false;
        webSocketRef.current = ws;
        startTimeRef.current = Date.now();

        if (timerRef.current) {
          clearInterval(timerRef.current);
        }

        timerRef.current = setInterval(() => {
          if (startTimeRef.current) {
            const elapsed = Math.floor(
              (Date.now() - startTimeRef.current) / 1000
            );
            setCallDuration(elapsed);
          }
        }, 1000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("Received message:", message);

          if (message.event === "audio.out") {
            if (!message.data) {
              console.error("Audio.out event missing data payload");
              return;
            }

            const listeners = eventListeners.current.get("audio.out");
            if (listeners) {
              listeners.forEach((listener) => listener(message.data));
            }
          } else if (message.event === "call.ended") {
            handleCallEnd();
            const listeners = eventListeners.current.get("call.ended");
            if (listeners) {
              listeners.forEach((listener) => listener({}));
            }
          } else if (message.event === "cancel") {
            const listeners = eventListeners.current.get(
              "call.audio.cancelled"
            );
            if (listeners) {
              listeners.forEach((listener) => listener({}));
            }
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
          setCallState(CallState.ERROR);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        isConnectingRef.current = false;
        setCallState(CallState.ERROR);
      };

      ws.onclose = () => {
        isConnectingRef.current = false;
        webSocketRef.current = null;
        handleCallEnd();
      };
    };

    connectToWebSocket();

    return () => {
      if (webSocketRef.current?.readyState === WebSocket.OPEN) {
        webSocketRef.current.close();
      }
      handleCallEnd();
      isConnectingRef.current = false;
    };
  }, [callId, handleCallEnd]);

  const on = useCallback((event: EventType, callback: (data: any) => void) => {
    if (!eventListeners.current.has(event)) {
      eventListeners.current.set(event, new Set());
    }

    const listeners = eventListeners.current.get(event)!;
    listeners.add(callback);

    return () => {
      listeners.delete(callback);
    };
  }, []);

  const hangup = useCallback(() => {
    if (
      webSocketRef.current &&
      webSocketRef.current.readyState === WebSocket.OPEN
    ) {
      webSocketRef.current.send(
        JSON.stringify({
          event: "call.ended",
        })
      );
      handleCallEnd();
    }
    setCallId("");
  }, [handleCallEnd]);

  const pipe = useCallback(
    (data: string) => {
      if (!webSocketRef.current) {
        console.warn(`WebSocket not initialized for callId ${callId}`);
        return false;
      }

      if (webSocketRef.current.readyState !== WebSocket.OPEN) {
        const stateNames = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
        const state = stateNames[webSocketRef.current.readyState] || "UNKNOWN";
        console.warn(`WebSocket not ready. Current state: ${state}`);
        return false;
      }

      try {
        webSocketRef.current.send(
          JSON.stringify({
            event: "audio",
            data: data,
            format: "audio/l16",
            sampleRate: 8000,
            channels: 1,
            chunk: true,
            timestamp: Date.now(),
          })
        );
        return true;
      } catch (error) {
        console.error("Error sending data:", error);
        return false;
      }
    },
    [callId]
  );

  const startCall = useCallback(async (options?: CreateCallOptions) => {
    try {
      setIsLoading(true);
      const response = await createCall({
        prompt: options?.prompt,
        sttProvider: options?.sttProvider || "deepgram",
        ttsProvider: options?.ttsProvider || "elevenlabs",
        llmProvider: options?.llmProvider || "openai",
        llmModel: options?.llmModel || "gpt-4",
        sttModel: options?.sttModel || "nova-2",
        ttsModel: options?.ttsModel || "eleven_multilingual_v2",
        language: options?.language || "en-US",
      });
      setCallId(response.callId);
    } catch (error) {
      console.error("Failed to start call:", error);
      setCallState(CallState.ERROR);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    callState,
    callDuration,
    hangup,
    pipe,
    on,
    startCall,
    isLoading,
  };
}
