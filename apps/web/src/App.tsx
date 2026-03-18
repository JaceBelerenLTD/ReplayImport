import { useState } from "react";
import ReplayInspectorPage from "./features/replay-inspector/ReplayInspectorPage";
import RankingsPage from "./features/rankings/RankingsPage";
import type { ParsedReplay } from "./lib/types";

type Tab = "replay" | "rankings";

export default function App() {
  const [tab, setTab] = useState<Tab>("replay");
  const [parsedReplay, setParsedReplay] = useState<ParsedReplay | null>(null);
  const [rankingsRefreshKey, setRankingsRefreshKey] = useState(0);

  return (
    <div className="app-shell">
      <div className="app-inner">
        <header className="header">
          <div>
            <h1 style={{ margin: 0 }}>ReplayImport</h1>
            <p className="muted" style={{ marginBottom: 0 }}>Replay inspection and 4v4 rankings ingestion for Warcraft III.</p>
          </div>
          <nav className="tabs">
            <button className={`tab ${tab === "replay" ? "active" : ""}`} onClick={() => setTab("replay")}>Replay inspector</button>
            <button className={`tab ${tab === "rankings" ? "active" : ""}`} onClick={() => setTab("rankings")}>Rankings</button>
          </nav>
        </header>

        {tab === "replay" ? (
          <ReplayInspectorPage
            onParsedReplay={setParsedReplay}
            onRankingsChanged={() => setRankingsRefreshKey((v: number) => v + 1)}
          />
        ) : (
          <RankingsPage parsedReplay={parsedReplay} refreshKey={rankingsRefreshKey} />
        )}
      </div>
    </div>
  );
}
