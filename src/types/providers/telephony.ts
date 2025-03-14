export interface TelephonyProvider {
  send(audioData: Buffer | string): Promise<void>;
  cancel(): Promise<void>;
  onListen(callback: (text: string) => void): void;
  hangup(): Promise<void>;
  transfer(number: string): Promise<void>;
  isSpeaking?: boolean;
}
