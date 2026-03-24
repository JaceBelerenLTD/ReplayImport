// replay-inspector/mapping/mapReplayApiToView.ts
//
// Raw -> UI mapping (meta, players, chat).
//
// NOTE:
// WC3 replays and W3MMD flags key players by PID (usually 0..N in slot order).
// We assign a stable `pid` based on the raw player list index (or backend id if present)
// before any UI filtering/sorting.

import type { ChatMessage, ReplayMeta, ReplayPlayer } from "../../../lib/types";

type RawReplayPlayer = {
  id?: number;
  // Some backends expose an explicit WC3 player id / pid / slot.
  pid?: number;
  playerId?: number;
  slot?: number;
  name?: string;
  teamid?: number;
  color?: string;
  apm?: number;
  isObserver?: boolean;
};

type RawReplayChat = {
  playerId?: number;
  playerName?: string;
  message?: string;
  mode?: string | number;
  timeMS?: number;
  time?: number;
};

export type RawReplay = {
  gamename?: string;
  duration?: number;
  version?: string;
  buildNumber?: number;
  map?: { path?: string; file?: string; checksum?: string; checksumSha1?: string };
  settings?: { speed?: number };
  winningTeamId?: number;
  players?: RawReplayPlayer[];
  chat?: RawReplayChat[];
  [k: string]: unknown;
};

function toNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeTimeMs(v: unknown): number | undefined {
  const n = toNumber(v);
  if (n == null) return undefined;

  // Sometimes raw time can be seconds. Keep heuristic.
  if (n > 24 * 60 * 60) return Math.round(n);
  return Math.round(n * 1000);
}

function normalizeScope(mode: unknown, pidTeam?: number): ChatMessage["scope"] {
  if (mode == null) return undefined;

  // Numeric modes (best-effort): 0=all, 1=team/allies, 2=observers
  if (mode === 0 || mode === "0") return "all";
  if (mode === 2 || mode === "2") return "observers";

  const m = String(mode).toLowerCase();
  if (m === "all") return "all";

  // Explicit sides
  if (m === "team" || m === "allies") {
    if (pidTeam === 0) return "west";
    if (pidTeam === 1) return "east";
    return "allies";
  }

  return String(mode);
}

function dedupeChatImmediate(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let prev: ChatMessage | undefined;

  for (const msg of messages) {
    if (
      prev &&
      msg.pid === prev.pid &&
      msg.scope === prev.scope &&
      msg.timeMs === prev.timeMs &&
      msg.text === prev.text
    ) {
      continue;
    }
    out.push(msg);
    prev = msg;
  }
  return out;
}

