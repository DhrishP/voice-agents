"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useInducedVoice, CallState } from "@/hooks/useInducedVoice";
import React from "react";
import UseWindow from "@/hooks/usewindow";

export default function VoiceDemoPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const audioChunksRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const window = UseWindow();

  const addDebugMessage = useCallback((message: string) => {
    setDebugInfo((prev) => [message, ...prev].slice(0, 20));
    console.log("Debug:", message);
  }, []);

  // Add function to ensure audio context is ready
  const ensureAudioContext = useCallback(async () => {
    const win = typeof window !== "undefined" ? window : null;
    if (!win) return false;

    try {
      if (!audioContextRef.current) {
        const AudioContext =
          win.AudioContext || (win as any).webkitAudioContext;
        audioContextRef.current = new AudioContext({
          sampleRate: 8000,
        });
        addDebugMessage("Created new audio context at 8kHz");
      }

      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
        addDebugMessage("Resumed suspended audio context");
      }

      return true;
    } catch (error) {
      addDebugMessage(`Audio context error: ${error}`);
      return false;
    }
  }, [addDebugMessage]);

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
    try {
      setError(null);
      addDebugMessage("Creating new call...");
      audioChunksRef.current = 0;

      // Initialize audio context with user interaction, similar to test tone
      const win = typeof window !== "undefined" ? window : null;
      if (!audioContextRef.current && win) {
        const AudioContext =
          win.AudioContext || (win as any).webkitAudioContext;
        audioContextRef.current = new AudioContext({
          sampleRate: 8000,
        });
        addDebugMessage("Audio context initialized");
      }

      if (!audioContextRef.current) {
        addDebugMessage("Could not initialize audio context");
        return;
      }

      // Resume and initialize audio with a brief tone, like the test tone did
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
        addDebugMessage("Resumed audio context");
      }

      // Play a quick initialization tone (very short and quiet)
      const oscillator = audioContextRef.current.createOscillator();
      const gainNode = audioContextRef.current.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(
        440,
        audioContextRef.current.currentTime
      );
      gainNode.gain.setValueAtTime(0.01, audioContextRef.current.currentTime); // Very quiet

      oscillator.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      oscillator.start();
      oscillator.stop(audioContextRef.current.currentTime + 0.01); // Very short duration

      addDebugMessage("Audio system initialized");

      // Clean up after the tone
      setTimeout(() => {
        oscillator.disconnect();
        gainNode.disconnect();
      }, 100);

      await startCall({
        prompt:
          "You are a helpful voice assistant. Keep your responses concise and clear. Answer the user's questions helpfully.",
      });

      addDebugMessage("Call created successfully");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "An error occurred";
      setError(errorMsg);
      addDebugMessage(`Error creating call: ${errorMsg}`);
    }
  }, [startCall, addDebugMessage]);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold mb-8">Voice AI SDK Demo</h1>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {callState === CallState.IDLE || callState === CallState.ENDED ? (
          <div className="space-y-4">
            <button
              onClick={createNewCall}
              disabled={isLoading}
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
