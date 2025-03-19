"use client";

import { useState, useEffect, useCallback } from "react";
import useInducedCall from "@/hooks/useInducedCall";
import useAudioRecorder from "@/hooks/useAudioRecorder";

export default function HomePage() {
  const [callId, setCallId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use our custom hooks
  const { callActive, callDuration, transcript, hangup, pipe, events } =
    useInducedCall(callId || "", {
      onError: (err) => setError(err.message),
    });

  const { isRecording, startRecording, stopRecording } = useAudioRecorder({
    onDataAvailable: (audioData) => {
      if (callActive) {
        pipe(audioData);
      }
    },
  });

  // Set up audio output event listener
  useEffect(() => {
    if (callActive && events) {
      // Create audio context for playing received audio
      const audioContext = new AudioContext({ sampleRate: 8000 });

      const playAudioChunk = async (base64Data: string) => {
        try {
          // Convert base64 µ-law to audio buffer
          const audioData = Buffer.from(base64Data, "base64");
          const audioBuffer = audioContext.createBuffer(
            1,
            audioData.length,
            8000
          );
          const channelData = audioBuffer.getChannelData(0);

          // Convert µ-law to PCM
          for (let i = 0; i < audioData.length; i++) {
            const mulawSample = audioData[i];
            const sign = mulawSample & 0x80 ? -1 : 1;
            const magnitude = (~mulawSample & 0x7f) / 127.0;
            channelData[i] =
              (sign * (Math.exp(magnitude * Math.log(1 + 255)) - 1)) / 255;
          }

          // Play the audio
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          source.start();
        } catch (error) {
          console.error("Error playing audio:", error);
        }
      };

      const unsubscribe = events.on("audio.out", playAudioChunk);
      return () => {
        unsubscribe();
        audioContext.close();
      };
    }
  }, [callActive, events]);

  const createCall = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

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
            </div>

            <div className="mt-6">
              <h2 className="text-xl font-semibold mb-2">Transcript</h2>
              <div className="bg-gray-100 p-4 rounded max-h-96 overflow-y-auto">
                {transcript.map((text, index) => (
                  <p key={index} className="mb-2">
                    {text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
