export type ReplaySummary = {
  replayId?: string;
  fileName: string;
  fileSize: number;
  meta?: {
    map?: string | null;
    durationSec?: number | null;
    playedOnUnix?: number | null;
    gameName?: string | null;
    gameSpeed?: number | null;
    majorVersion?: number | null;
    buildVersion?: number | null;
  } | null;
  players: Array<{
    name: string;
    team?: number;
    isWinner?: boolean;
    isObserver?: boolean;
    isComputer?: boolean;
  }>;
  warnings?: string[];
};

export type PlayerId = string;
export type MatchOutcome = "A" | "B" | "D";

export type StoredPlayer = {
  id: PlayerId;
  name: string;
  rating: number;
  wins: number;
  losses: number;
};

export type StoredMatch = {
  id: string;
  ts: number;
  fileName?: string;
  map?: string;
  durationSec?: number;
  replayId?: string;
  teamA: PlayerId[];
  teamB: PlayerId[];
  result: MatchOutcome;
  delta: number;
  replay?: ReplaySummary;
};

export type StoredState = {
  version: 3;
  players: StoredPlayer[];
  matches: StoredMatch[];
};

export type IngestLogEntry = {
  id: string;
  ts: number;
  status: "ok" | "failed";
  message: string;
  fileName?: string;
  map?: string;
  durationSec?: number;
  result?: MatchOutcome;
};
