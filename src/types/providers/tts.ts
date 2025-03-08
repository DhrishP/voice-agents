export interface TTSEvents {
  chunk: (data: Buffer) => void;
  error: (error: Error) => void;
  close: () => void;
}

export interface TTSService {
  initialize(): Promise<void>;
  pipe(text: string): Promise<void>;
  close(): Promise<void>;
  onChunk(listenerCallback: (data: Buffer) => void): void;
}
