export type AudioFormat = {
  sampleRate: number;
  channels: number;
  format: "pcm_s16le" | "pcm_u8" | "mulaw";
};

export const DEFAULT_AUDIO_FORMAT: AudioFormat = {
  sampleRate: 8000,
  channels: 1,
  format: "mulaw",
};

export const DEFAULT_AUDIO_FORMAT_PCM_S16LE: AudioFormat = {
  sampleRate: 8000,
  channels: 1,
  format: "pcm_s16le",
};