export function mapReplayApiToView(
  file: File,
  raw: RawReplay,
): {
  meta: ReplayMeta;
  players: ReplayPlayer[];
  chat?: ChatMessage[];
  nameByPid: Map<number, string>;
  teamByPid: Map<number, number>;
  /** Lookup by compact W3MMD pid (0..N-1 over human participants). */
  nameByMmdPid: Map<number, string>;
  teamByMmdPid: Map<number, number>;
  warnings?: string[];
} {
  const warnings: string[] = [];

  const meta: ReplayMeta = {
    gameName: raw.gamename ?? undefined,
    map: raw.map?.file ?? raw.map?.path ?? undefined,
    durationSec: typeof raw.duration === "number" ? raw.duration / 1000 : undefined,
    gameSpeed: raw.settings?.speed ?? undefined,
    majorVersion: raw.version ? Number.parseFloat(raw.version) : undefined,
    buildVersion: raw.buildNumber ?? undefined,
  };

  const winningTeamId = typeof raw.winningTeamId === "number" ? raw.winningTeamId : undefined;

  const playersRaw = Array.isArray(raw.players) ? raw.players : [];

  // Determine the best value to treat as the WC3 PID.
  // Many backends overload `id` as a database id; however some do provide the true PID.
  // We prefer an explicit pid/playerId/slot when it looks like a contiguous 0..N-1 (or 1..N) sequence.
  const candidatePidLists: Array<{ label: string; values: Array<number | undefined> }> = [
    { label: "pid", values: playersRaw.map((p) => (typeof p.pid === "number" ? p.pid : undefined)) },
    {
      label: "playerId",
      values: playersRaw.map((p) => (typeof p.playerId === "number" ? p.playerId : undefined)),
    },
    { label: "slot", values: playersRaw.map((p) => (typeof p.slot === "number" ? p.slot : undefined)) },
    { label: "id", values: playersRaw.map((p) => (typeof p.id === "number" ? p.id : undefined)) },
  ];

  function detectPidStrategy(values: Array<number | undefined>):
    | { mode: "direct"; map: (idx: number) => number; backendIdIsPid: boolean }
    | { mode: "minus1"; map: (idx: number) => number; backendIdIsPid: boolean }
    | null {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!nums.length) return null;

    const unique = new Set(nums);
    // Must cover all players to avoid shifting.
    if (unique.size !== playersRaw.length) return null;

    const min = Math.min(...nums);
    const max = Math.max(...nums);

    // 0..N-1
    if (min === 0 && max === playersRaw.length - 1) {
      return { mode: "direct", map: (idx) => (values[idx] as number), backendIdIsPid: true };
    }

    // 1..N
    if (min === 1 && max === playersRaw.length) {
      return { mode: "minus1", map: (idx) => (values[idx] as number) - 1, backendIdIsPid: true };
    }

    return null;
  }

  let pidMap: (rawIdx: number) => number = (rawIdx) => rawIdx;
  // If we can reliably infer a true PID field, use it.
  for (const c of candidatePidLists) {
    const strat = detectPidStrategy(c.values);
    if (strat) {
      pidMap = strat.map;
      break;
    }
  }

  // Preserve raw ordering so PID aligns with chat + W3MMD flags.
  const players: ReplayPlayer[] = playersRaw.map((p, rawIdx): ReplayPlayer => {
    // Compute stable PID.
    const pid = pidMap(rawIdx);
    const backendId = typeof p.id === "number" ? p.id : undefined;
    const rawName = typeof p?.name === "string" ? p.name : "";
    const name = rawName.trim() ? rawName : `pid ${pid}`;

    // Some backends include AI slots as "Computer". We treat them as non-participants.
    const isComputer = /^computer(\b|\s|\()?/i.test(name.trim());

    const team = typeof p.teamid === "number" ? p.teamid : undefined;

    return {
      pid,
      // Preserve backend id separately; it is not used for PID-based lookups.
      id: backendId,
      slot: typeof p.slot === "number" ? p.slot : rawIdx,
      name,
      team,
      colorHex: typeof p.color === "string" ? p.color : undefined,
      apm: typeof p.apm === "number" ? p.apm : undefined,
      isObserver: !!p.isObserver,
      isComputer,
      isWinner: winningTeamId != null && team != null ? team === winningTeamId : undefined,
    };
  });

  // W3MMD "pid" is usually a compact 0..N-1 index over participating human players.
  // Many games include extra slots (AI/computer/observer/empty) in `raw.players`,
  // which would shift a naive index-based mapping. To keep MMD flags usable, we
  // assign `mmdPid` by walking the *raw* player list order and counting only
  // non-computer, non-observer players.
  let nextMmdPid = 0;
  for (const p of players) {
    if (p.isComputer || p.isObserver) continue;
    p.mmdPid = nextMmdPid++;
  }

  // Build lookup maps between backend ids / names and stable PIDs.
  // Some backends emit chat `playerId` as a backend id (not the WC3 PID/slot index).
  const pidByBackendId = new Map<number, number>();
  const pidByName = new Map<string, number>();
  for (const p of players) {
    if (typeof p.id === "number") pidByBackendId.set(p.id, p.pid);
    // Use lowercased name for matching; ignore placeholder names like "pid 0".
    const key = (p.name ?? "").trim().toLowerCase();
    if (key && !key.startsWith("pid ")) pidByName.set(key, p.pid);
  }

  // PID -> player lookup (do NOT use array index; pid may not equal raw index).
  const playerByPid = new Map<number, ReplayPlayer>();
  for (const p of players) playerByPid.set(p.pid, p);

    const nameByPid = new Map<number, string>();
  const teamByPid = new Map<number, number>();
  const nameByMmdPid = new Map<number, string>();
  const teamByMmdPid = new Map<number, number>();
  for (const p of players) {
    // Always key by stable PID.
    nameByPid.set(p.pid, p.name);
    if (typeof p.team === "number") teamByPid.set(p.pid, p.team);

    // Also key by W3MMD pid when available.
    if (typeof p.mmdPid === "number") {
      nameByMmdPid.set(p.mmdPid, p.name);
      if (typeof p.team === "number") teamByMmdPid.set(p.mmdPid, p.team);
    }
  }

  const chatRaw = Array.isArray(raw.chat) ? raw.chat : [];
  const chatMapped: ChatMessage[] = chatRaw
    .map((m): ChatMessage | null => {
      const text = typeof m.message === "string" ? m.message : String(m.message ?? "");
      if (!text) return null;

      // Normalize chat sender to stable WC3 PID.
      // Preferred: slot index (0..N-1).
      // Fallback: backend id -> pid mapping.
      // Fallback: playerName -> pid mapping.
      const rawPlayerId = typeof m.playerId === "number" ? m.playerId : undefined;
      let pid: number | undefined;
      if (rawPlayerId != null && rawPlayerId >= 0 && rawPlayerId < players.length) {
        pid = rawPlayerId;
      } else if (rawPlayerId != null) {
        pid = pidByBackendId.get(rawPlayerId);
      }
      if (typeof m.playerName === "string") {
        const byName = pidByName.get(m.playerName.trim().toLowerCase());
        if (pid == null) {
          pid = byName;
        } else if (byName != null) {
          const resolved = playerByPid.get(pid);
          const resolvedName = (resolved?.name ?? "").trim().toLowerCase();
          const wantedName = m.playerName.trim().toLowerCase();
          const byNamePlayer = playerByPid.get(byName);
          if (
            (resolved?.isComputer && byNamePlayer && !byNamePlayer.isComputer) ||
            (!!wantedName && !!resolvedName && resolvedName !== wantedName && !resolvedName.startsWith("pid "))
          ) {
            pid = byName;
          }
        }
      }

      const timeMs =
        typeof m.timeMS === "number"
          ? Math.round(m.timeMS)
          : normalizeTimeMs((m as any).time ?? (m as any).timeMs);

      return {
        text,
        pid,
        from:
          pid != null
            ? nameByPid.get(pid) ?? (typeof m.playerName === "string" ? m.playerName : undefined)
            : typeof m.playerName === "string"
              ? m.playerName
              : undefined,
        scope: normalizeScope(m.mode, pid != null ? teamByPid.get(pid) : undefined),
        timeMs,
      };
    })
    .filter((x): x is ChatMessage => !!x);

  const chat = dedupeChatImmediate(chatMapped);

  return {
    meta,
    players,
    chat: chat.length ? chat : undefined,
    nameByPid,
    teamByPid,
    nameByMmdPid,
    teamByMmdPid,
    warnings: warnings.length ? warnings : undefined,
  };
}
