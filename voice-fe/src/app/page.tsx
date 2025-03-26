"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useInducedCall from "@/hooks/useInducedCall";
import React from "react";
import UseWindow from "@/hooks/usewindow";

export default function HomePage() {
  const [callId, setCallId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const audioChunksRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const window = UseWindow();
  const addDebugMessage = useCallback((message: string) => {
    setDebugInfo((prev) => [message, ...prev].slice(0, 20));
    console.log("Debug:", message);
  }, []);

  const { callActive, callDuration, transcript, hangup, pipe, events } =
    useInducedCall(callId || "", {
      onError: (err) => {
        setError(err.message);
        addDebugMessage(`Error: ${err.message}`);
      },
    });

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

  useEffect(() => {
    if (callActive && events) {
      addDebugMessage("Setting up audio output handler");

      const handleAudioChunk = async (audioData: string) => {
        if (!audioContextRef.current) {
          addDebugMessage("No audio context available");
          return;
        }

        try {
          if (audioContextRef.current.state === "suspended") {
            await audioContextRef.current.resume();
          }

          const audioArrayBuffer = Buffer.from(audioData, "base64").buffer;
          const audioBuffer = await audioContextRef.current.decodeAudioData(
            audioArrayBuffer
          );
          const source = audioContextRef.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContextRef.current.destination);
          source.start(0);
          source.onended = () => source.disconnect();
        } catch (error) {
          console.error("Error playing audio:", error);
          addDebugMessage(
            `Error playing audio: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      };

      const unsubscribeAudio = events.on("audio.out", handleAudioChunk);
      return () => {
        unsubscribeAudio();
      };
    }
  }, [callActive, events, addDebugMessage]);

  const startRecording = async () => {
    if (!callActive) {
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

  const playTestTone = async () => {
    try {
      const win = typeof window !== "undefined" ? window : null;
      if (!audioContextRef.current && win) {
        const AudioContext =
          win.AudioContext || (win as any).webkitAudioContext;
        audioContextRef.current = new AudioContext({
          sampleRate: 8000,
        });
        addDebugMessage("Audio context initialized for test tone");
      }

      if (!audioContextRef.current) {
        addDebugMessage("Could not initialize audio context");
        return;
      }

      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
        addDebugMessage("Resumed audio context for test tone");
      }

      const oscillator = audioContextRef.current.createOscillator();
      const gainNode = audioContextRef.current.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(
        440,
        audioContextRef.current.currentTime
      );
      gainNode.gain.setValueAtTime(0.5, audioContextRef.current.currentTime);

      oscillator.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      oscillator.start();
      addDebugMessage("Test tone started");

      setTimeout(() => {
        oscillator.stop();
        oscillator.disconnect();
        gainNode.disconnect();
        addDebugMessage("Test tone stopped");
      }, 1000);
    } catch (error) {
      console.error("Test tone error:", error);
      addDebugMessage(
        `Test tone error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

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
          <div className="space-y-4">
            <button
              onClick={createCall}
              disabled={isLoading}
              className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-blue-300"
            >
              {isLoading ? "Creating call..." : "Start New Call"}
            </button>

            <button
              onClick={playTestTone}
              className="bg-green-500 text-white px-4 py-2 rounded ml-4"
            >
              Play Test Tone
            </button>
          </div>
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
