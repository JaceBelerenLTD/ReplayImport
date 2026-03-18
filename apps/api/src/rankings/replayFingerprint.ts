import type { ReplaySummary } from "./types.js";

const normName = (s: string) => (s ?? "").trim().replace(/\s+/g, " ");

export function fingerprintReplay(summary: ReplaySummary): string {
  const map = summary.meta?.map ?? "";
  const duration = summary.meta?.durationSec ?? "";
  const playedOn = summary.meta?.playedOnUnix ?? "";

  const players = (summary.players ?? [])
    .filter((player) => !player.isObserver && !player.isComputer)
    .map((player) => `${normName(player.name).toLowerCase()}@${player.team ?? "?"}`)
    .sort()
    .join("|");

  return [map, duration, playedOn, players].join("::");
}
