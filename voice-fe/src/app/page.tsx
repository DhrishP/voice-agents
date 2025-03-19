"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useInducedCall from "@/hooks/useInducedCall";
import React from "react";
// @ts-ignore
import { ReactMic } from "react-mic";

interface ReactMicRecording {
  blob: Blob;
  blobURL?: string;
  startTime?: number;
  stopTime?: number;
}

export default function HomePage() {
  const [callId, setCallId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const audioChunksRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  const addDebugMessage = useCallback((message: string) => {
    setDebugInfo((prev) => [message, ...prev].slice(0, 20));
    console.log("Debug:", message);
  }, []);

  // Use our custom hooks
  const { callActive, callDuration, transcript, hangup, pipe, events } =
    useInducedCall(callId || "", {
      onError: (err) => {
        setError(err.message);
        addDebugMessage(`Error: ${err.message}`);
      },
    });

  // Start recording
  const startRecording = () => {
    if (callActive) {
      setIsRecording(true);
      addDebugMessage("Recording started");
    } else {
      addDebugMessage("Cannot start recording - call not active");
    }
  };

  // Stop recording
  const stopRecording = () => {
    setIsRecording(false);
    addDebugMessage("Recording stopped");
  };

  // Handle audio data from ReactMic
  const onData = (recordedBlob: Blob) => {
    if (callActive) {
      // This gets real-time chunks of audio data
      audioChunksRef.current += 1;

      // Debug audio information
      addDebugMessage(
        `Audio chunk ${audioChunksRef.current} received: ${recordedBlob.size} bytes, type: ${recordedBlob.type}`
      );

      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(recordedBlob);
      reader.onloadend = () => {
        const base64data = reader.result?.toString().split(",")[1]; // Remove the data URL prefix
        if (base64data) {
          addDebugMessage(
            `Audio converted to base64, length: ${base64data.length} chars`
          );

          // Send raw audio data - the backend will handle transcription with Deepgram
          const result = pipe(base64data);

          // Add detailed debug info
          if (result) {
            addDebugMessage(
              `Audio chunk ${audioChunksRef.current} sent successfully (${base64data.length} bytes)`
            );
          } else {
            addDebugMessage(
              `⚠️ Failed to send audio chunk ${audioChunksRef.current}`
            );
          }
        } else {
          addDebugMessage(
            `⚠️ Failed to convert audio to base64 for chunk ${audioChunksRef.current}`
          );
        }
      };
    }
  };

  // Handle when recording stops
  const onStop = (recordedData: {
    blob: Blob;
    blobURL: string;
    startTime: number;
    stopTime: number;
  }) => {
    addDebugMessage(
      `Recording stopped, final blob size: ${recordedData.blob.size} bytes`
    );
  };

  // Initialize audio context on component mount
  useEffect(() => {
    // Only create audio context once
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContext();
        addDebugMessage("Audio context initialized");
      } catch (error) {
        addDebugMessage(`Failed to initialize audio context: ${error}`);
      }
    }

    // Cleanup on unmount
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
        audioContextRef.current = null;
        addDebugMessage("Audio context closed on unmount");
      }
    };
  }, [addDebugMessage]);

  // Set up audio output event listener for simple audio playback
  useEffect(() => {
    if (callActive && events && audioContextRef.current) {
      addDebugMessage("Setting up audio output handler");

      const playAudioChunk = async (base64Data: string) => {
        try {
          addDebugMessage(`Received audio chunk, length: ${base64Data.length}`);

          // Skip processing if data is too short
          if (base64Data.length < 10) {
            addDebugMessage("Audio data too short, skipping");
            return;
          }

          // Get the audio context
          const audioContext = audioContextRef.current;
          if (!audioContext) {
            addDebugMessage("Audio context not available");
            return;
          }

          // Try to play the audio
          try {
            // Convert base64 to ArrayBuffer
            const audioData = Buffer.from(base64Data, "base64");
            const arrayBuffer = audioData.buffer;

            // Decode the audio data
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Play the audio
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start();
            addDebugMessage("Audio playback started");
          } catch (decodeError) {
            addDebugMessage(`Failed to decode audio: ${decodeError}`);
          }
        } catch (error) {
          console.error("Error playing audio:", error);
          addDebugMessage(`Error playing audio: ${error}`);
        }
      };

      const unsubscribe = events.on("audio.out", playAudioChunk);
      return () => {
        unsubscribe();
        addDebugMessage("Audio output handler removed");
      };
    }
  }, [callActive, events, addDebugMessage]);

  const createCall = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      addDebugMessage("Creating new call...");
      audioChunksRef.current = 0;

      const response = await fetch("/api/websocket/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt:
            "You are a helpful voice assistant. Keep your responses concise and clear. Answer the user's questions helpfully.",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create call");
      }

      const data = await response.json();
      setCallId(data.callId);
      addDebugMessage(`Call created with ID: ${data.callId}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "An error occurred";
      setError(errorMsg);
      addDebugMessage(`Error creating call: ${errorMsg}`);
    } finally {
      setIsLoading(false);
    }
  }, [addDebugMessage]);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold mb-8">Voice AI Demo</h1>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!callActive ? (
          <button
            onClick={createCall}
            disabled={isLoading}
            className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-blue-300"
          >
            {isLoading ? "Creating call..." : "Start New Call"}
          </button>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-lg">
                Call Duration: {Math.floor(callDuration / 60)}:
                {String(callDuration % 60).padStart(2, "0")}
              </div>
              <button
                onClick={hangup}
                className="bg-red-500 text-white px-4 py-2 rounded"
              >
                End Call
              </button>
            </div>

            <div className="w-full bg-gray-100 p-4 rounded">
              <ReactMic
                record={isRecording}
                onStop={onStop}
                onData={onData}
                strokeColor="#000000"
                backgroundColor="#f5f5f5"
                className="w-full h-12"
                mimeType="audio/wav"
                echoCancellation={true}
                autoGainControl={true}
                noiseSuppression={true}
                channelCount={1}
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`px-4 py-2 rounded ${
                  isRecording
                    ? "bg-red-500 text-white"
                    : "bg-green-500 text-white"
                }`}
              >
                {isRecording ? "Stop Speaking" : "Start Speaking"}
              </button>
              <div className="ml-4">
                {isRecording && (
                  <span className="text-red-500 animate-pulse">
                    ● Recording
                  </span>
                )}
                {!isRecording && callActive && (
                  <span className="text-gray-500">Ready to record</span>
                )}
              </div>
            </div>

            {/* Add direct text input for testing */}
            {callActive && (
              <div className="mt-4 p-4 border border-gray-300 rounded">
                <h3 className="text-lg font-semibold mb-2">
                  Test Direct Text Input
                </h3>
                <p className="text-sm text-gray-500 mb-2">
                  Use this to test the backend pipeline if audio is not working
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 p-2 border border-gray-300 rounded"
                    placeholder="Type a message to test..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const input = e.currentTarget;
                        const text = input.value.trim();
                        if (text) {
                          addDebugMessage(`Sending direct text: "${text}"`);
                          pipe(JSON.stringify({ text, isFinal: true }));
                          input.value = "";
                        }
                      }
                    }}
                  />
                  <button
                    className="bg-blue-500 text-white px-4 py-2 rounded"
                    onClick={(e) => {
                      const input = e.currentTarget
                        .previousSibling as HTMLInputElement;
                      const text = input.value.trim();
                      if (text) {
                        addDebugMessage(`Sending direct text: "${text}"`);
                        pipe(JSON.stringify({ text, isFinal: true }));
                        input.value = "";
                      }
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6">
              <h2 className="text-xl font-semibold mb-2">Transcript</h2>
              <div className="bg-gray-100 p-4 rounded max-h-96 overflow-y-auto">
                {transcript.length > 0 ? (
                  transcript.map((text, index) => (
                    <p key={index} className="mb-2">
                      {text}
                    </p>
                  ))
                ) : (
                  <p className="text-gray-500 italic">
                    No transcript available yet. Try speaking.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <h3 className="text-lg font-semibold mb-2">Debug Info</h3>
              <div className="bg-gray-800 text-green-400 p-4 rounded max-h-80 overflow-y-auto font-mono text-sm">
                {debugInfo.map((msg, idx) => (
                  <div key={idx} className="mb-1">
                    {msg}
                  </div>
                ))}
                {debugInfo.length === 0 && <div>No debug information yet</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
