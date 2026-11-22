const fail = (message) => {
  throw new Error(`Invalid playback asset: ${message}`);
};
export const MAX_PLAYBACK_DECODED_BYTES = 48 * 1024 * 1024;
export function read_pcm_wav(content) {
  if (
    content.length < 44 ||
    content.toString("ascii", 0, 4) !== "RIFF" ||
    content.readUInt32LE(4) !== content.length - 8 ||
    content.toString("ascii", 8, 16) !== "WAVEfmt " ||
    content.readUInt32LE(16) !== 16 ||
    content.readUInt16LE(20) !== 1 ||
    content.readUInt16LE(22) !== 1 ||
    content.readUInt16LE(32) !== 2 ||
    content.readUInt16LE(34) !== 16 ||
    content.toString("ascii", 36, 40) !== "data" ||
    content.readUInt32LE(40) !== content.length - 44 ||
    (content.length - 44) % 2
  )
    fail("expected canonical mono PCM16 WAV");
  const rate = content.readUInt32LE(24);
  if (!rate || content.readUInt32LE(28) !== rate * 2)
    fail("invalid WAV sample rate");
  return {
    sample_rate: rate,
    frames: (content.length - 44) / 2,
    pcm: new Int16Array(
      content.buffer,
      content.byteOffset + 44,
      (content.length - 44) / 2,
    ),
  };
}
