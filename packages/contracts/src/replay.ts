export type ReplayMeta = {
  gameName?: string | null;
  map?: string | null;
  durationSec?: number | null;
  gameSpeed?: number | null;
  majorVersion?: number | null;
  buildVersion?: number | null;
  playedOnUnix?: number | null;
};

export type ReplayPlayer = {
  pid: number;
  id?: number;
  name: string;
  team?: number;
  slot?: number;
  mmdPid?: number;
  colorName?: string;
  colorHex?: string;
  apm?: number;
  isWinner?: boolean;
  result?: string;
  isObserver?: boolean;
  isComputer?: boolean;
  leftAtSec?: number;
  stayPercent?: number;
};

export type ChatMessage = {
  timeMs?: number;
  pid?: number;
  from?: string;
  text: string;
  scope?: "all" | "allies" | "observers" | string;
};

export type MmdEvent = {
  timeSec?: number;
  name?: string;
  message?: string;
  args?: Array<string | number>;
};

export type MmdData = {
  pidToName?: Record<number, string>;
  flagsByPid?: Record<number, string>;
  varsByPid?: Record<number, Record<string, number | string>>;
  events?: MmdEvent[];
};

export type ParsedReplay = {
  fileName: string;
  fileSize: number;
  meta?: ReplayMeta;
  players: ReplayPlayer[];
  chat?: ChatMessage[];
  mmd?: MmdData;
  raw?: unknown;
  diagnostics?: unknown;
  warnings: string[];
};
