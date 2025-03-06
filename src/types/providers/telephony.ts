export interface TelephonyProvider {
  send(base64Audio: string): Promise<void>;
  cancel(): Promise<void>;
  onListen(callback: (text: string) => void): void;
  hangup(): Promise<void>;
}
