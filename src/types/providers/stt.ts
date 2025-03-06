export interface STTProvider {
  initialize(): Promise<void>;
  pipe(chunk: string): Promise<void>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
}
