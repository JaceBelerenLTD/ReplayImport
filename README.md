# ReplayImport

ReplayImport is a two-app Warcraft III replay toolset:

- `apps/api`: replay parsing and 4v4 rankings ingestion API
- `apps/web`: replay inspection UI and rankings UI

## What it does

The replay pipeline accepts `.w3g` files, parses them through `w3gjs`, repairs common parser edge cases, normalizes player/chat data, and exposes a raw replay payload to the frontend. The rankings pipeline accepts a parsed replay summary, validates that it is an 8-human 4v4 match, deduplicates by replay fingerprint, stores the match in SQLite, and rebuilds ladder ratings from match history.

## Structure

- `apps/api/src/routes`: Express route registration
- `apps/api/src/replay`: replay parsing/orchestration
- `apps/api/src/rankings`: rankings logic and route handlers
- `apps/api/src/infra`: SQLite bootstrap
- `apps/web/src/features/replay-inspector`: replay inspection feature
- `apps/web/src/features/rankings`: rankings feature
- `packages/contracts/src`: shared TypeScript contracts used by the frontend

## Notes

This refactor removes the old replay inspect endpoint, renames the replay UI around inspection rather than parsing, and isolates browser-side low-level replay work under `diagnostics/` to make its transitional role explicit.


## Run

From the repo root:

- `npm run dev:api`
- `npm run dev:web`

Or run each app from its workspace directory.
