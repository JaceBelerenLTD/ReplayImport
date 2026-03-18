import type { Express } from "express";
import express from "express";
import { parseReplayRaw } from "../replay/parseReplayRaw.js";

export function registerReplayRoutes(app: Express) {
  app.post(
    "/api/replay/raw",
    express.raw({ type: "application/octet-stream", limit: "50mb" }),
    async (req, res) => {
      try {
        const buf = req.body as Buffer;
        if (!buf || !Buffer.isBuffer(buf) || buf.length < 16) {
          return res.status(400).json({ error: "Missing or invalid replay body" });
        }

        const result = await parseReplayRaw(buf);
        return res.json({ ok: !result.partial, raw: result.raw, error: result.error });
      } catch (e: any) {
        console.error("Replay raw parse failed:", e);
        return res.status(500).json({ error: e?.message ?? String(e) });
      }
    }
  );
}
