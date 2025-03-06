export interface TTSEvents {
  chunk: (data: Buffer) => void;
  error: (error: Error) => void;
  close: () => void;
}

export interface TTSService {
  initialize(): Promise<void>;
  generate(text: string): Promise<string>;
  pipe(text: string): Promise<void>;
  close(): Promise<void>;
  on(event: keyof TTSEvents, listener: (...args: any[]) => void): void;
}
