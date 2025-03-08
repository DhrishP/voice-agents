export interface AIEvents {
  chunk: (text: string) => void;
  error: (error: Error) => void;
  response: (text: string) => void;
}

export interface AIService {
  initialize(): Promise<void>;
  generate(systemPrompt: string, prompt: string): Promise<string>;
  pipe(text: string): Promise<void>;
  onChunk(listenerCallback: (text: string) => void): void;
}
