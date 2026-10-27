/** Silent 8 kHz / 8-bit mono WAV of the given duration (tiny, decodes everywhere). */
export function silentWav(durationSec: number, sampleRate = 8000): Buffer {
  const samples = Math.max(1, Math.round(durationSec * sampleRate));
  const buf = Buffer.alloc(44 + samples);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28); // byte rate (8-bit mono)
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples, 40);
  buf.fill(128, 44); // unsigned 8-bit silence
  return buf;
}
