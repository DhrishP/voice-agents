import { useState, useEffect, useCallback, useRef, useMemo } from "react";

type EventType = "audio.out" | "call.started" | "call.ended";

interface UseInducedCallOptions {
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

  // Handle call end cleanup
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

  // Initialize WebSocket connection
  useEffect(() => {
    if (!callId) return;

    const connectToWebSocket = () => {
      // Prevent multiple connection attempts
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

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("WebSocket connection established");
        setCallActive(true);
        isConnectingRef.current = false;
        webSocketRef.current = ws;

        // Only send call.started once per session
        if (!hasStartedRef.current) {
          hasStartedRef.current = true;
          startTimeRef.current = Date.now();

          // Start tracking call duration
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

          // Send initial call.started event
          ws.send(
            JSON.stringify({
              event: "call.started",
              callId: callId,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("Received message:", message);

          if (message.event === "audio.out") {
            // Handle audio output event
            const listeners = eventListeners.current.get("audio.out");
            if (listeners) {
              listeners.forEach((listener) => listener(message.data));
            }
          } else if (message.event === "call.ended") {
            // Handle call ended event
            handleCallEnd();
            const listeners = eventListeners.current.get("call.ended");
            if (listeners) {
              listeners.forEach((listener) => listener({}));
            }
          }

          // If the message contains a transcript update, add it
          if (message.transcription) {
            setTranscript((prev) => [...prev, message.transcription]);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
          if (options?.onError) {
            options.onError(new Error("Failed to process message from server"));
          }
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        isConnectingRef.current = false;
        if (options?.onError) {
          options.onError(new Error("WebSocket connection error"));
        }
      };

      ws.onclose = () => {
        console.log("WebSocket connection closed");
        isConnectingRef.current = false;
        webSocketRef.current = null;

        // Don't try to reconnect if we're intentionally closing
        if (!hasStartedRef.current) {
          handleCallEnd();
        }
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

  // Function to register event listeners
  const on = useCallback((event: EventType, callback: (data: any) => void) => {
    if (!eventListeners.current.has(event)) {
      eventListeners.current.set(event, new Set());
    }

    const listeners = eventListeners.current.get(event)!;
    listeners.add(callback);

    // Return unsubscribe function
    return () => {
      listeners.delete(callback);
    };
  }, []);

  // Memoize the events object to keep its reference stable
  const events = useMemo(() => ({ on }), [on]);

  // Function to hangup the call
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

  // Function to send audio data
  const pipe = useCallback(
    (data: string) => {
      if (
        webSocketRef.current &&
        webSocketRef.current.readyState === WebSocket.OPEN
      ) {
        try {
          // Check if data is in JSON format (not needed for audio)
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

          // Audio data handling
          console.log(`Sending audio data of length ${data.length} bytes`);

          // Validate data is not empty
          if (!data || data.length === 0) {
            console.warn("Empty audio data received, not sending");
            return false;
          }

          // Validate base64 format
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
            console.error("Invalid base64 data received, not sending");
            return false;
          }

          // Send audio data to the backend for Deepgram processing
          webSocketRef.current.send(
            JSON.stringify({
              event: "audio",
              data: data,
              format: "audio/l16", // Raw PCM format
              sampleRate: 8000, // Use telephony standard sample rate
              channels: 1, // Mono audio
              chunk: true,
              timestamp: Date.now(),
            })
          );
          return true;
        } catch (error) {
          console.error("Error sending data:", error);
          return false;
        }
      } else {
        const state = webSocketRef.current
          ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][
              webSocketRef.current.readyState
            ]
          : "NOT_INITIALIZED";
        console.warn(`WebSocket not ready. Current state: ${state}`);
        return false;
      }
    },
    [webSocketRef]
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
