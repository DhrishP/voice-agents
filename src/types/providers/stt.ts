export interface STTEvents {
  transcription: (text: string) => void;
  error: (error: Error) => void;
}

export interface STTService {
  initialize(): Promise<void>;
  pipe(chunk: string): Promise<void>;
  close(): Promise<void>;
  onTranscription(listenerCallback: (text: string) => void): void;
}
