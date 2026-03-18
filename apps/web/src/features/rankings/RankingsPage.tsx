import { useEffect, useMemo, useState } from "react";
import { fmtDate, fmtDuration } from "../../app/format";
import type { ParsedReplay, RankingsLogEntry, RankingsState } from "../../lib/types";
import { exportRankingsJson, getRankingsState, importRankingsJson, ingestParsedReplay, postRankingsAction } from "./api/rankingsClient";

type Props = {
  parsedReplay: ParsedReplay | null;
  refreshKey?: number;
};

const emptyState: RankingsState = { version: 3, players: [], matches: [] };
const ELIGIBLE_MIN_GAMES = 8;

export default function RankingsPage({ parsedReplay, refreshKey = 0 }: Props) {
  const [state, setState] = useState<RankingsState>(emptyState);
  const [log, setLog] = useState<RankingsLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showOfficialOnly, setShowOfficialOnly] = useState(false);
  const [showProvisionalOnly, setShowProvisionalOnly] = useState(false);
  const [backupText, setBackupText] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  async function refreshRankings() {
    try {
      const data = await getRankingsState();
      setState(data.state);
      setLog(data.log);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refreshRankings();
  }, [refreshKey]);

  const standings = useMemo(() => {
    const q = search.trim().toLowerCase();

    return [...state.players]
      .map((p) => ({
        ...p,
        games: p.wins + p.losses,
        winPct: p.wins + p.losses > 0 ? p.wins / (p.wins + p.losses) : 0,
      }))
      .filter((p) => {
        const official = p.games >= ELIGIBLE_MIN_GAMES;
        if (showOfficialOnly && !official) return false;
        if (showProvisionalOnly && official) return false;
        if (q && !p.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.name.localeCompare(b.name));
  }, [search, showOfficialOnly, showProvisionalOnly, state.players]);

  const replaySummary = useMemo(() => {
    if (!parsedReplay) return null;
    const humans = parsedReplay.players.filter((p) => !p.isObserver && !p.isComputer);
    const winners = humans.filter((p) => p.isWinner || String(p.result ?? "").toLowerCase() === "winner");

    return {
      humans: humans.length,
      winners: winners.length,
      teams: Array.from(new Set(humans.map((p) => p.team).filter((t): t is number => typeof t === "number"))).length,
    };
  }, [parsedReplay]);

  const selectedMatch = useMemo(
    () => state.matches.find((m) => m.id === selectedMatchId) ?? null,
    [state.matches, selectedMatchId],
  );

  async function runAction(action: () => Promise<{ state: RankingsState; logEntry?: RankingsLogEntry }>) {
    setBusy(true);
    setError(null);

    try {
      const data = await action();
      setState(data.state);
      if (data.logEntry) setLog((prev) => [data.logEntry, ...prev].slice(0, 200));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>Rankings</h2>
            <p className="muted">4v4 rankings built from parsed replay summaries.</p>
          </div>
          {busy ? <span className="badge">Working…</span> : null}
        </div>

        {parsedReplay ? (
          <div className="badge badge-block" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div><strong>Current replay:</strong> {parsedReplay.fileName}</div>
            <div className="small muted">
              {parsedReplay.meta?.map ?? "unknown map"} • {fmtDuration(parsedReplay.meta?.durationSec)} • humans {replaySummary?.humans ?? 0} • teams {replaySummary?.teams ?? 0} • winners {replaySummary?.winners ?? 0}
            </div>
          </div>
        ) : (
          <div className="badge badge-block muted">No parsed replay selected. Load one in the Replay inspector tab first.</div>
        )}

        <div className="row">
          <button
            className="primary"
            disabled={!parsedReplay || busy}
            onClick={() =>
              void runAction(async () => {
                const data = await ingestParsedReplay(parsedReplay!);
                if (!data.ok) throw new Error(data.error ?? "Failed to ingest replay");
                return { state: data.state, logEntry: data.logEntry };
              })
            }
          >
            Ingest current parsed replay
          </button>

          <button
            className="secondary"
            disabled={busy}
            onClick={() => void runAction(() => postRankingsAction("/api/rankings/undoLastIngest"))}
          >
            Undo last ingest
          </button>

          <button
            className="secondary"
            disabled={busy}
            onClick={() => void runAction(() => postRankingsAction("/api/rankings/startNewSeason"))}
          >
            Start new season
          </button>

          <button
            className="danger"
            disabled={busy}
            onClick={() => void runAction(() => postRankingsAction("/api/rankings/resetAll"))}
          >
            Reset all
          </button>
        </div>

        {error ? <div className="badge badge-block">{error}</div> : null}

        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player"
            style={{ minWidth: 220 }}
          />

          <label className="small muted">
            <input
              type="checkbox"
              checked={showOfficialOnly}
              onChange={(e) => {
                setShowOfficialOnly(e.target.checked);
                if (e.target.checked) setShowProvisionalOnly(false);
              }}
            />{" "}
            Official only
          </label>

          <label className="small muted">
            <input
              type="checkbox"
              checked={showProvisionalOnly}
              onChange={(e) => {
                setShowProvisionalOnly(e.target.checked);
                if (e.target.checked) setShowOfficialOnly(false);
              }}
            />{" "}
            Provisional only
          </label>

          <span className="small muted">Official = at least {ELIGIBLE_MIN_GAMES} counted games</span>
        </div>

        <div>
          <h3>Recent ingested replays</h3>
          <div className="replay-list">
            {state.matches.slice(0, 20).map((m) => (
              <button
                key={m.id}
                className={`replay-list-item ${m.id === selectedMatchId ? "active" : ""}`}
                onClick={() => setSelectedMatchId(m.id)}
              >
                <strong>{m.fileName ?? m.id}</strong>
                <span className="small muted">{m.map ?? "unknown map"}</span>
                <span className="small muted">
                  {fmtDuration(m.durationSec)} • {fmtDate(m.ts)}
                </span>
              </button>
            ))}
            {!state.matches.length ? <div className="muted small">No matches ingested yet.</div> : null}
          </div>
        </div>

        {selectedMatch?.replay ? (
          <div className="badge badge-block" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div><strong>Stored replay:</strong> {selectedMatch.replay.fileName}</div>
            <div className="small muted">
              {selectedMatch.replay.meta?.map ?? "unknown map"} • {fmtDuration(selectedMatch.replay.meta?.durationSec)} • players{" "}
              {selectedMatch.replay.players?.filter((p) => !p.isObserver && !p.isComputer).length ?? 0}
            </div>
          </div>
        ) : null}

        <div>
          <h3>Standings</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Rating</th>
                  <th>W</th>
                  <th>L</th>
                  <th>Games</th>
                  <th>Win %</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((p, idx) => (
                  <tr key={p.id}>
                    <td>{idx + 1}</td>
                    <td>{p.name}{p.games >= ELIGIBLE_MIN_GAMES ? "" : " *"}</td>
                    <td>{p.rating}</td>
                    <td>{p.wins}</td>
                    <td>{p.losses}</td>
                    <td>{p.games}</td>
                    <td>{(p.winPct * 100).toFixed(0)}%</td>
                  </tr>
                ))}
                {!standings.length ? <tr><td colSpan={7} className="muted">No players yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3>Replay history</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Map</th>
                  <th>Result</th>
                  <th>Teams</th>
                </tr>
              </thead>
              <tbody>
                {state.matches.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtDate(m.ts)}</td>
                    <td>
                      <div>{m.map ?? "—"}</div>
                      <div className="small muted">{fmtDuration(m.durationSec)}</div>
                    </td>
                    <td>{m.result}</td>
                    <td>
                      <div className="small">A: {m.teamA.join(", ")}</div>
                      <div className="small">B: {m.teamB.join(", ")}</div>
                    </td>
                  </tr>
                ))}
                {!state.matches.length ? <tr><td colSpan={4} className="muted">No matches yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3>Upload / ingest log</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {log.slice(0, 50).map((entry) => (
                  <tr key={entry.id}>
                    <td>{fmtDate(entry.ts)}</td>
                    <td>{entry.status}</td>
                    <td>{entry.message}</td>
                  </tr>
                ))}
                {!log.length ? <tr><td colSpan={3} className="muted">No log entries yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <h3>Backup</h3>
          <div className="row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const payload = await exportRankingsJson();
                    setBackupText(JSON.stringify(payload, null, 2));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              Export JSON
            </button>

            <button
              className="secondary"
              disabled={busy || !backupText.trim()}
              onClick={() =>
                void runAction(async () => {
                  const payload = JSON.parse(backupText);
                  return await importRankingsJson(payload);
                })
              }
            >
              Import JSON
            </button>
          </div>

          <textarea
            value={backupText}
            onChange={(e) => setBackupText(e.target.value)}
            placeholder="Exported rankings backup JSON appears here. You can also paste old backup JSON here and import it."
            rows={10}
            style={{ width: "100%" }}
          />
        </div>
      </section>
    </div>
  );
}
