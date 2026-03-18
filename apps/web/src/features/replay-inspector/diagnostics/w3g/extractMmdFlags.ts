// replay-inspector/diagnostics/w3g/extractMmdFlags.ts
//
// Scan decompressed replay stream for W3MMD flags.
// We look for "kMMD.Dat\0val:" entries and parse payload lines like:
//   "FlagP <pid> winner"
//   "FlagP <pid> loser"
//   "FlagP <pid> leaver"

export type ManualW3MMD = {
  flagsByPid: Record<number, string>;
};

function findNeedle(hay: Uint8Array, needle: Uint8Array, start: number): number {
  outer: for (let i = start; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function readNullTerminatedUtf8(buf: Uint8Array, start: number): { text: string; next: number } | null {
  let end = start;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(start, end));
  return { text, next: end + 1 };
}

export function extractMmdFlagsFromStream(stream: Uint8Array): ManualW3MMD | null {
  const needle = new TextEncoder().encode("kMMD.Dat\0val:");
  const flagsByPid: Record<number, string> = {};

  let idx = 0;
  while (idx >= 0 && idx < stream.length) {
    const found = findNeedle(stream, needle, idx);
    if (found === -1) break;

    // After needle comes the val number (null-terminated), then the payload (null-terminated)
    const valNumStart = found + needle.length;
    const valNum = readNullTerminatedUtf8(stream, valNumStart);
    if (!valNum) break;

    const payload = readNullTerminatedUtf8(stream, valNum.next);
    if (!payload) break;

    const line = payload.text;
    if (line.startsWith("FlagP ")) {
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[1]);
      const flag = parts[2];

      if (Number.isFinite(pid) && typeof flag === "string" && flag.length) {
        // last-write-wins is fine for now
        flagsByPid[pid] = flag;
      }
    }

    idx = payload.next;
  }

  return Object.keys(flagsByPid).length ? { flagsByPid } : null;
}
