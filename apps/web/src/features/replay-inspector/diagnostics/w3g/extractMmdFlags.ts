// replay-inspector/diagnostics/w3g/extractMmdFlags.ts
//
// Scan decompressed replay stream for W3MMD payloads.
// We look for "kMMD.Dat\0val:" entries and parse payload lines like:
//   "init pid <pid> <player name>"
//   "FlagP <pid> winner"
//   "VarP <pid> income = 92"
//   "Event Spell War\\ Stomp 1"

import type { MmdData, MmdEvent } from "../../../../lib/types";

export type ManualW3MMD = MmdData & {
  definitionOrder?: string[];
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

function parseScalarValue(raw: string): number | string {
  const trimmed = raw.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return trimmed;
}

function decodeMmdToken(raw: string): string {
  return raw.replace(/\\ /g, " ").trim();
}

function parseEventArgs(parts: string[]): Array<string | number> {
  return parts.map((part) => parseScalarValue(decodeMmdToken(part)));
}

export function extractMmdFlagsFromStream(stream: Uint8Array): ManualW3MMD | null {
  const needle = new TextEncoder().encode("kMMD.Dat\0val:");
  const pidToName: Record<number, string> = {};
  const flagsByPid: Record<number, string> = {};
  const varsByPid: Record<number, Record<string, number | string>> = {};
  const events: MmdEvent[] = [];
  const definitionOrder: string[] = [];
  const seenDefinitions = new Set<string>();

  let idx = 0;
  while (idx >= 0 && idx < stream.length) {
    const found = findNeedle(stream, needle, idx);
    if (found === -1) break;

    const valNumStart = found + needle.length;
    const valNum = readNullTerminatedUtf8(stream, valNumStart);
    if (!valNum) break;

    const payload = readNullTerminatedUtf8(stream, valNum.next);
    if (!payload) break;

    const line = payload.text.trim();

    if (line.startsWith("init pid ")) {
      const match = /^init\s+pid\s+(\d+)\s+(.+)$/.exec(line);
      if (match) {
        const pid = Number(match[1]);
        const name = match[2]?.trim();
        if (Number.isFinite(pid) && name) pidToName[pid] = name;
      }
    } else if (line.startsWith("FlagP ")) {
      const match = /^FlagP\s+(\d+)\s+(.+)$/.exec(line);
      if (match) {
        const pid = Number(match[1]);
        const flag = match[2]?.trim();
        if (Number.isFinite(pid) && flag) flagsByPid[pid] = flag;
      }
    } else if (line.startsWith("DefVarP ")) {
      const match = /^DefVarP\s+(.+?)\s+(?:int|real|string)\b/.exec(line);
      const name = match?.[1]?.trim();
      if (name && !seenDefinitions.has(name)) {
        seenDefinitions.add(name);
        definitionOrder.push(name);
      }
    } else if (line.startsWith("VarP ")) {
      const match = /^VarP\s+(\d+)\s+(.+?)\s*=\s*(.+)$/.exec(line);
      if (match) {
        const pid = Number(match[1]);
        const key = match[2]?.trim();
        const valueRaw = match[3] ?? "";
        if (Number.isFinite(pid) && key) {
          varsByPid[pid] ??= {};
          varsByPid[pid]![key] = parseScalarValue(valueRaw);
          if (!seenDefinitions.has(key)) {
            seenDefinitions.add(key);
            definitionOrder.push(key);
          }
        }
      }
    } else if (line.startsWith("Event ")) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const [, name, ...rest] = parts;
        events.push({
          name: decodeMmdToken(name ?? "Event"),
          message: line,
          args: parseEventArgs(rest),
        });
      }
    }

    idx = payload.next;
  }

  if (!Object.keys(pidToName).length && !Object.keys(flagsByPid).length && !Object.keys(varsByPid).length && !events.length) {
    return null;
  }

  return {
    pidToName: Object.keys(pidToName).length ? pidToName : undefined,
    flagsByPid: Object.keys(flagsByPid).length ? flagsByPid : undefined,
    varsByPid: Object.keys(varsByPid).length ? varsByPid : undefined,
    events: events.length ? events : undefined,
    definitionOrder: definitionOrder.length ? definitionOrder : undefined,
  };
}