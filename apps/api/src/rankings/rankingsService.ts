import crypto from "crypto";
import { dbPromise } from "../infra/sqlite.js";
import { computeReplayOutcome } from "./computeReplayOutcome.js";
import { fingerprintReplay } from "./replayFingerprint.js";
import type { IngestLogEntry, PlayerId, ReplaySummary, StoredMatch, StoredPlayer, StoredState } from "./types.js";

const nowTs = () => Date.now();
const uid = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString("hex")}_${Date.now().toString(16)}`;
const normName = (s: string) => (s ?? "").trim().replace(/\s+/g, " ");
const makePlayerId = (name: string) => `p_${normName(name).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

function rebuildFromMatches(matchesNewestFirst: StoredMatch[]): StoredState {
  const ordered = [...matchesNewestFirst].slice().reverse();
  const players = new Map<PlayerId, StoredPlayer>();

  const ensure = (id: PlayerId, fallbackName?: string) => {
    const existing = players.get(id);
    if (existing) return existing;
    const player: StoredPlayer = { id, name: fallbackName ?? id, rating: 1000, wins: 0, losses: 0 };
    players.set(id, player);
    return player;
  };

  for (const match of ordered) {
    for (const id of match.teamA) ensure(id);
    for (const id of match.teamB) ensure(id);

    if (match.result === "D") continue;

    for (const id of match.teamA) {
      const player = ensure(id);
      if (match.result === "A") {
        player.rating += match.delta;
        player.wins += 1;
      } else {
        player.rating -= match.delta;
        player.losses += 1;
      }
    }

    for (const id of match.teamB) {
      const player = ensure(id);
      if (match.result === "B") {
        player.rating += match.delta;
        player.wins += 1;
      } else {
        player.rating -= match.delta;
        player.losses += 1;
      }
    }
  }

  return { version: 3, players: [...players.values()], matches: matchesNewestFirst };
}

export async function loadState(): Promise<{ state: StoredState; log: IngestLogEntry[] }> {
  const db = await dbPromise;

  const matchRows = (await db.all(
    `SELECT id, ts, file_name, map, duration_sec, replay_id, result, delta, replay_json
     FROM rankings_match
     ORDER BY ts DESC
     LIMIT 2000`
  )) as any[];

  const playerRows = (await db.all(`SELECT id, name FROM rankings_player`)) as any[];
  const playerNameById = new Map<string, string>(playerRows.map((row) => [row.id, row.name]));

  const matchPlayerRows = (await db.all(
    `SELECT match_id, player_id, team
     FROM rankings_match_player`
  )) as any[];

  const byMatch = new Map<string, { A: string[]; B: string[] }>();
  for (const row of matchPlayerRows) {
    const existing = byMatch.get(row.match_id) ?? { A: [], B: [] };
    if (row.team === "A") existing.A.push(row.player_id);
    if (row.team === "B") existing.B.push(row.player_id);
    byMatch.set(row.match_id, existing);
  }

  const matches: StoredMatch[] = matchRows.map((row) => {
    const teams = byMatch.get(row.id) ?? { A: [], B: [] };
    return {
      id: row.id,
      ts: row.ts,
      fileName: row.file_name ?? undefined,
      map: row.map ?? undefined,
      durationSec: row.duration_sec ?? undefined,
      replayId: row.replay_id ?? undefined,
      teamA: teams.A,
      teamB: teams.B,
      result: row.result ?? "D",
      delta: typeof row.delta === "number" ? row.delta : 15,
      replay: row.replay_json ? (JSON.parse(row.replay_json) as ReplaySummary) : undefined,
    };
  });

  const rebuilt = rebuildFromMatches(matches);
  const players = rebuilt.players.map((player) => ({ ...player, name: playerNameById.get(player.id) ?? player.name }));
  const state: StoredState = { ...rebuilt, players };

  const logRows = (await db.all(
    `SELECT id, ts, status, message, file_name, map, duration_sec, result
     FROM rankings_ingest_log
     ORDER BY ts DESC
     LIMIT 200`
  )) as any[];

  const log: IngestLogEntry[] = logRows.map((row) => ({
    id: row.id,
    ts: row.ts,
    status: row.status,
    message: row.message,
    fileName: row.file_name ?? undefined,
    map: row.map ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    result: row.result ?? undefined,
  }));

  return { state, log };
}

export async function pushLog(entry: Omit<IngestLogEntry, "id" | "ts">): Promise<IngestLogEntry> {
  const db = await dbPromise;
  const full: IngestLogEntry = { id: uid("log"), ts: nowTs(), ...entry };
  await db.run(
    `INSERT INTO rankings_ingest_log(id, ts, status, message, file_name, map, duration_sec, result)
     VALUES(?,?,?,?,?,?,?,?)`,
    full.id,
    full.ts,
    full.status,
    full.message,
    full.fileName ?? null,
    full.map ?? null,
    full.durationSec ?? null,
    full.result ?? null
  );
  return full;
}

export async function ingestReplaySummary(summary: ReplaySummary) {
  const replayId = summary.replayId ?? crypto.createHash("sha256").update(fingerprintReplay(summary)).digest("hex");
  const { teamA, teamB, result } = computeReplayOutcome(summary);
  const db = await dbPromise;

  const exists = await db.get(`SELECT id FROM rankings_match WHERE replay_id = ?`, replayId);
  if (exists?.id) {
    const logEntry = await pushLog({
      status: "ok",
      message: "Duplicate replay ignored",
      fileName: summary.fileName,
      map: summary.meta?.map ?? undefined,
      durationSec: summary.meta?.durationSec ?? undefined,
      result,
    });

    const { state } = await loadState();
    return { ok: true as const, state, logEntry };
  }

  const delta = result === "D" ? 0 : 15;
  const matchId = uid("m");
  const teamAIds = teamA.map((name) => makePlayerId(name));
  const teamBIds = teamB.map((name) => makePlayerId(name));

  await db.exec("BEGIN");
  try {
    for (const name of [...teamA, ...teamB]) {
      const id = makePlayerId(name);
      await db.run(
        `INSERT INTO rankings_player(id, name) VALUES(?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
        id,
        normName(name)
      );
    }

    await db.run(
      `INSERT INTO rankings_match(id, ts, file_name, map, duration_sec, replay_id, result, delta, replay_json)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      matchId,
      nowTs(),
      summary.fileName ?? null,
      summary.meta?.map ?? null,
      summary.meta?.durationSec ?? null,
      replayId,
      result,
      delta,
      JSON.stringify({ ...summary, replayId })
    );

    for (const playerId of teamAIds) {
      await db.run(`INSERT INTO rankings_match_player(match_id, player_id, team) VALUES(?,?,?)`, matchId, playerId, "A");
    }
    for (const playerId of teamBIds) {
      await db.run(`INSERT INTO rankings_match_player(match_id, player_id, team) VALUES(?,?,?)`, matchId, playerId, "B");
    }

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  const logEntry = await pushLog({
    status: "ok",
    message: result === "D" ? "Draw (void)" : "Match ingested",
    fileName: summary.fileName,
    map: summary.meta?.map ?? undefined,
    durationSec: summary.meta?.durationSec ?? undefined,
    result,
  });

  const { state } = await loadState();
  return { ok: true as const, state, logEntry };
}

export async function undoLastIngest() {
  const db = await dbPromise;
  const last = await db.get(`SELECT id FROM rankings_match ORDER BY ts DESC LIMIT 1`);
  if (!last?.id) {
    const logEntry = await pushLog({ status: "ok", message: "Nothing to undo" });
    const { state } = await loadState();
    return { state, logEntry };
  }

  await db.exec("BEGIN");
  try {
    await db.run(`DELETE FROM rankings_match_player WHERE match_id = ?`, last.id);
    await db.run(`DELETE FROM rankings_match WHERE id = ?`, last.id);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  const logEntry = await pushLog({ status: "ok", message: "Undo last replay ingest" });
  const { state } = await loadState();
  return { state, logEntry };
}

export async function startNewSeason() {
  const db = await dbPromise;
  await db.exec("BEGIN");
  try {
    await db.run(`DELETE FROM rankings_match_player`);
    await db.run(`DELETE FROM rankings_match`);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  const logEntry = await pushLog({ status: "ok", message: "New season: kept players, cleared match history" });
  const { state } = await loadState();
  return { state, logEntry };
}

export async function resetAllRankings() {
  const db = await dbPromise;
  await db.exec("BEGIN");
  try {
    await db.run(`DELETE FROM rankings_match_player`);
    await db.run(`DELETE FROM rankings_match`);
    await db.run(`DELETE FROM rankings_player`);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  const logEntry = await pushLog({ status: "ok", message: "Reset all rankings data" });
  const { state } = await loadState();
  return { state, logEntry };
}

export async function exportRankingsBackup() {
  const db = await dbPromise;
  const players = await db.all(`SELECT * FROM rankings_player`);
  const matches = await db.all(`SELECT * FROM rankings_match`);
  const matchPlayers = await db.all(`SELECT * FROM rankings_match_player`);
  const ingestLog = await db.all(`SELECT * FROM rankings_ingest_log ORDER BY ts DESC LIMIT 500`);
  return { players, matches, matchPlayers, ingestLog };
}

export async function importRankingsBackup(payload: any) {
  const db = await dbPromise;
  await db.exec("BEGIN");
  try {
    await db.run(`DELETE FROM rankings_match_player`);
    await db.run(`DELETE FROM rankings_match`);
    await db.run(`DELETE FROM rankings_player`);
    await db.run(`DELETE FROM rankings_ingest_log`);

    for (const player of payload.players ?? []) {
      await db.run(
        `INSERT INTO rankings_player(id, name, created_at) VALUES(?,?,COALESCE(?,datetime('now')))`,
        player.id,
        player.name,
        player.created_at ?? null
      );
    }
    for (const match of payload.matches ?? []) {
      await db.run(
        `INSERT INTO rankings_match(id, ts, file_name, map, duration_sec, replay_id, result, delta, replay_json, created_at)
         VALUES(?,?,?,?,?,?,?,?,?,COALESCE(?,datetime('now')))`,
        match.id,
        match.ts,
        match.file_name ?? null,
        match.map ?? null,
        match.duration_sec ?? null,
        match.replay_id ?? null,
        match.result,
        match.delta ?? 15,
        match.replay_json ?? null,
        match.created_at ?? null
      );
    }
    for (const matchPlayer of payload.matchPlayers ?? []) {
      await db.run(
        `INSERT INTO rankings_match_player(match_id, player_id, team) VALUES(?,?,?)`,
        matchPlayer.match_id,
        matchPlayer.player_id,
        matchPlayer.team
      );
    }
    for (const logEntry of payload.ingestLog ?? []) {
      await db.run(
        `INSERT INTO rankings_ingest_log(id, ts, status, message, file_name, map, duration_sec, result)
         VALUES(?,?,?,?,?,?,?,?)`,
        logEntry.id,
        logEntry.ts,
        logEntry.status,
        logEntry.message,
        logEntry.file_name ?? null,
        logEntry.map ?? null,
        logEntry.duration_sec ?? null,
        logEntry.result ?? null
      );
    }

    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  const logEntry = await pushLog({ status: "ok", message: "Imported rankings backup" });
  const { state } = await loadState();
  return { state, logEntry };
}
