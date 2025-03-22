export type AudioFormat = {
  sampleRate: number;
  channels: number;
  format: "pcm_s16le" | "pcm_u8";
};

export const DEFAULT_AUDIO_FORMAT: AudioFormat = {
  sampleRate: 8000,
  channels: 1,
  format: "pcm_s16le",
};
