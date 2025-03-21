import { useState, useCallback, useRef } from "react";

interface UseAudioRecorderOptions {
  onDataAvailable?: (data: string) => void;
  sampleRate?: number;
}

// Define types for Speech Recognition
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
}

// Browser compatibility for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

export default function useAudioRecorder({
  onDataAvailable,
  sampleRate = 8000,
}: UseAudioRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      console.log("Requesting microphone access...");

      // Get audio stream for visual feedback only - the SpeechRecognition API handles its own audio capture
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 8000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      console.log("Microphone access granted");

      // Check if SpeechRecognition is supported
      if (!SpeechRecognition) {
        throw new Error(
          "SpeechRecognition API is not supported in this browser"
        );
      }

      // Set up speech recognition
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      // Configure recognition
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      // Handle results
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (!isRecording) return;

        const result = event.results[event.results.length - 1];
        const transcript = result[0].transcript;

        console.log(
          `Recognized: "${transcript}" (Confidence: ${result[0].confidence})`
        );

        // Send the raw text - backend can use this for processing instead of audio
        if (onDataAvailable) {
          onDataAvailable(
            JSON.stringify({
              text: transcript,
              isFinal: result.isFinal,
            })
          );
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error("Speech recognition error:", event.error);
      };

      // Start recognition
      recognition.start();
      setIsRecording(true);
      console.log("Speech recognition started");
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  }, [isRecording, onDataAvailable]);

  const stopRecording = useCallback(() => {
    console.log("Stopping recording...");

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        console.log(`Stopping track: ${track.kind}`);
        track.stop();
      });
      streamRef.current = null;
    }

    setIsRecording(false);
    console.log("Recording stopped");
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
}
