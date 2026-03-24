import { createRequire } from "node:module";
import { inflateRawSync } from "node:zlib";

const require = createRequire(import.meta.url);
const PATCHED = Symbol.for("wc3.replay.w3gjs_patched");

const WC3_PLAYER_COLORS: Record<number, string> = {
  0: "#ff0303",
  1: "#0042ff",
  2: "#1ce6b9",
  3: "#540081",
  4: "#fffc01",
  5: "#fe8a0e",
  6: "#20c000",
  7: "#e55bb0",
  8: "#959697",
  9: "#7ebff1",
  10: "#106246",
  11: "#4e2a04",
  12: "#9b0000",
  13: "#0000c3",
  14: "#00eaff",
  15: "#be00fe",
  16: "#ebcd87",
  17: "#f8a48b",
  18: "#bfff80",
  19: "#dcb9eb",
  20: "#282828",
  21: "#ebf0ff",
  22: "#00781e",
  23: "#a46f33",
};

type PlayerRecord = { playerId: number; playerName: string };
type ReforgedPlayerRecord = { playerId?: number; name?: string; clan?: string };
type SlotRecord = {
  playerId: number;
  slotStatus: number;
  computerFlag: number;
  teamId: number;
  color: number;
  raceFlag: number;
  aiStrength: number;
  handicapFlag: number;
};
type ReplayMetadata = {
  playerRecords: PlayerRecord[];
  reforgedPlayerMetadata: ReforgedPlayerRecord[];
  slotRecords: SlotRecord[];
  gameName?: string;
};

type ParseReplayResult = {
  raw: any;
  partial: boolean;
  error?: string;
};

function safeKeys(v: any): string[] {
  if (!v || typeof v !== "object") return [];
  try {
    return Object.keys(v).sort();
  } catch {
    return [];
  }
}

function toFiniteNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isPlaceholderPlayerName(name: unknown): boolean {
  const s = String(name ?? "").trim();
  if (!s) return true;
  if (/^player\s+\d+$/i.test(s)) return true;
  if (/^pid\s+\d+$/i.test(s)) return true;
  if (/^unknown$/i.test(s)) return true;
  return false;
}

function cleanPlayerName(name: unknown): string | undefined {
  const s = String(name ?? "")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!s || isPlaceholderPlayerName(s)) return undefined;
  return s;
}

function getW3GReplayCtor(): any {
  const mod: any = require("w3gjs");
  return mod?.default ?? mod?.W3GReplay ?? mod;
}

