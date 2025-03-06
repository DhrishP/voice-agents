export interface STTEvents {
  transcription: (text: string) => void;
  error: (error: Error) => void;
}

export interface STTService {
  initialize(): Promise<void>;
  pipe(chunk: string): Promise<void>;
  close(): Promise<void>;
  on(event: keyof STTEvents, listener: (...args: any[]) => void): void;
}
