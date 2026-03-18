import express from "express";
import cors from "cors";
import { dbPromise } from "./infra/sqlite.js";
import { registerReplayRoutes } from "./routes/replayRoutes.js";
import { registerRankingsRoutes } from "./routes/rankingsRoutes.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", async (_req, res) => {
  await dbPromise;
  res.json({ ok: true });
});

registerReplayRoutes(app);
registerRankingsRoutes(app);

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
