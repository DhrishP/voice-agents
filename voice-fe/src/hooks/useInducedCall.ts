import { useState, useEffect, useCallback, useRef, useMemo } from "react";

export type EventType =
  | "audio.out"
  | "call.started"
  | "call.ended"
  | "error"
  | "call.audio.cancelled";

export interface UseInducedCallOptions {
  onError?: (error: Error) => void;
}

export function useInducedCall(
  callId: string,
  options?: UseInducedCallOptions
) {
  const [callActive, setCallActive] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [transcript, setTranscript] = useState<string[]>([]);
  const webSocketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const hasStartedRef = useRef(false);

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

    setCallActive(false);
    startTimeRef.current = null;
    hasInitializedRef.current = false;
    isConnectingRef.current = false;
  }, []);

  const handleError = useCallback(
    (error: Error) => {
      const listeners = eventListeners.current.get("error");
      if (listeners) {
        listeners.forEach((listener) => listener(error));
      }
      if (options?.onError) {
        options.onError(error);
      }
    },
    [options]
  );

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
        setCallActive(true);
        isConnectingRef.current = false;
        webSocketRef.current = ws;

        if (!hasStartedRef.current) {
          hasStartedRef.current = true;
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
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("Received message:", message);

          if (message.event === "audio.out") {
            console.log(
              `Received audio.out event, data length: ${
                message.data ? message.data.length : "undefined"
              }`
            );

            if (!message.data) {
              console.error("Audio.out event missing data payload");
              return;
            }

            const listeners = eventListeners.current.get("audio.out");
            if (listeners) {
              listeners.forEach((listener) => listener(message.data));
            } else {
              console.warn("No listeners registered for audio.out events");
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

          if (message.transcription) {
            setTranscript((prev) => [...prev, message.transcription]);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
          handleError(new Error("Failed to process message from server"));
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        isConnectingRef.current = false;
        handleError(new Error("WebSocket connection error"));
      };

      ws.onclose = (event) => {
        console.log(
          `WebSocket connection closed. Code: ${event.code}, Reason: ${
            event.reason || "No reason provided"
          }`
        );
        isConnectingRef.current = false;
        webSocketRef.current = null;
        handleCallEnd();
        hasStartedRef.current = false;
      };
    };

    connectToWebSocket();

    return () => {
      if (webSocketRef.current?.readyState === WebSocket.OPEN) {
        webSocketRef.current.close();
      }
      handleCallEnd();
      hasStartedRef.current = false;
      isConnectingRef.current = false;
    };
  }, [callId]);

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

  const events = useMemo(() => ({ on }), [on]);

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
        if (data.startsWith("{")) {
          try {
            const parsedData = JSON.parse(data);
            if (parsedData.text) {
              webSocketRef.current.send(
                JSON.stringify({
                  event: "text",
                  data: parsedData.text,
                  isFinal: parsedData.isFinal,
                })
              );
              console.log(`Sent text: "${parsedData.text}"`);
              return true;
            }
          } catch (e) {
            console.error("Failed to parse JSON data:", e);
          }
        }

        console.log(`Sending audio data of length ${data.length} bytes`);

        if (!data || data.length === 0) {
          console.warn("Empty audio data received, not sending");
          return false;
        }

        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
          console.error("Invalid base64 data received, not sending");
          return false;
        }

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

  return {
    callActive,
    callDuration,
    transcript,
    hangup,
    pipe,
    events,
  };
}

export default useInducedCall;
