import type { MmdData, ParsedReplay } from "../../../lib/types";
import { mapReplayApiToView, type RawReplay } from "../mapping/mapReplayApiToView";
import { ENABLE_CLIENT_DIAGNOSTICS, DECOMPRESS_TIMEOUT_MS, log, time, timeEnd, warn, withTimeout } from "../diagnostics/config";
import { decompressReplayFile } from "../diagnostics/w3g/decompressReplay";
import { extractMmdFlagsFromStream } from "../diagnostics/w3g/extractMmdFlags";
import { applyWinnerFlagsToPlayers, applyWinnerToPlayers, deriveWinnerTeamIdFromFlags } from "../diagnostics/deriveWinner";

type RawEndpointResponse = {
  ok?: boolean;
  raw?: RawReplay;
  error?: string;
};

function bytesToHex(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!.toString(16).padStart(2, "0"));
  return out.join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return bytesToHex(new Uint8Array(digest));
}

export async function parseReplayFile(file: File): Promise<ParsedReplay> {
  const warnings: string[] = [];
  let diagnostics: unknown = undefined;

  time("backend raw fetch");
  const resp = await fetch("/api/replay/raw", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
  timeEnd("backend raw fetch");

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(txt || `Replay parse failed (${resp.status})`);
  }

  const data = (await resp.json()) as RawEndpointResponse;
  if (data.ok !== true) warnings.push(data.error ? `Backend: ${data.error}` : "Backend did not return ok=true; payload may be partial.");

  const raw = (data.raw ?? {}) as RawReplay;
  const mapped = mapReplayApiToView(file, raw);

  let manualFlagsByPid: Record<number, string> | undefined;
  let manualWinnerTeamId: number | null = null;

  if (ENABLE_CLIENT_DIAGNOSTICS) {
    try {
      time("client diagnostics total");
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const decomp = await withTimeout(decompressReplayFile(fileBytes), DECOMPRESS_TIMEOUT_MS, "decompressReplayFile");
      const stream = decomp.stream;
      const mmd = extractMmdFlagsFromStream(stream);

      if (mmd?.flagsByPid) {
        manualFlagsByPid = mmd.flagsByPid;
        manualWinnerTeamId = deriveWinnerTeamIdFromFlags(manualFlagsByPid, mapped.teamByMmdPid);
      }

      const headLen = Math.min(256, stream.length);
      const tailLen = Math.min(256, stream.length);
      diagnostics = {
        decompressed: {
          headerSize: decomp.headerSize,
          blocks: decomp.blocks,
          streamLength: stream.length,
          sha256: await sha256Hex(stream),
          headHex: bytesToHex(stream.subarray(0, headLen)),
          tailHex: bytesToHex(stream.subarray(Math.max(0, stream.length - tailLen))),
        },
        manualMmd: mmd ?? null,
        diagnostics: {
          mmdPidToPlayer: mapped.players
            .filter((p) => typeof p.mmdPid === "number")
            .sort((a, b) => (a.mmdPid ?? 0) - (b.mmdPid ?? 0))
            .map((p) => ({
              mmdPid: p.mmdPid,
              pid: p.pid,
              backendId: p.id,
              name: p.name,
              team: p.team,
              isComputer: p.isComputer,
              isObserver: p.isObserver,
            })),
        },
      };
      timeEnd("client diagnostics total");
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      warnings.push(`Client diagnostics parse failed: ${msg}`);
      warn("client diagnostics parse failed", e);
    }
  }

  const backendWinnerTeamId = typeof (raw as any).winningTeamId === "number" ? (raw as any).winningTeamId : undefined;
  if ((backendWinnerTeamId == null || backendWinnerTeamId === -1) && manualWinnerTeamId != null) {
    applyWinnerToPlayers(mapped.players, manualWinnerTeamId);
  }

  const mergedMmd: MmdData | undefined = (() => {
    const backendMmd = (raw as any).mmd as MmdData | undefined;
    if (!backendMmd && !manualFlagsByPid) return undefined;
    const out: MmdData = { ...(backendMmd ?? {}) };
    (out as any).flagsByPid = manualFlagsByPid ?? ((backendMmd as any)?.flagsByPid ?? undefined);
    return out;
  })();

  const effectiveFlagsByPid = (mergedMmd as any)?.flagsByPid as Record<number, string> | undefined;
  if (effectiveFlagsByPid && Object.keys(effectiveFlagsByPid).length) applyWinnerFlagsToPlayers(mapped.players, effectiveFlagsByPid);

  log("parsed replay", file.name, mapped.players.length, mapped.chat?.length ?? 0);

  return {
    fileName: file.name,
    fileSize: file.size,
    meta: mapped.meta,
    players: mapped.players,
    chat: mapped.chat?.length ? mapped.chat : undefined,
    mmd: mergedMmd,
    raw,
    diagnostics,
    warnings: warnings.concat(mapped.warnings ?? []),
  };
}
