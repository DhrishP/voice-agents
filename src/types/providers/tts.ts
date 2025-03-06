export interface TTSProvider {
  initialize(): Promise<void>;
  generate(text: string): Promise<string>;
  pipe(text: string): Promise<void>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
}
