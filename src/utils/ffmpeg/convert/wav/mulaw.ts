import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface ConversionOptions {
  fromSampleRate?: number;
  toSampleRate?: number;
}

export function convertWavToMulaw(audio: string, options: ConversionOptions = {}): Promise<Buffer> {
  const { fromSampleRate = 8000, toSampleRate = 8000 } = options;
  
  // Convert base64 to buffer
  const audioBuffer = Buffer.from(audio, 'base64');

  const tempFilePath = path.join(process.cwd(), `${uuidv4()}.wav`);
  fs.writeFileSync(tempFilePath, audioBuffer);

  const outputFilePath = path.join(process.cwd(), `${uuidv4()}.mulaw`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', tempFilePath,
      '-ar', toSampleRate.toString(),
      '-f', 'mulaw',
      outputFilePath
    ]);

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        const mulawBuffer = fs.readFileSync(outputFilePath);
        resolve(mulawBuffer);
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}
