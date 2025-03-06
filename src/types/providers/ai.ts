export interface AIProvider {
  initialize(): Promise<void>;
  generate(systemPrompt: string, prompt: string): Promise<string>;
  pipe(text: string): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
}
