// replay-inspector/diagnostics/deriveWinner.ts
//
// Winner derivation from W3MMD flags.
// For many custom maps, MMD.Dat contains lines like:
//   FlagP <pid> winner
// The pid corresponds to the WC3 player id (PID) used in chat and many replay events.

import type { ReplayPlayer } from "../../../lib/types";

export function deriveWinnerTeamIdFromFlags(
  flagsByPid: Record<number, string>,
  teamByPid: Map<number, number>,
): number | null {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

  const winnerPids = Object.entries(flagsByPid)
    .filter(([, flag]) => norm(flag) === "winner")
    .map(([pid]) => Number(pid))
    .filter((pid) => Number.isFinite(pid));

  if (!winnerPids.length) return null;

  const teams = winnerPids
    .map((pid) => teamByPid.get(pid))
    .filter((t): t is number => typeof t === "number");

  const uniq = Array.from(new Set(teams));
  return uniq.length === 1 ? uniq[0] : null;
}

export function applyWinnerToPlayers(players: ReplayPlayer[], winnerTeamId: number): void {
  for (const p of players) {
    if (p.isComputer || p.isObserver) continue;
    if (typeof p.team === "number") {
      p.isWinner = p.team === winnerTeamId;
    }
  }
}

/**
 * Apply per-player winner flags directly (more reliable for many custom maps).
 * Excludes observers and computer slots.
 */
export function applyWinnerFlagsToPlayers(players: ReplayPlayer[], flagsByPid: Record<number, string>): void {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

  // Collect a normalized result map.
  const resultByPid = new Map<number, string>();
  for (const [pidStr, flag] of Object.entries(flagsByPid)) {
    const pid = Number(pidStr);
    if (!Number.isFinite(pid)) continue;
    resultByPid.set(pid, norm(flag));
  }

  if (!resultByPid.size) return;

  for (const p of players) {
    if (p.isComputer || p.isObserver) continue;

    // Prefer compact W3MMD pid (0..N-1) when we have it; otherwise fall back to backend pid.
    const key = typeof p.mmdPid === "number" ? p.mmdPid : p.pid;
    const res = resultByPid.get(key);
    if (!res) continue;

    p.result = res;
    p.isWinner = res === "winner";
  }
}
