// replay-inspector/diagnostics/w3g/decompressReplay.ts
//
// Decompress Warcraft 3 .w3g replay data in the browser.
//
// IMPORTANT:
// - .w3g is NOT a zip.
// - Replays are split into many "compressed blocks", but those blocks are NOT
//   valid standalone zlib streams.
// - The practical solution (works for LTD replays we tested):
//   1) Read each block payload
//   2) Strip the 2-byte zlib header from each payload
//   3) Concatenate all payloads into one raw-deflate byte stream
//   4) Append a missing final empty stored block terminator: 01 00 00 FF FF
//   5) Inflate using pako.inflateRaw
//
// This yields a single decompressed byte stream we can scan for W3MMD etc.

import { dlog, dwarn } from "../config";

function u32le(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

async function getPako(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("pako");
  if (!mod?.inflateRaw) throw new Error("pako not available (need pako.inflateRaw)");
  return mod;
}

export type DecompressResult = {
  stream: Uint8Array;
  blocks: number;
  headerSize: number;
};

export async function decompressReplayFile(fileBytes: Uint8Array): Promise<DecompressResult> {
  // Header layout:
  // 0..27  : signature "Warcraft III recorded game\0x1A\0"
  // 28..31 : headerSize (u32le)
  // 32..35 : compressedSize
  // 36..39 : decompressedSize
  // 40..43 : headerVersion
  // 44..47 : blocks (u32le)
  const headerSize = u32le(fileBytes, 28);
  const blocks = u32le(fileBytes, 44);

  dlog("headerSize", headerSize, "blocks", blocks);

  let pos = headerSize;

  // Collect "raw deflate" chunks derived from each replay block:
  // Each block payload begins with a zlib header (commonly 0x78 0x01 / 0x78 0x9C etc),
  // but the payload itself acts like raw deflate pieces. We drop the first 2 bytes.
  const rawDeflateChunks: Uint8Array[] = [];

  for (let i = 0; i < blocks; i++) {
    if (pos + 12 > fileBytes.length) {
      dwarn("Unexpected EOF reading block header at", i, "pos", pos);
      break;
    }

    const cSize = u32le(fileBytes, pos);
    const dSize = u32le(fileBytes, pos + 4);
    // const checksum = u32le(fileBytes, pos + 8);
    pos += 12;

    if (pos + cSize > fileBytes.length) {
      dwarn("Unexpected EOF reading block payload at", i, "pos", pos, "cSize", cSize);
      break;
    }

    const comp = fileBytes.subarray(pos, pos + cSize);
    pos += cSize;

    if (i === 0) {
      dlog("block0 sizes", { cSize, dSize });
      dlog("block0 first bytes (16)", Array.from(comp.subarray(0, 16)));
    }

    // Defensive: if too small, skip
    if (comp.length <= 2) continue;

    // Strip 2-byte zlib header.
    // We do NOT try to inflate per block.
    rawDeflateChunks.push(comp.subarray(2));

    if (i % 25 === 0) dlog(`block ${i}/${blocks} pos=${pos}`);
  }

  const rawDeflate = concatBytes(rawDeflateChunks);

  // Append a missing final empty stored block terminator.
  // This is required to make the raw-deflate stream finish cleanly.
  // bytes: 01 00 00 FF FF
  const terminator = new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]);

  const joined = new Uint8Array(rawDeflate.length + terminator.length);
  joined.set(rawDeflate, 0);
  joined.set(terminator, rawDeflate.length);

  const pako = await getPako();

  let out: Uint8Array;
  try {
    out = pako.inflateRaw(joined) as Uint8Array;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    throw new Error(
      `pako.inflateRaw failed after concatenating ${rawDeflateChunks.length} blocks (rawDeflate=${rawDeflate.length}). ${msg}`
    );
  }

  dlog("decompressed stream length", out.length);

  return { stream: out, blocks, headerSize };
}
