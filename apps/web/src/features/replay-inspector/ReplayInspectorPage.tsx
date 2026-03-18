import { useMemo, useState } from "react";
import { parseReplayFile } from "./application/parseReplayFile";
import type { ChatMessage, ParsedReplay, ReplayPlayer } from "../../lib/types";
import { ingestParsedReplay } from "../rankings/api/rankingsClient";
import { fmtDuration } from "../../app/format";

type Props = {
  onParsedReplay?: (parsed: ParsedReplay | null) => void;
  onRankingsChanged?: () => void;
};

type ParseErrorEntry = {
  fileName: string;
  message: string;
};

type ViewTab = "replay" | "debug";

const PANEL_HEIGHT = "calc(100vh - 140px)";

function fileSummaryLabel(parsed: ParsedReplay) {
  const map = parsed.meta?.map ?? "unknown map";
  const duration = fmtDuration(parsed.meta?.durationSec);
  return `${parsed.fileName} • ${map} • ${duration}`;
}

function formatChatTime(timeMs?: number) {
  if (timeMs == null || !Number.isFinite(timeMs)) return "";
  const total = Math.max(0, Math.round(timeMs / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function scopeLabel(scope?: string) {
  if (!scope) return "";
  if (scope === "all") return "ALL";
  if (scope === "west") return "WEST";
  if (scope === "east") return "EAST";
  if (scope === "allies") return "TEAM";
  if (scope === "observers") return "OBS";
  return String(scope).toUpperCase();
}

function playerSort(a: ReplayPlayer, b: ReplayPlayer) {
  const as = a.slot ?? 999;
  const bs = b.slot ?? 999;
  if (as !== bs) return as - bs;
  return a.name.localeCompare(b.name);
}

function PlayerPill({ p }: { p: ReplayPlayer }) {
  const color = p.colorHex ?? "#999";
  const result = String(p.result ?? "").toLowerCase();
  const winner = result === "winner" || p.isWinner === true;
  const loser = !!result && result !== "winner";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "18px 1fr auto",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: color,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
        }}
        aria-label={`player color ${color}`}
      />

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 650,
            letterSpacing: 0.2,
            color,
            textShadow: "0 1px 0 rgba(0,0,0,0.6)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={p.name}
        >
          {p.name}
          {p.isObserver ? <span style={{ color: "#ccc" }}> (obs)</span> : null}
          {winner ? <span style={{ color: "#d4ffb0" }}> ✓</span> : loser ? <span style={{ color: "#ffb0b0" }}> ✕</span> : null}
        </div>

        <div className="small muted" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {typeof p.apm === "number" ? <span>APM {p.apm}</span> : null}
          {typeof p.mmdPid === "number" ? <span>MMD pid {p.mmdPid}</span> : null}
        </div>
      </div>

      {typeof p.team === "number" ? (
        <div className="small muted" title="team">
          {p.team === 0 ? "WEST" : p.team === 1 ? "EAST" : `T${p.team}`}
        </div>
      ) : null}
    </div>
  );
}

function PlayersPanel({ players }: { players: ReplayPlayer[] }) {
  const visiblePlayers = useMemo(() => players.filter((p) => !p.isComputer), [players]);

  const winners = useMemo(
    () => visiblePlayers.filter((p) => !p.isObserver && (String(p.result ?? "").toLowerCase() === "winner" || p.isWinner === true)),
    [visiblePlayers],
  );

  const { west, east, observers, other } = useMemo(() => {
    const west: ReplayPlayer[] = [];
    const east: ReplayPlayer[] = [];
    const observers: ReplayPlayer[] = [];
    const other: ReplayPlayer[] = [];

    for (const p of visiblePlayers) {
      if (p.isObserver) observers.push(p);
      else if (p.team === 0) west.push(p);
      else if (p.team === 1) east.push(p);
      else other.push(p);
    }

    west.sort(playerSort);
    east.sort(playerSort);
    observers.sort(playerSort);
    other.sort(playerSort);

    return { west, east, observers, other };
  }, [visiblePlayers]);

  return (
    <div className="stack">
      <div>
        <h3>Players</h3>
        <div className="small muted">{visiblePlayers.length} visible players</div>
      </div>

      {winners.length ? (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            background: "rgba(180,255,160,0.08)",
            boxShadow: "0 0 0 1px rgba(180,255,160,0.18)",
          }}
        >
          <div className="text-sm" style={{ opacity: 0.95 }}>
            🏆 Winners: {winners.map((p) => p.name).join(", ")}
          </div>
        </div>
      ) : null}

      {visiblePlayers.length ? (
        <div className="stack">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, alignItems: "start" }}>
            <div className="stack">
              <div className="small" style={{ fontWeight: 700 }}>West</div>
              {west.length ? west.map((p) => <PlayerPill key={`${p.pid ?? p.id ?? p.name}`} p={p} />) : <span className="muted">None</span>}
            </div>

            <div className="stack">
              <div className="small" style={{ fontWeight: 700 }}>East</div>
              {east.length ? east.map((p) => <PlayerPill key={`${p.pid ?? p.id ?? p.name}`} p={p} />) : <span className="muted">None</span>}
            </div>
          </div>

          {other.length ? (
            <div className="stack">
              <div className="small" style={{ fontWeight: 700 }}>Players</div>
              {other.map((p) => <PlayerPill key={`${p.pid ?? p.id ?? p.name}`} p={p} />)}
            </div>
          ) : null}

          {observers.length ? (
            <div className="stack">
              <div className="small" style={{ fontWeight: 700 }}>Observers</div>
              {observers.map((p) => <PlayerPill key={`${p.pid ?? p.id ?? p.name}`} p={p} />)}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="muted">No players found.</span>
      )}
    </div>
  );
}