function patchW3GReplayCtor(Ctor: any) {
  const proto = Ctor?.prototype;
  if (!proto || proto[PATCHED]) return;

  const origHandleChatMessage = typeof proto.handleChatMessage === "function" ? proto.handleChatMessage : null;
  if (origHandleChatMessage) {
    proto.handleChatMessage = function patchedHandleChatMessage(block: any, timeMS: number) {
      const playerId = typeof block?.playerId === "number" ? block.playerId : undefined;
      const player = playerId != null ? this.players?.[playerId] : undefined;

      if (!player) {
        const fallbackName = typeof block?.playerName === "string" && block.playerName.trim()
          ? block.playerName.trim()
          : `player ${playerId ?? "?"}`;

        const mode = typeof this?.numericalChatModeToChatMessageMode === "function"
          ? this.numericalChatModeToChatMessageMode(block?.mode)
          : block?.mode;

        this.chatlog = Array.isArray(this.chatlog) ? this.chatlog : [];
        this.chatlog.push({
          playerName: fallbackName,
          playerId: playerId ?? -1,
          message: typeof block?.message === "string" ? block.message : String(block?.message ?? ""),
          mode,
          timeMS,
        });
        return;
      }

      return origHandleChatMessage.call(this, block, timeMS);
    };
  }

  const origProcessCommandDataBlock = typeof proto.processCommandDataBlock === "function" ? proto.processCommandDataBlock : null;
  if (origProcessCommandDataBlock) {
    proto.processCommandDataBlock = function patchedProcessCommandDataBlock(block: any) {
      try {
        const playerId = typeof block?.playerId === "number" ? block.playerId : undefined;
        const known = playerId != null && this?.knownPlayerIds?.has?.(String(playerId));
        if (playerId != null && !known) return;
        return origProcessCommandDataBlock.call(this, block);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (msg.includes("reading 'name'") || msg.includes('reading "name"')) return;
        throw e;
      }
    };
  }

  const origHandleActionBlock = typeof proto.handleActionBlock === "function" ? proto.handleActionBlock : null;
  if (origHandleActionBlock) {
    proto.handleActionBlock = function patchedHandleActionBlock(action: any, currentPlayer: any) {
      if (action?.id === 0x51) {
        const slot = toFiniteNumber(action?.slot);
        const playerId = slot != null && typeof this?.getPlayerBySlotId === "function" ? this.getPlayerBySlotId(slot) : undefined;
        if (playerId == null || !this?.players?.[playerId]) return;
      }
      return origHandleActionBlock.call(this, action, currentPlayer);
    };
  }

  const origDetermineWinningTeam = typeof proto.determineWinningTeam === "function" ? proto.determineWinningTeam : null;
  if (origDetermineWinningTeam) {
    proto.determineWinningTeam = function patchedDetermineWinningTeam() {
      try {
        return origDetermineWinningTeam.call(this);
      } catch {
        this.winningTeamId = -1;
      }
    };
  }

  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false, configurable: false });
}

function u32le(buf: Uint8Array, off: number): number {
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function decompressReplayStream(fileBytes: Buffer | Uint8Array): Uint8Array {
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  const headerSize = u32le(bytes, 28);
  const blocks = u32le(bytes, 44);
  let pos = headerSize;
  const rawDeflateChunks: Uint8Array[] = [];

  for (let i = 0; i < blocks; i++) {
    if (pos + 12 > bytes.length) break;
    const cSize = u32le(bytes, pos);
    pos += 12;
    if (pos + cSize > bytes.length) break;
    const comp = bytes.subarray(pos, pos + cSize);
    pos += cSize;
    if (comp.length > 2) rawDeflateChunks.push(comp.subarray(2));
  }

  const rawDeflate = concatBytes(rawDeflateChunks);
  const terminator = new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]);
  const joined = new Uint8Array(rawDeflate.length + terminator.length);
  joined.set(rawDeflate, 0);
  joined.set(terminator, rawDeflate.length);
  return inflateRawSync(joined);
}

class Cursor {
  private readonly buf: Uint8Array;
  offset = 0;
  private readonly text = new TextDecoder("utf-8", { fatal: false });

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  get length() {
    return this.buf.length;
  }

  seek(n: number) {
    this.offset = Math.max(0, Math.min(this.buf.length, n));
  }

  skip(n: number) {
    this.seek(this.offset + n);
  }

  peekU8(at = this.offset): number | undefined {
    return at < this.buf.length ? this.buf[at] : undefined;
  }

  readU8(): number {
    if (this.offset >= this.buf.length) throw new Error("Unexpected EOF while reading u8");
    return this.buf[this.offset++]!;
  }

  readU16LE(): number {
    if (this.offset + 2 > this.buf.length) throw new Error("Unexpected EOF while reading u16le");
    const o = this.offset;
    this.offset += 2;
    return this.buf[o]! | (this.buf[o + 1]! << 8);
  }

  readU32LE(): number {
    if (this.offset + 4 > this.buf.length) throw new Error("Unexpected EOF while reading u32le");
    const o = this.offset;
    this.offset += 4;
    return (this.buf[o]! | (this.buf[o + 1]! << 8) | (this.buf[o + 2]! << 16) | (this.buf[o + 3]! << 24)) >>> 0;
  }

