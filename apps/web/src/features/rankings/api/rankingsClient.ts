import type { ParsedReplay, RankingsLogEntry, RankingsState } from "../../../lib/types";

export async function getRankingsState(): Promise<{ state: RankingsState; log: RankingsLogEntry[] }> {
  const res = await fetch("/api/rankings/state");
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load rankings state");
  return { state: data.state, log: data.log ?? [] };
}

function toReplaySummaryPayload(replay: ParsedReplay) {
  return {
    fileName: replay.fileName,
    fileSize: replay.fileSize,
    meta: replay.meta,
    players: replay.players ?? [],
    chat: replay.chat,
    mmd: replay.mmd,
    warnings: replay.warnings ?? [],
  };
}

export async function ingestParsedReplay(parsed: ParsedReplay): Promise<{ state: RankingsState; logEntry?: RankingsLogEntry; ok: boolean; error?: string }> {
  const res = await fetch("/api/rankings/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary: toReplaySummaryPayload(parsed) }),
  });
  return await res.json();
}

export async function postRankingsAction(endpoint: "/api/rankings/undoLastIngest" | "/api/rankings/startNewSeason" | "/api/rankings/resetAll") {
  const res = await fetch(endpoint, { method: "POST" });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? `Request failed: ${endpoint}`);
  return data as { state: RankingsState; logEntry?: RankingsLogEntry };
}

export async function exportRankingsJson() {
  const res = await fetch("/api/rankings/exportJson");
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to export rankings backup");
  return data.payload;
}

export async function importRankingsJson(payload: unknown) {
  const res = await fetch("/api/rankings/importJson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to import rankings backup");
  return data as { state: RankingsState; logEntry?: RankingsLogEntry };
}
