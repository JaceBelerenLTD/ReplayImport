import type { Express } from "express";
import {
  exportRankingsBackup,
  importRankingsBackup,
  ingestReplaySummary,
  loadState,
  pushLog,
  resetAllRankings,
  startNewSeason,
  undoLastIngest,
} from "../rankings/rankingsService.js";
import type { ReplaySummary, StoredState } from "../rankings/types.js";

export function registerRankingsRoutes(app: Express) {
  app.get("/api/rankings/state", async (_req, res) => {
    try {
      const { state, log } = await loadState();
      return res.json({ ok: true, state, log });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/rankings/ingest", async (req, res) => {
    const summary: ReplaySummary | undefined = req.body?.summary;
    if (!summary || typeof summary !== "object") {
      return res.status(400).json({ ok: false, error: "Missing summary" });
    }

    try {
      const result = await ingestReplaySummary(summary);
      return res.json(result);
    } catch (e: any) {
      const logEntry = await pushLog({
        status: "failed",
        message: e?.message ?? "Failed to ingest replay",
        fileName: summary.fileName,
        map: summary.meta?.map ?? undefined,
        durationSec: summary.meta?.durationSec ?? undefined,
      });

      const { state } = await loadState().catch(() => ({ state: { version: 3, players: [], matches: [] } as StoredState, log: [] }));
      return res.status(400).json({ ok: false, error: e?.message ?? "Failed to ingest replay", state, logEntry });
    }
  });

  const undoHandler = async (_req: any, res: any) => {
    try {
      return res.json({ ok: true, ...(await undoLastIngest()) });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  };

  app.post("/api/rankings/undoLastIngest", undoHandler);
  app.post("/api/rankings/undoLast", undoHandler);

  const startSeasonHandler = async (_req: any, res: any) => {
    try {
      return res.json({ ok: true, ...(await startNewSeason()) });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  };

  app.post("/api/rankings/startNewSeason", startSeasonHandler);
  app.post("/api/rankings/resetSeasonKeepPlayers", startSeasonHandler);

  app.post("/api/rankings/resetAll", async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await resetAllRankings()) });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/rankings/exportJson", async (_req, res) => {
    try {
      return res.json({ ok: true, payload: await exportRankingsBackup() });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/rankings/importJson", async (req, res) => {
    try {
      const payload = req.body?.payload;
      if (!payload || typeof payload !== "object") {
        return res.status(400).json({ ok: false, error: "Missing payload" });
      }

      return res.json({ ok: true, ...(await importRankingsBackup(payload)) });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });
}