  readBytes(n: number): Uint8Array {
    if (this.offset + n > this.buf.length) throw new Error(`Unexpected EOF while reading ${n} bytes`);
    const out = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  readZeroTermString(): string {
    const start = this.offset;
    while (this.offset < this.buf.length && this.buf[this.offset] !== 0) this.offset += 1;
    const out = this.text.decode(this.buf.subarray(start, this.offset));
    if (this.offset < this.buf.length && this.buf[this.offset] === 0) this.offset += 1;
    return out;
  }
}

function readVarint(cur: Cursor): number {
  let shift = 0;
  let value = 0;
  while (shift < 35) {
    const b = cur.readU8();
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return value >>> 0;
    shift += 7;
  }
  throw new Error("Invalid protobuf varint");
}

function parseReforgedPlayerData(data: Uint8Array): ReforgedPlayerRecord {
  const cur = new Cursor(data);
  const out: ReforgedPlayerRecord = {};

  while (cur.offset < cur.length) {
    const key = readVarint(cur);
    const field = key >>> 3;
    const wire = key & 0x7;

    if (wire === 0) {
      const value = readVarint(cur);
      if (field === 1) out.playerId = value;
      continue;
    }

    if (wire === 2) {
      const len = readVarint(cur);
      const bytes = cur.readBytes(len);
      const value = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (field === 2) out.name = value;
      else if (field === 3) out.clan = value;
      continue;
    }

    if (wire === 5) {
      cur.skip(4);
      continue;
    }

    if (wire === 1) {
      cur.skip(8);
      continue;
    }

    throw new Error(`Unsupported protobuf wire type ${wire}`);
  }

  return out;
}

function parsePlayerRecordAt(cur: Cursor): PlayerRecord {
  const recordId = cur.readU8();
  if (recordId !== 0x00 && recordId !== 0x16) throw new Error(`Unexpected player record id ${recordId}`);
  const playerId = cur.readU8();
  const playerName = cur.readZeroTermString();
  const addData = cur.readU8();
  if (addData === 0x01) cur.skip(1);
  else if (addData === 0x08) cur.skip(8);
  else if (addData > 0 && addData < 64) cur.skip(addData);
  return { playerId, playerName };
}

function parsePlayerList(cur: Cursor): PlayerRecord[] {
  const list: PlayerRecord[] = [];
  while (cur.peekU8() === 0x16) {
    list.push(parsePlayerRecordAt(cur));
    if (cur.offset + 4 <= cur.length) cur.skip(4);
  }
  return list;
}

function parseReforgedPlayerMetadata(cur: Cursor): ReforgedPlayerRecord[] {
  const out: ReforgedPlayerRecord[] = [];
  while (cur.peekU8() === 0x39) {
    cur.readU8();
    const subtype = cur.readU8();
    const len = cur.readU32LE();
    const data = cur.readBytes(len);
    if (subtype === 0x03) {
      try {
        out.push(parseReforgedPlayerData(data));
      } catch {
        // ignore malformed payloads
      }
    }
  }
  return out;
}

function parseSlotRecords(cur: Cursor, count: number): SlotRecord[] {
  const slots: SlotRecord[] = [];
  for (let i = 0; i < count; i++) {
    const playerId = cur.readU8();
    cur.skip(1);
    slots.push({
      playerId,
      slotStatus: cur.readU8(),
      computerFlag: cur.readU8(),
      teamId: cur.readU8(),
      color: cur.readU8(),
      raceFlag: cur.readU8(),
      aiStrength: cur.readU8(),
      handicapFlag: cur.readU8(),
    });
  }
  return slots;
}

function isLikelyStartupSlotBlock(
  stream: Uint8Array,
  start: number,
  knownPlayerIds?: Set<number>,
): number {
  if (start + 4 >= stream.length) return -1;
  if (stream[start] !== 0x19) return -1;

  const bytesFollowing = stream[start + 1]! | (stream[start + 2]! << 8);
  const slotCount = stream[start + 3]!;

  if (slotCount <= 0 || slotCount > 24) return -1;

  // Correct structure:
  // slotCount byte + (slotCount * 9 slot bytes) + randomSeed(4) + selectMode(1) + startSpotCount(1)
  const needed = 1 + slotCount * 9 + 6;
  if (bytesFollowing < needed) return -1;

  const end = start + 4 + slotCount * 9 + 6;
  if (end > stream.length) return -1;

  let occupied = 0;
  let humanOccupied = 0;
  let matchedKnownIds = 0;

  let off = start + 4;
  for (let i = 0; i < slotCount; i++, off += 9) {
    const playerId = stream[off]!;
    const downloadPct = stream[off + 1]!;
    const slotStatus = stream[off + 2]!;
    const computerFlag = stream[off + 3]!;
    const teamId = stream[off + 4]!;
    const color = stream[off + 5]!;
    const handicap = stream[off + 8]!;

    if (slotStatus > 0) occupied++;
    if (slotStatus > 1 && computerFlag === 0) humanOccupied++;

    // Plausibility checks
    if (teamId > 24) return -1;
    if (color > 23) return -1;
    if (handicap < 50 || handicap > 100) return -1;

    // Humans usually show 100, computer slots often show 255
    if (!(downloadPct === 100 || downloadPct === 255)) return -1;

    if (slotStatus > 1 && computerFlag === 0 && knownPlayerIds?.has(playerId)) {
      matchedKnownIds++;
    }
  }

  if (occupied < 2) return -1;

  // Strongly prefer startup blocks that actually reference known player IDs
  return matchedKnownIds * 100 + humanOccupied * 10 + occupied;
}

function findGameStartOffset(
  stream: Uint8Array,
  startOffset: number,
  knownPlayerIds?: Set<number>,
): number {
  const searchStart = Math.max(0, startOffset);
  const searchEnd = Math.min(stream.length - 4, startOffset + 8192);

  let bestOffset = -1;
  let bestScore = -1;

  for (let i = searchStart; i < searchEnd; i++) {
    if (stream[i] !== 0x19) continue;

    const score = isLikelyStartupSlotBlock(stream, i, knownPlayerIds);
    if (score < 0) continue;

    if (score > bestScore) {
      bestScore = score;
      bestOffset = i;
    }
  }

  return bestOffset;
}

function scanPlayerRecordsNearStart(stream: Uint8Array): PlayerRecord[] {
  const out = new Map<number, string>();
  const limit = Math.min(stream.length, 65536);
  const dec = new TextDecoder("utf-8", { fatal: false });

  for (let i = 4; i < limit - 6; i++) {
    const recId = stream[i]!;
    if (recId !== 0x00 && recId !== 0x16) continue;
    const playerId = stream[i + 1]!;
    if (playerId > 24) continue;
    let end = i + 2;
    while (end < limit && stream[end] !== 0 && end - (i + 2) <= 64) end++;
    if (end >= limit || stream[end] !== 0) continue;
    const playerName = cleanPlayerName(dec.decode(stream.subarray(i + 2, end)));
    if (!playerName) continue;
    const addData = stream[end + 1]!;
    if (addData !== 0x01 && addData !== 0x02 && addData !== 0x08 && !(addData > 0 && addData < 64)) continue;
    const prev = out.get(playerId);
    if (!prev || playerName.length > prev.length) out.set(playerId, playerName);
  }

  return [...out.entries()].map(([playerId, playerName]) => ({ playerId, playerName }));
}

function scanLikelySlotRecords(stream: Uint8Array, knownPlayerIds?: Set<number>): SlotRecord[] {
  let best: SlotRecord[] = [];
  let bestScore = -1;

  for (let start = 0; start < Math.min(stream.length - 8, 65536); start++) {
    if (stream[start] !== 0x19) continue;

    const score = isLikelyStartupSlotBlock(stream, start, knownPlayerIds);
    if (score < 0) continue;

    try {
      const cur = new Cursor(stream.subarray(start));
      cur.readU8();      // 0x19
      cur.readU16LE();   // bytesFollowing
      const count = cur.readU8();
      const slots = parseSlotRecords(cur, count);

      if (score > bestScore) {
        bestScore = score;
        best = slots;
      }
    } catch {
      // ignore malformed candidates
    }
  }

  return best;
}

function parseReplayMetadataFromStream(stream: Uint8Array): ReplayMetadata {
  let gameName: string | undefined;
  let playerRecords: PlayerRecord[] = [];
  let reforgedPlayerMetadata: ReforgedPlayerRecord[] = [];
  let slotRecords: SlotRecord[] = [];

  try {
    const cur = new Cursor(stream);
    cur.skip(4);

    const hostRecord = parsePlayerRecordAt(cur);
    gameName = cleanPlayerName(cur.readZeroTermString()) ?? undefined;
    if (cur.peekU8() === 0x00) cur.skip(1);

    while (cur.offset < cur.length && cur.peekU8() !== 0x00) cur.skip(1);
    if (cur.peekU8() === 0x00) cur.skip(1);

    if (cur.offset + 12 <= cur.length) cur.skip(12);

    playerRecords = [hostRecord, ...parsePlayerList(cur)];

    const knownPlayerIds = new Set<number>();
    for (const row of playerRecords) {
      const id = toFiniteNumber(row?.playerId);
      if (id != null) knownPlayerIds.add(id);
    }

    const gameStartAt = findGameStartOffset(stream, cur.offset, knownPlayerIds);
    if (gameStartAt > cur.offset) {
      const beforeStart = new Cursor(stream.subarray(cur.offset, gameStartAt));
      try {
        reforgedPlayerMetadata = parseReforgedPlayerMetadata(beforeStart);
      } catch {
        reforgedPlayerMetadata = [];
      }
      cur.seek(gameStartAt);
    } else if (cur.peekU8() !== 0x19) {
      const maybe = findGameStartOffset(stream, cur.offset, knownPlayerIds);
      if (maybe >= 0) cur.seek(maybe);
    }

    if (cur.peekU8() === 0x19) {
      cur.readU8();
      cur.readU16LE();
      const slotRecordCount = cur.readU8();
      slotRecords = parseSlotRecords(cur, slotRecordCount);
    }
  } catch {
    // fall through to scanners below
  }

const scannedPlayers = scanPlayerRecordsNearStart(stream);
const playersById = new Map<number, PlayerRecord>();

// Authoritative source first
for (const row of playerRecords) {
  const playerId = toFiniteNumber((row as any)?.playerId);
  const playerName = cleanPlayerName((row as any)?.playerName);
  if (playerId == null || !playerName) continue;
  if (!playersById.has(playerId)) {
    playersById.set(playerId, { playerId, playerName });
  }
}

// Scanner only as fallback
for (const row of scannedPlayers) {
  const playerId = toFiniteNumber((row as any)?.playerId);
  const playerName = cleanPlayerName((row as any)?.playerName);
  if (playerId == null || !playerName) continue;
  if (!playersById.has(playerId)) {
    playersById.set(playerId, { playerId, playerName });
  }
}
  const allKnownPlayerIds = new Set<number>(playersById.keys());

  if (!slotRecords.length) {
    slotRecords = scanLikelySlotRecords(stream, allKnownPlayerIds);
  }

  return {
    playerRecords: [...playersById.values()],
    reforgedPlayerMetadata,
    slotRecords,
    gameName,
  };
}

function isObserverTeamId(teamId: number | undefined, versionLike: unknown): boolean {
  if (typeof teamId !== "number") return false;
  const version = String(versionLike ?? "").trim();
  const numericVersion = toFiniteNumber(versionLike) ?? Number.parseFloat(version);
  if (Number.isFinite(numericVersion) && numericVersion >= 29) return teamId === 24;
  if (version.startsWith("2.")) return teamId === 24;
  return teamId === 12;
}

function getMetadataNameByPlayerId(metadata: ReplayMetadata | undefined, parser: any): Map<number, string> {
  const out = new Map<number, string>();
  const playerRecords = metadata?.playerRecords ?? parser?.info?.metadata?.playerRecords ?? [];
  const reforgedPlayerMetadata = metadata?.reforgedPlayerMetadata ?? parser?.info?.metadata?.reforgedPlayerMetadata ?? [];

  for (const row of playerRecords) {
    const playerId = toFiniteNumber((row as any)?.playerId);
    const playerName = cleanPlayerName((row as any)?.playerName);
    if (playerId != null && playerName) out.set(playerId, playerName);
  }

  for (const row of reforgedPlayerMetadata) {
    const playerId = toFiniteNumber((row as any)?.playerId);
    const playerName = cleanPlayerName((row as any)?.name);
    if (playerId != null && playerName) out.set(playerId, playerName);
  }

  return out;
}

function playersToArray(playersLike: any): any[] {
  if (Array.isArray(playersLike)) return playersLike;
  if (playersLike && typeof playersLike === "object") return Object.values(playersLike);
  return [];
}

function buildCanonicalPlayers(parsed: any, parser: any, metadata: ReplayMetadata | undefined, versionLike: unknown): any[] {
  const nameByPlayerId = getMetadataNameByPlayerId(metadata, parser);

  const orderedMetadataNames = [
    ...(metadata?.playerRecords ?? parser?.info?.metadata?.playerRecords ?? []),
    ...(metadata?.reforgedPlayerMetadata ?? parser?.info?.metadata?.reforgedPlayerMetadata ?? []),
  ]
    .map((row: any) => cleanPlayerName(row?.playerName ?? row?.name))
    .filter((v: string | undefined): v is string => !!v);

  const slots =
    metadata?.slotRecords?.length
      ? metadata.slotRecords
      : (parser?.info?.metadata?.slotRecords ?? []);

  const existingPlayers = playersToArray(parsed?.players);

  const existingBySlot = new Map<number, any>();
  const existingByPlayerId = new Map<number, any>();

  for (let idx = 0; idx < existingPlayers.length; idx++) {
    const row = existingPlayers[idx];
    const slot = toFiniteNumber(row?.slot) ?? idx;

    if (!existingBySlot.has(slot)) existingBySlot.set(slot, row);

    for (const key of [row?.playerId, row?.id]) {
      const n = toFiniteNumber(key);
      if (n != null && n > 0 && !existingByPlayerId.has(n)) {
        existingByPlayerId.set(n, row);
      }
    }
  }

  if (!Array.isArray(slots) || !slots.length) {
    let orderedNameIndex = 0;

    return existingPlayers.map((row: any, idx: number) => {
      const playerId =
        toFiniteNumber(row?.playerId) ??
        toFiniteNumber(row?.id) ??
        toFiniteNumber(row?.pid);

      const repairedName = playerId != null ? nameByPlayerId.get(playerId) : undefined;
      const currentName = cleanPlayerName(row?.name);
      const fallbackName =
        !currentName &&
        !repairedName &&
        orderedNameIndex < orderedMetadataNames.length
          ? orderedMetadataNames[orderedNameIndex++]
          : undefined;

      const teamid = toFiniteNumber(row?.teamid) ?? toFiniteNumber(row?.teamId);
      const isComputer =
        typeof row?.isComputer === "boolean"
          ? row.isComputer
          : /^computer(\b|\s|\()?/i.test(String(row?.name ?? "").trim());

      const isObserver =
        typeof teamid === "number"
          ? isObserverTeamId(teamid, versionLike)
          : !!row?.isObserver;

      return {
        ...row,
        id: playerId ?? toFiniteNumber(row?.id) ?? idx,
        playerId: playerId ?? toFiniteNumber(row?.id) ?? idx,
        pid: idx,
        slot: toFiniteNumber(row?.slot) ?? idx,
        teamid,
        name: currentName ?? repairedName ?? fallbackName ?? `player ${playerId ?? idx}`,
        isObserver,
        isComputer,
      };
    });
  }

  const usedMetadataNames = new Set<string>();

  const nextUnusedMetadataName = () => {
    for (const candidate of orderedMetadataNames) {
      if (!usedMetadataNames.has(candidate)) {
        usedMetadataNames.add(candidate);
        return candidate;
      }
    }
    return undefined;
  };

  const compatibleSlotRow = (row: any, slotIndex: number, slotPlayerId: number | undefined) => {
    if (!row || typeof row !== "object") return undefined;

    const rowSlot = toFiniteNumber(row?.slot);
    const rowPlayerId = toFiniteNumber(row?.playerId) ?? toFiniteNumber(row?.id);
    const rowIsComputer =
      typeof row?.isComputer === "boolean"
        ? row.isComputer
        : /^computer(\b|\s|\()?/i.test(String(row?.name ?? "").trim());

    if (rowIsComputer) return undefined;

    if (slotPlayerId != null && slotPlayerId > 0 && rowPlayerId != null && rowPlayerId === slotPlayerId) {
      return row;
    }

    if (rowSlot != null && rowSlot === slotIndex) {
      return row;
    }

    return undefined;
  };

  const players: any[] = [];

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const slot = slots[slotIndex] as any;

    const slotStatus = toFiniteNumber(slot?.slotStatus) ?? 0;
    if (slotStatus <= 1) continue;

    const slotPlayerId = toFiniteNumber(slot?.playerId);
    const teamid = toFiniteNumber(slot?.teamId);
    const colorIndex = toFiniteNumber(slot?.color);
    const computerFlag = toFiniteNumber(slot?.computerFlag) ?? 0;

    const isComputer = computerFlag > 0;
    if (isComputer) continue;

    const byPlayerId =
      slotPlayerId != null && slotPlayerId > 0
        ? existingByPlayerId.get(slotPlayerId)
        : undefined;

    const bySlot = compatibleSlotRow(existingBySlot.get(slotIndex), slotIndex, slotPlayerId);
    const existing = byPlayerId ?? bySlot;

    const isObserver =
      typeof teamid === "number"
        ? isObserverTeamId(teamid, versionLike)
        : !!existing?.isObserver;

    const metadataName =
      slotPlayerId != null && slotPlayerId > 0
        ? nameByPlayerId.get(slotPlayerId)
        : undefined;

    const parserName = !isObserver ? cleanPlayerName(existing?.name) : undefined;

    if (metadataName) usedMetadataNames.add(metadataName);

    const slotFallbackName =
      !metadataName && !parserName && !isObserver
        ? nextUnusedMetadataName()
        : undefined;

    const name =
      metadataName ??
      parserName ??
      slotFallbackName ??
      `player ${slotPlayerId ?? slotIndex}`;

    const compactIndex = players.length;

    players.push({
      ...(existing && typeof existing === "object" ? existing : {}),
      id: slotPlayerId ?? toFiniteNumber(existing?.id) ?? compactIndex,
      playerId:
        slotPlayerId ??
        toFiniteNumber(existing?.playerId) ??
        toFiniteNumber(existing?.id) ??
        compactIndex,
      pid: compactIndex,
      slot: slotIndex,
      name,
      teamid,
      color:
        typeof existing?.color === "string" && existing.color
          ? existing.color
          : (colorIndex != null ? WC3_PLAYER_COLORS[colorIndex] : undefined),
      apm: toFiniteNumber(existing?.apm) ?? 0,
      isObserver,
      isComputer: false,
    });
  }

  return players;
}

function normalizeChat(chat: any[], players: any[]): any[] {
  const nameByPid = new Map<number, string>();
  const nameByPlayerId = new Map<number, string>();
  for (const row of players) {
    const name = cleanPlayerName(row?.name);
    const pid = toFiniteNumber(row?.pid) ?? toFiniteNumber(row?.slot);
    const playerId = toFiniteNumber(row?.playerId) ?? toFiniteNumber(row?.id);
    if (pid != null && name) nameByPid.set(pid, name);
    if (playerId != null && name) nameByPlayerId.set(playerId, name);
  }

  return (Array.isArray(chat) ? chat : []).map((row: any) => {
    const rawPlayerId = toFiniteNumber(row?.playerId);
    const existingName = cleanPlayerName(row?.playerName);
    const repaired = rawPlayerId != null ? (nameByPlayerId.get(rawPlayerId) ?? nameByPid.get(rawPlayerId)) : undefined;
    return {
      ...row,
      playerName: existingName ?? repaired ?? row?.playerName,
    };
  });
}

function enrichParsedReplay(parsed: any, parser: any, metadata: ReplayMetadata | undefined, versionLike: unknown): any {
  if (!parsed || typeof parsed !== "object") return parsed;

  const canonicalPlayers = buildCanonicalPlayers(parsed, parser, metadata, versionLike);
  if (canonicalPlayers.length) parsed.players = canonicalPlayers;
  if (Array.isArray(parsed.chat)) parsed.chat = normalizeChat(parsed.chat, canonicalPlayers);
  if ((!parsed.gamename || typeof parsed.gamename !== "string") && metadata?.gameName) parsed.gamename = metadata.gameName;
  return parsed;
}

function buildPartialReplayFromParser(parser: any, metadata: ReplayMetadata | undefined): any {
  const meta = parser?.meta ?? {};
  const subheader = parser?.info?.subheader ?? {};
  return {
    id: parser?.id ?? "",
    gamename: meta?.gameName ?? metadata?.gameName,
    randomseed: meta?.randomSeed,
    startSpots: meta?.startSpotCount,
    observers: Array.isArray(parser?.observers) ? parser.observers : [],
    players: playersToArray(parser?.players),
    matchup: parser?.matchup ?? "",
    creator: meta?.map?.creator,
    type: parser?.gametype ?? "",
    chat: Array.isArray(parser?.chatlog) ? parser.chatlog : [],
    apm: { trackingInterval: parser?.playerActionTrackInterval },
    map: {
      path: meta?.map?.mapName,
      file: meta?.map?.mapName,
      checksum: meta?.map?.mapChecksum,
      checksumSha1: meta?.map?.mapChecksumSha1,
    },
    version: subheader?.version != null ? String(subheader.version) : undefined,
    buildNumber: subheader?.buildNo,
    duration: subheader?.replayLengthMS ?? parser?.totalTimeTracker,
    settings: { speed: meta?.map?.speed },
    winningTeamId: typeof parser?.winningTeamId === "number" ? parser.winningTeamId : -1,
  };
}

export async function parseReplayRaw(buf: Buffer): Promise<ParseReplayResult> {
  const Ctor = getW3GReplayCtor();
  if (typeof Ctor !== "function") {
    throw new Error("w3gjs export is not a constructor (expected default or W3GReplay)");
  }

  patchW3GReplayCtor(Ctor);
  const parser = new Ctor();

  let metadataFromStream: ReplayMetadata | undefined;
  try {
    const stream = decompressReplayStream(buf);
    metadataFromStream = parseReplayMetadataFromStream(stream);
  } catch {
    metadataFromStream = undefined;
  }

  try {
    const parsed: any = await parser.parse(buf);
    const versionLike = parsed?.version ?? parser?.info?.subheader?.version;
    enrichParsedReplay(parsed, parser, metadataFromStream, versionLike);
    return { raw: JSON.parse(JSON.stringify(parsed)), partial: false };
  } catch (e: any) {
    const partial = buildPartialReplayFromParser(parser, metadataFromStream);
    const versionLike = partial?.version ?? parser?.info?.subheader?.version;
    enrichParsedReplay(partial, parser, metadataFromStream, versionLike);
    partial.warnings = [String(e?.message ?? e)];
    return { raw: JSON.parse(JSON.stringify(partial)), partial: true, error: String(e?.message ?? e) };
  }
}
