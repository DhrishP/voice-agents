import { useState, useCallback, useRef } from "react";

interface UseAudioRecorderOptions {
  onDataAvailable?: (data: string) => void;
  sampleRate?: number;
}

export default function useAudioRecorder({
  onDataAvailable,
  sampleRate = 8000,
}: UseAudioRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Function to convert audio buffer to µ-law encoded base64
  const convertToMulaw = (buffer: Float32Array): string => {
    const mulawData = new Uint8Array(buffer.length);

    for (let i = 0; i < buffer.length; i++) {
      // Convert float to µ-law
      let sample = Math.max(-1, Math.min(1, buffer[i]));
      const sign = sample < 0 ? 1 : 0;
      sample = Math.abs(sample);

      // Convert to µ-law
      sample =
        sample <= 0.00001 ? 0 : Math.log(1 + 255 * sample) / Math.log(1 + 255);
      const value = Math.round(sample * 255);

      // Encode with sign bit
      mulawData[i] = ~(sign * 128 + value) & 0xff;
    }

    return Buffer.from(mulawData).toString("base64");
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Create AudioContext and processor
      const audioContext = new AudioContext({ sampleRate });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        if (!isRecording) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const base64Data = convertToMulaw(inputData);

        if (onDataAvailable) {
          onDataAvailable(base64Data);
        }
      };

      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  }, [isRecording, onDataAvailable, sampleRate]);

  const stopRecording = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    setIsRecording(false);
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
}
