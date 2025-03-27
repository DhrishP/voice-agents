import { useState, useEffect, useCallback, useRef, useMemo } from "react";

/**
 * Represents the possible states of a voice call.
 */
export enum CallState {
  /** Initial state before any call is made */
  IDLE = "idle",
  /** Call is being established */
  CONNECTING = "connecting",
  /** Call is active and connected */
  CONNECTED = "connected",
  /** Call has been terminated */
  ENDED = "ended",
  /** An error occurred during the call */
  ERROR = "error",
}

/**
 * Event types that can be listened to during a voice call.
 */
export type EventType =
  /** Emitted when audio data is received from the server */
  | "audio.out"
  /** Emitted when a call begins */
  | "call.started"
  /** Emitted when a call ends */
  | "call.ended"
  /** Emitted when an error occurs */
  | "error"
  /** Emitted when audio playback is cancelled */
  | "call.audio.cancelled";

/**
 * Configuration options for creating a new voice call.
 */
interface CreateCallOptions {
  /** Initial prompt/system message for the AI assistant */
  prompt?: string;
  /** Speech-to-text provider (default: "deepgram") */
  sttProvider?: string;
  /** Text-to-speech provider (default: "elevenlabs") */
  ttsProvider?: string;
  /** Language model provider (default: "openai") */
  llmProvider?: string;
  /** Language model to use (default: "gpt-4") */
  llmModel?: string;
  /** Speech-to-text model to use (default: "nova-2") */
  sttModel?: string;
  /** Text-to-speech model to use (default: "eleven_multilingual_v2") */
  ttsModel?: string;
  /** Language code for speech recognition and synthesis (default: "en-US") */
  language?: string;
}

/**
 * Creates a new voice call session with the specified options.
 * @param options - Configuration options for the call
 * @returns Promise resolving to the call ID and status
 * @throws Error if the call creation fails
 */
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
        sttProvider: options?.sttProvider || "deepgram",
        ttsProvider: options?.ttsProvider || "elevenlabs",
        llmProvider: options?.llmProvider || "openai",
        llmModel: options?.llmModel || "gpt-4",
        sttModel: options?.sttModel || "nova-2",
        ttsModel: options?.ttsModel || "eleven_multilingual_v2",
        language: options?.language || "en-US",
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

/**
 * React hook for managing voice calls with an AI assistant.
 *
 * @example
 * ```typescript
 * const {
 *   callState,
 *   callDuration,
 *   hangup,
 *   pipe,
 *   on,
 *   startCall,
 *   isLoading
 * } = useInducedVoice();
 *
 * // Start a call with custom options
 * await startCall({
 *   prompt: "You are a helpful assistant",
 *   language: "en-US"
 * });
 *
 * // Listen for audio data
 * on("audio.out", (audioData) => {
 *   // Handle audio data (base64 encoded audio)
 *   playAudio(audioData);
 * });
 *
 * // Send audio data
 * pipe(base64AudioData);
 *
 * // End the call
 * hangup();
 * ```
 *
 * @returns An object containing call management functions and state
 */
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

  /**
   * Handles cleanup when a call ends
   */
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

  /**
   * Registers an event listener for voice call events.
   * @param event - The event type to listen for
   * @param callback - Function to be called when the event occurs
   * @returns A cleanup function to remove the event listener
   */
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

  /**
   * Ends the current voice call.
   * Sends a termination signal to the server and cleans up resources.
   */
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

  /**
   * Sends audio data to the server.
   * @param data - Base64 encoded audio data in L16 format (16-bit PCM)
   * @returns boolean indicating if the data was successfully sent
   *
   * @example
   * ```typescript
   * // Send audio data from microphone
   * const success = pipe(base64AudioData);
   * if (!success) {
   *   console.error('Failed to send audio data');
   * }
   * ```
   */
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

  /**
   * Initiates a new voice call with the specified options.
   * @param options - Configuration options for the call
   * @throws Error if the call creation fails
   *
   * @example
   * ```typescript
   * await startCall({
   *   prompt: "You are a helpful assistant",
   *   language: "en-US",
   *   ttsModel: "eleven_multilingual_v2"
   * });
   * ```
   */
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
    /** Current state of the voice call */
    callState,
    /** Duration of the current call in seconds */
    callDuration,
    /** Function to end the current call */
    hangup,
    /** Function to send audio data to the server */
    pipe,
    /** Function to register event listeners */
    on,
    /** Function to start a new call */
    startCall,
    /** Whether a call is currently being initiated */
    isLoading,
  };
}