function ChatPanel({ chat, players }: { chat?: ChatMessage[]; players: ReplayPlayer[] }) {
  const playerStyleByPid = useMemo(() => {
    const m = new Map<number, { name: string; colorHex?: string }>();
    for (const p of players) {
      if (typeof p.pid === "number") {
        m.set(p.pid, { name: p.name, colorHex: p.colorHex });
      }
    }
    return m;
  }, [players]);

  return (
    <div className="stack">
      <div>
        <h3>Chat</h3>
        <div className="small muted">Showing the first 80 messages</div>
      </div>

      {chat?.length ? (
        <div className="stack">
          {chat.slice(0, 80).map((m, idx) => {
            const info = m.pid != null ? playerStyleByPid.get(m.pid) : undefined;
            const name = m.from ?? info?.name ?? (m.pid != null ? `pid ${m.pid}` : "unknown");
            const color = info?.colorHex;

            return (
              <div key={idx} className="small">
                <span className="muted">{formatChatTime(m.timeMs)}</span>
                {m.scope ? <span className="muted"> [{scopeLabel(m.scope)}]</span> : null}
                <span style={{ marginLeft: 6, marginRight: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: color ?? "rgba(255,255,255,0.25)",
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
                    }}
                  />
                  <span style={{ color: color ?? "rgba(255,255,255,0.7)", fontWeight: 650, textShadow: "0 1px 0 rgba(0,0,0,0.6)" }}>
                    {name}:
                  </span>
                </span>
                <span>{m.text}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <span className="muted">No chat found.</span>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={active ? "primary" : "secondary"}
      onClick={onClick}
      style={{ minWidth: 90 }}
    >
      {children}
    </button>
  );
}

export default function ReplayInspectorPage({ onParsedReplay, onRankingsChanged }: Props) {
  const [parsedReplays, setParsedReplays] = useState<ParsedReplay[]>([]);
  const [activeReplayIndex, setActiveReplayIndex] = useState<number>(-1);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<ParseErrorEntry[]>([]);
  const [autoIngest, setAutoIngest] = useState(true);
  const [ingestErrors, setIngestErrors] = useState<ParseErrorEntry[]>([]);
  const [viewTab, setViewTab] = useState<ViewTab>("replay");

  const parsed = useMemo(
    () => (activeReplayIndex >= 0 ? parsedReplays[activeReplayIndex] ?? null : null),
    [activeReplayIndex, parsedReplays],
  );

  async function handleFiles(files: File[]) {
    if (!files.length) return;

    setBusy(true);
    setBusyLabel(null);

    const nextParsed = [...parsedReplays];
    const nextParseErrors = [...parseErrors];
    const nextIngestErrors = [...ingestErrors];
    let nextActiveReplayIndex = activeReplayIndex;
    let changedRankings = false;

    try {
      for (const file of files) {
        try {
          setBusyLabel(`Parsing ${file.name}…`);
          const next = await parseReplayFile(file);

          nextParsed.push(next);
          nextActiveReplayIndex = nextParsed.length - 1;

          if (autoIngest) {
            setBusyLabel(`Ingesting ${file.name}…`);
            const data = await ingestParsedReplay(next);

            if (!data.ok) {
              nextIngestErrors.unshift({
                fileName: file.name,
                message: data.error ?? "Failed to ingest replay",
              });
            } else {
              changedRankings = true;
            }
          }
        } catch (e) {
          nextParseErrors.unshift({
            fileName: file.name,
            message: (e as Error).message,
          });
        }
      }
    } finally {
      setParsedReplays(nextParsed);
      setParseErrors(nextParseErrors.slice(0, 50));
      setIngestErrors(nextIngestErrors.slice(0, 50));
      setActiveReplayIndex(nextActiveReplayIndex);

      if (nextActiveReplayIndex >= 0 && nextParsed[nextActiveReplayIndex]) {
        onParsedReplay?.(nextParsed[nextActiveReplayIndex]!);
      }

      if (changedRankings) {
        onRankingsChanged?.();
      }

      setBusy(false);
      setBusyLabel(null);
      setViewTab("replay");
    }
  }

  function selectReplay(index: number) {
    setActiveReplayIndex(index);
    setViewTab("replay");
    const next = parsedReplays[index];
    if (next) onParsedReplay?.(next);
  }

  function clearAll() {
    setParsedReplays([]);
    setActiveReplayIndex(-1);
    setParseErrors([]);
    setIngestErrors([]);
    setViewTab("replay");
    onParsedReplay?.(null);
  }

  return (
    <div
      className="grid"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(320px, 0.95fr) minmax(420px, 1.35fr)",
        gap: 16,
        alignItems: "stretch",
      }}
    >
      <section
        className="card"
        style={{
          height: PANEL_HEIGHT,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="stack" style={{ paddingBottom: 12 }}>
          <div>
            <h2>Replay inspector</h2>
            <p className="muted">Upload one or more .w3g files. Replays are inspected one-by-one and you can switch between them.</p>
          </div>

          <div className="row" style={{ flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <input
              type="file"
              accept=".w3g"
              multiple
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) void handleFiles(files);
                e.currentTarget.value = "";
              }}
            />

            <label className="small muted" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={autoIngest}
                onChange={(e) => setAutoIngest(e.target.checked)}
                disabled={busy}
              />
              Auto ingest parsed replays
            </label>

            {busy ? <span className="badge">{busyLabel ?? "Parsing…"}</span> : null}

            {parsedReplays.length || parseErrors.length || ingestErrors.length ? (
              <button className="secondary" onClick={clearAll}>Clear all</button>
            ) : null}
          </div>

          {parsed ? (
            <div className="small muted">Active replay: {fileSummaryLabel(parsed)}</div>
          ) : null}
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          <div className="stack">
            {parsedReplays.length ? (
              <div className="stack">
                <div>
                  <h3>Loaded replays</h3>
                  <div className="replay-list">
                    {parsedReplays.map((entry, index) => (
                      <button
                        key={`${entry.fileName}-${entry.fileSize}-${index}`}
                        className={`replay-list-item ${index === activeReplayIndex ? "active" : ""}`}
                        onClick={() => selectReplay(index)}
                      >
                        <strong>{entry.fileName}</strong>
                        <span className="small muted">{entry.meta?.map ?? "unknown map"}</span>
                        <span className="small muted">
                          {fmtDuration(entry.meta?.durationSec)} • {entry.players.filter((p) => !p.isObserver && !p.isComputer).length} players
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted">Upload one or more replays to inspect the parsed output.</p>
            )}

            {parseErrors.length ? (
              <div>
                <h3>Parse errors</h3>
                <div className="stack">
                  {parseErrors.map((entry, index) => (
                    <div key={`${entry.fileName}-${index}`} className="badge badge-block">
                      <strong>{entry.fileName}:</strong> {entry.message}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {ingestErrors.length ? (
              <div>
                <h3>Ingest errors</h3>
                <div className="stack">
                  {ingestErrors.map((entry, index) => (
                    <div key={`${entry.fileName}-${index}`} className="badge badge-block">
                      <strong>{entry.fileName}:</strong> {entry.message}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section
        className="card"
        style={{
          height: PANEL_HEIGHT,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            paddingBottom: 12,
          }}
        >
          <div>
            <h2>Replay view</h2>
            <p className="muted">Selected replay details and parsed output.</p>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <TabButton active={viewTab === "replay"} onClick={() => setViewTab("replay")}>
              Replay
            </TabButton>
            <TabButton active={viewTab === "debug"} onClick={() => setViewTab("debug")}>
              Debug
            </TabButton>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          {!parsed ? (
            <div className="badge badge-block muted">
              No replay selected. Pick one from the loaded replay list.
            </div>
          ) : viewTab === "debug" ? (
            <div className="stack">
              <div className="small muted">Active replay: {fileSummaryLabel(parsed)}</div>
              <div>
                <h3>Replay diagnostics</h3>
                <p className="muted">Low-level diagnostics from the browser-side fallback path.</p>
              </div>
              <pre className="json">
                {JSON.stringify({ meta: parsed.meta, mmd: parsed.mmd, diagnostics: parsed.diagnostics }, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="stack">
              <div className="small muted">Active replay: {fileSummaryLabel(parsed)}</div>

              <div className="stack">
                <div><strong>File:</strong> {parsed.fileName}</div>
                <div><strong>Map:</strong> {parsed.meta?.map ?? "—"}</div>
                <div><strong>Duration:</strong> {fmtDuration(parsed.meta?.durationSec)}</div>
                <div><strong>Game:</strong> {parsed.meta?.gameName ?? "—"}</div>
              </div>

              {parsed.warnings.length ? (
                <div>
                  <h3>Warnings</h3>
                  <ul>
                    {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              ) : null}

              <PlayersPanel players={parsed.players} />
              <ChatPanel chat={parsed.chat} players={parsed.players} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}