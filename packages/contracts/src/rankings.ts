import type { ParsedReplay } from "./replay";

export type RankingsState = {
  version: number;
  players: Array<{ id: string; name: string; rating: number; wins: number; losses: number }>;
  matches: Array<{
    id: string;
    ts: number;
    fileName?: string;
    map?: string;
    durationSec?: number;
    result: "A" | "B" | "D";
    delta: number;
    teamA: string[];
    teamB: string[];
    replay?: ParsedReplay;
  }>;
};

export type RankingsLogEntry = {
  id: string;
  ts: number;
  status: "ok" | "failed";
  message: string;
  fileName?: string;
  map?: string;
  durationSec?: number;
  result?: "A" | "B" | "D";
};
