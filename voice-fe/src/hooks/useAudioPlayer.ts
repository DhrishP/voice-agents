import { useRef, useCallback, useState } from "react";

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueue = useRef<string[]>([]);
  const processingRef = useRef(false);

  // Initialize audio context if needed
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current && typeof window !== "undefined") {
      audioContextRef.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
    return audioContextRef.current!;
  }, []);

  // Convert base64 audio to audio buffer and play it
  const playBase64Audio = useCallback(
    async (base64Audio: string) => {
      try {
        const audioContext = getAudioContext();
        setIsPlaying(true);

        // Convert base64 to array buffer
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);

        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Decode the audio
        const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);

        // Create source and play it
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        // When playback ends
        source.onended = () => {
          setIsPlaying(false);
          // Process next audio in queue if any
          processQueue();
        };

        source.start(0);
      } catch (error) {
        console.error("Error playing audio:", error);
        setIsPlaying(false);
      }
    },
    [getAudioContext]
  );

  // Add audio to queue and process if not currently playing
  const playAudio = useCallback((base64Audio: string) => {
    audioQueue.current.push(base64Audio);
    processQueue();
  }, []);

  // Process the next item in the queue
  const processQueue = useCallback(() => {
    if (processingRef.current || audioQueue.current.length === 0) {
      return;
    }

    processingRef.current = true;
    const nextAudio = audioQueue.current.shift();

    if (nextAudio) {
      playBase64Audio(nextAudio).finally(() => {
        processingRef.current = false;
        // Check if more items to process
        if (audioQueue.current.length > 0) {
          processQueue();
        }
      });
    } else {
      processingRef.current = false;
    }
  }, [playBase64Audio]);

  // Clear the audio queue
  const clearQueue = useCallback(() => {
    audioQueue.current = [];
  }, []);

  return {
    isPlaying,
    playAudio,
    clearQueue,
  };
}

export default useAudioPlayer;
