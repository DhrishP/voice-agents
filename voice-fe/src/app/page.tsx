"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useInducedVoice, CallState } from "@/hooks/useInducedVoice";
import React from "react";
import UseWindow from "@/hooks/usewindow";

export default function VoiceDemoPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [isWindowAvailable, setIsWindowAvailable] = useState(false);
  const audioChunksRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const windowObj = UseWindow();

  const addDebugMessage = useCallback((message: string) => {
    setDebugInfo((prev) => [message, ...prev].slice(0, 20));
    console.log("Debug:", message);
  }, []);

  // Check window availability
  useEffect(() => {
    if (windowObj) {
      setIsWindowAvailable(true);
      addDebugMessage("Browser environment initialized successfully");
    }
  }, [windowObj, addDebugMessage]);

  const ensureAudioContext = useCallback(async () => {
    if (!windowObj) {
      addDebugMessage("Window object not available yet");
      return false;
    }

    try {
      // Check if AudioContext is supported
      const AudioContext =
        windowObj.AudioContext || (windowObj as any).webkitAudioContext;
      if (!AudioContext) {
        const errorMsg = "AudioContext not supported in this browser";
        setError(errorMsg);
        addDebugMessage(errorMsg);
        return false;
      }

      // If we already have an audio context, try to use it
      if (audioContextRef.current) {
        addDebugMessage(
          `Existing audio context state: ${audioContextRef.current.state}`
        );

        if (audioContextRef.current.state === "suspended") {
          try {
            await audioContextRef.current.resume();
            addDebugMessage("Successfully resumed existing audio context");
            return true;
          } catch (resumeError) {
            addDebugMessage(
              `Failed to resume existing context: ${resumeError}`
            );
          }
        } else if (audioContextRef.current.state === "running") {
          addDebugMessage("Audio context already running");
          return true;
        }
      }

      // Create new audio context
      try {
        audioContextRef.current = new AudioContext({
          sampleRate: 8000,
        });
        addDebugMessage(
          `New audio context created with state: ${audioContextRef.current.state}`
        );

        if (audioContextRef.current.state === "suspended") {
          try {
            await audioContextRef.current.resume();
            addDebugMessage("Successfully resumed new audio context");
          } catch (resumeError) {
            addDebugMessage(
              `Warning: New context created but suspended: ${resumeError}`
            );
            setError("Please click somewhere on the page to enable audio");
            return false;
          }
        }

        return true;
      } catch (createError) {
        const errorMsg =
          createError instanceof Error
            ? createError.message
            : String(createError);
        setError(`Could not create audio context: ${errorMsg}`);
        addDebugMessage(`Audio context creation failed: ${errorMsg}`);
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setError(`Audio initialization failed: ${errorMsg}`);
      addDebugMessage(`Critical audio error: ${errorMsg}`);
      return false;
    }
  }, [windowObj, addDebugMessage]);

  const { callState, callDuration, hangup, pipe, on, startCall, isLoading } =
    useInducedVoice();

  // Initialize audio context
  useEffect(() => {
    const win = typeof window !== "undefined" ? window : null;
    if (win && !audioContextRef.current) {
      try {
        const AudioContext =
          win.AudioContext || (win as any).webkitAudioContext;
        audioContextRef.current = new AudioContext({
          sampleRate: 8000,
        });
        addDebugMessage("Audio context initialized at 8kHz");
      } catch (error) {
        addDebugMessage(`Failed to initialize audio context: ${error}`);
      }
    }
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  // Handle audio output
  useEffect(() => {
    if (callState === CallState.CONNECTED) {
      addDebugMessage("Setting up audio output handler");

      // Ensure audio context is ready when call connects
      ensureAudioContext().then((ready) => {
        if (!ready) {
          addDebugMessage("Failed to initialize audio context for call");
          return;
        }
        addDebugMessage("Audio context ready for call");
      });

      const handleAudioChunk = async (audioData: string) => {
        if (!audioContextRef.current) {
          addDebugMessage("No audio context available");
          return;
        }

        try {
          // Always ensure audio context is running before processing audio
          if (audioContextRef.current.state === "suspended") {
            await audioContextRef.current.resume();
            addDebugMessage("Resumed audio context for playback");
          }

          const audioArrayBuffer = Buffer.from(audioData, "base64").buffer;

          // Add more detailed error handling for audio decoding
          let audioBuffer;
          try {
            audioBuffer = await audioContextRef.current.decodeAudioData(
              audioArrayBuffer
            );
          } catch (decodeError) {
            addDebugMessage(`Failed to decode audio: ${decodeError}`);
            return;
          }

          const source = audioContextRef.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContextRef.current.destination);

          audioSourcesRef.current.push(source);

          source.start(0);
          source.onended = () => {
            source.disconnect();
            audioSourcesRef.current = audioSourcesRef.current.filter(
              (s) => s !== source
            );
            addDebugMessage("Audio chunk playback completed");
          };
        } catch (error) {
          console.error("Error playing audio:", error);
          addDebugMessage(
            `Error playing audio: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      };

      const handleCancel = () => {
        addDebugMessage("Received cancel event - stopping all audio playback");

        if (audioSourcesRef.current.length > 0) {
          audioSourcesRef.current.forEach((source) => {
            try {
              source.stop();
              source.disconnect();
            } catch (err) {
              console.log(err);
            }
          });
          audioSourcesRef.current = [];
        }
      };

      const unsubscribeAudio = on("audio.out", handleAudioChunk);
      const unsubscribeCancel = on("call.audio.cancelled", handleCancel);

      return () => {
        unsubscribeAudio();
        unsubscribeCancel();

        if (audioSourcesRef.current.length > 0) {
          audioSourcesRef.current.forEach((source) => {
            try {
              source.stop();
              source.disconnect();
            } catch (err) {
              console.log(err);
            }
          });
          audioSourcesRef.current = [];
        }
      };
    }
  }, [callState, on, addDebugMessage]);

  const startRecording = async () => {
    if (callState !== CallState.CONNECTED) {
      addDebugMessage("Cannot start recording - call not active");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 8000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      mediaStreamRef.current = stream;
      const win = typeof window !== "undefined" ? window : null;
      if (!win) {
        throw new Error("Window is not available");
      }

      const audioContext = new (win.AudioContext ||
        (win as any).webkitAudioContext)({
        sampleRate: 8000,
      });

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const base64data = Buffer.from(inputData.buffer).toString("base64");
        pipe(base64data);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsRecording(true);
      addDebugMessage("Recording started - sending raw audio to backend");
    } catch (error) {
      console.error("Error starting recording:", error);
      addDebugMessage(`Failed to start recording: ${error}`);
    }
  };

  const stopRecording = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsRecording(false);
    addDebugMessage("Recording stopped");
  };

  const createNewCall = useCallback(async () => {
    if (!isWindowAvailable || !windowObj) {
      addDebugMessage("Cannot create call - browser environment not ready");
      return;
    }

    try {
      setError(null);
      addDebugMessage("Creating new call...");
      audioChunksRef.current = 0;

      // Try to initialize audio with user interaction
      const audioReady = await ensureAudioContext();
      if (!audioReady) {
        addDebugMessage(
          "Failed to initialize audio system - trying to handle autoplay policy"
        );

        // Add a temporary silent audio element to help with autoplay policy
        const silentAudio = new Audio();
        silentAudio.src =
          "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

        try {
          await silentAudio.play();
          silentAudio.remove();
          addDebugMessage(
            "Autoplay policy handled - retrying audio initialization"
          );

          // Try audio initialization again
          const retryReady = await ensureAudioContext();
          if (!retryReady) {
            addDebugMessage(
              "Audio initialization failed after autoplay handling"
            );
            setError("Please click somewhere on the page and try again");
            return;
          }
        } catch (playError) {
          addDebugMessage(
            "Autoplay handling failed - user interaction required"
          );
          setError("Please click somewhere on the page and try again");
          return;
        }
      }

      // Verify audio context is available and running
      if (
        !audioContextRef.current ||
        audioContextRef.current.state !== "running"
      ) {
        setError("Audio system not properly initialized");
        addDebugMessage(
          `Audio context state: ${audioContextRef.current?.state || "none"}`
        );
        return;
      }

      addDebugMessage("Audio system initialized successfully - starting call");

      await startCall({
        prompt:
          "You are a helpful voice assistant. Keep your responses concise and clear. Answer the user's questions helpfully.",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setError(`Failed to create call: ${errorMessage}`);
      addDebugMessage(`Call creation error: ${errorMessage}`);
    }
  }, [
    isWindowAvailable,
    windowObj,
    ensureAudioContext,
    addDebugMessage,
    startCall,
  ]);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold mb-8">Voice AI SDK Demo</h1>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!isWindowAvailable ? (
          <div className="text-gray-600">Loading browser environment...</div>
        ) : callState === CallState.IDLE || callState === CallState.ENDED ? (
          <div className="space-y-4">
            <button
              onClick={createNewCall}
              disabled={isLoading || !isWindowAvailable}
              className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-blue-300"
            >
              {isLoading ? "Creating call..." : "Start New Call"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-lg">
                Call Duration: {Math.floor(callDuration / 60)}:
                {String(callDuration % 60).padStart(2, "0")}
              </div>
              <div className="text-sm text-gray-500">State: {callState}</div>
              <button
                onClick={hangup}
                className="bg-red-500 text-white px-4 py-2 rounded"
              >
                End Call
              </button>
            </div>

            <div className="w-full bg-gray-100 p-4 rounded">
              <div className="w-full h-12 bg-gray-200 relative">
                {isRecording && (
                  <div className="absolute inset-0 bg-blue-500 opacity-50 animate-pulse" />
                )}
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`px-4 py-2 rounded ${
                  isRecording
                    ? "bg-red-500 text-white"
                    : "bg-green-500 text-white"
                }`}
                disabled={callState !== CallState.CONNECTED}
              >
                {isRecording ? "Stop Speaking" : "Start Speaking"}
              </button>
              <div className="ml-4">
                {isRecording && (
                  <span className="text-red-500 animate-pulse">
                    ● Recording
                  </span>
                )}
                {!isRecording && callState === CallState.CONNECTED && (
                  <span className="text-gray-500">Ready to record</span>
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
