"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useInducedCall from "@/hooks/useInducedCall";
import React from "react";
import UseWindow from "@/hooks/usewindow";
const alawmulaw = require("alawmulaw");

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
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const window = UseWindow();
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

  // Initialize audio context
  useEffect(() => {
    if (!audioContextRef.current) {
      if (!window) return;
      audioContextRef.current = new (window?.AudioContext ||
        (window as any).webkitAudioContext)({
        sampleRate: 8000,
      });
      addDebugMessage("Audio context initialized at 8kHz");
    }
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  // Start recording
  const startRecording = async () => {
    if (!callActive) {
      addDebugMessage("Cannot start recording - call not active");
      return;
    }

    // Ensure audio context is initialized
    if (!audioContextRef.current) {
      if (!window) {
        addDebugMessage("Window is not available");
        return;
      }
      try {
        audioContextRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)({
          sampleRate: 8000,
        });
        addDebugMessage("Audio context initialized at 8kHz");
      } catch (error) {
        addDebugMessage(`Failed to initialize audio context: ${error}`);
        return;
      }
    }

    // Resume audio context if it's in suspended state
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
      addDebugMessage("Audio context resumed");
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
      const audioContext = audioContextRef.current;

      if (!audioContext) {
        throw new Error("Audio context is not available");
      }

      // Create source from microphone
      const source = audioContext.createMediaStreamSource(stream);

      // Create script processor for raw PCM data
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      // Handle audio processing
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        // Convert Float32Array to Int16Array
        const samples = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Convert float to 16-bit PCM
          const s = Math.max(-1, Math.min(1, inputData[i]));
          samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Convert to base64
        const base64data = Buffer.from(samples.buffer).toString("base64");

        // Send to backend
        pipe(base64data);

        audioChunksRef.current++;
        addDebugMessage(
          `Processed audio chunk ${audioChunksRef.current}: ${samples.length} samples`
        );
      };

      // Connect the audio nodes
      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsRecording(true);
      addDebugMessage("Recording started with Web Audio API");
    } catch (error) {
      console.error("Error starting recording:", error);
      addDebugMessage(`Failed to start recording: ${error}`);
    }
  };

  // Stop recording
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

  // Set up audio output event listener for simple audio playback
  useEffect(() => {
    if (callActive && events && audioContextRef.current) {
      addDebugMessage("Setting up audio output handler");

      const playNextChunk = async () => {
        if (!audioQueueRef.current.length || !audioContextRef.current) {
          isPlayingRef.current = false;
          addDebugMessage(
            "Queue empty or no audio context - stopping playback"
          );
          return;
        }

        isPlayingRef.current = true;
        const base64Data = audioQueueRef.current.shift();
        if (!base64Data) return;

        const audioContext = audioContextRef.current;

        // Ensure context is running
        if (audioContext.state === "suspended") {
          addDebugMessage("Resuming suspended audio context");
          await audioContext.resume();
        }

        try {
          // Convert base64 to μ-law buffer
          const mulawData = Buffer.from(base64Data, "base64");
          addDebugMessage(
            `Processing μ-law data, length: ${mulawData.length} bytes`
          );

          // Decode μ-law to PCM
          const pcmData = alawmulaw.mulaw.decode(new Uint8Array(mulawData));
          addDebugMessage(
            `Decoded PCM data, length: ${pcmData.length} samples`
          );

          // Create audio buffer
          const audioBuffer = audioContext.createBuffer(
            1,
            pcmData.length,
            8000
          );
          const channelData = audioBuffer.getChannelData(0);

          // Convert Int16Array to Float32Array with amplification
          const amplification = 4.0; // Increased amplification
          for (let i = 0; i < pcmData.length; i++) {
            channelData[i] = (pcmData[i] / 32768.0) * amplification;
          }

          // Create and configure audio source
          const source = audioContext.createBufferSource();
          const gainNode = audioContext.createGain();
          gainNode.gain.value = 1.0;

          // Connect the audio nodes
          source.buffer = audioBuffer;
          source.connect(gainNode);
          gainNode.connect(audioContext.destination);

          // When this chunk ends, play the next one
          source.onended = () => {
            addDebugMessage("Chunk playback ended, playing next chunk");
            playNextChunk();
          };

          // Start playback
          source.start(0); // Explicitly start at 0
          audioChunksRef.current++;
          addDebugMessage(
            `Started playing chunk #${
              audioChunksRef.current
            }, duration: ${audioBuffer.duration.toFixed(3)}s`
          );
        } catch (error) {
          console.error("Error playing audio chunk:", error);
          addDebugMessage(
            `Error playing chunk: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          // Try to continue with next chunk even if this one failed
          setTimeout(() => playNextChunk(), 100); // Add small delay before trying next chunk
        }
      };

      const handleAudioChunk = async (base64Data: string) => {
        console.log("Received audio chunk:", base64Data.slice(0, 50) + "..."); // Log the start of the chunk

        const audioContext = audioContextRef.current;
        if (!audioContext) {
          addDebugMessage("No audio context available for incoming chunk");
          return;
        }

        try {
          // Quick validation of base64 data
          if (!base64Data || base64Data.length < 10) {
            addDebugMessage("Received invalid or empty audio chunk");
            return;
          }

          // Log the audio context state
          console.log("AudioContext state:", audioContext.state);
          addDebugMessage(`AudioContext state: ${audioContext.state}`);

          // Resume AudioContext if it's suspended
          if (audioContext.state === "suspended") {
            await audioContext.resume();
            addDebugMessage("Resumed suspended audio context");
          }

          // Convert base64 to μ-law buffer for validation
          const mulawData = Buffer.from(base64Data, "base64");
          console.log(
            "μ-law data length:",
            mulawData.length,
            "first few bytes:",
            Array.from(mulawData.slice(0, 5))
          );

          // Add the chunk to the queue
          audioQueueRef.current.push(base64Data);
          addDebugMessage(
            `Added chunk to queue. Queue length: ${audioQueueRef.current.length}`
          );

          // If nothing is playing, start playing
          if (!isPlayingRef.current) {
            addDebugMessage("Starting playback of queued chunks");
            playNextChunk();
          }
        } catch (error) {
          console.error("Error handling audio chunk:", error);
          addDebugMessage(
            `Error handling chunk: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      };

      const unsubscribe = events.on("audio.out", handleAudioChunk);

      // Clean up function
      return () => {
        unsubscribe();
        audioQueueRef.current = []; // Clear the queue
        isPlayingRef.current = false;
        addDebugMessage("Audio output handler removed and state cleared");
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

  const playTestTone = async () => {
    if (!audioContextRef.current) {
      addDebugMessage("No audio context for test tone");
      return;
    }

    const audioContext = audioContextRef.current;

    try {
      // Resume context if suspended
      if (audioContext.state === "suspended") {
        await audioContext.resume();
        addDebugMessage("Resumed audio context for test tone");
      }

      // Create an oscillator
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // 440 Hz
      gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start();
      addDebugMessage("Test tone started");

      // Stop after 1 second
      setTimeout(() => {
        oscillator.stop();
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
