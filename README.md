# TakeSplit

Auto-splits full band rehearsal recordings into individual takes, so bands can tag, rate, and comment on clips instead of never listening back.

See [HANDOFF.md](./HANDOFF.md) for the full spec and [DECISIONS.md](./DECISIONS.md) for the engineering log (real bugs found and fixed, phase by phase). Currently through **Phase 5** (band collaboration); Phase 6 (polish) in progress.

## Architecture

```
┌─────────────────┐        ┌──────────────────────┐        ┌────────────────────┐
│   Mobile app     │        │   Supabase (Docker)   │        │  Worker (FastAPI)   │
│  Expo Router /   │◄──────►│  Postgres + Auth +    │◄──────►│  detect.py splits   │
│  React Native    │  REST  │  Storage + Realtime   │  HTTP  │  audio into takes,  │
│  (iOS/Android/Web)│  +RLS  │                       │        │  writes clips +     │
└─────────────────┘        └──────────────────────┘        │  peaks.json         │
                                                              └────────────────────┘
```

- **Mobile app** (`apps/mobile`) — auth, upload, rehearsal list, waveform editor, tagging, comments. Talks to Supabase directly via `supabase-js`; every table read/write goes through RLS, never a raw bypass.
- **Supabase** — Postgres schema + Row Level Security (every policy keyed off `band_members`), Storage for the original audio files (never modified after upload), Realtime for live rehearsal status updates.
- **Worker** (`services/worker`) — stateless FastAPI service. Given a rehearsal's storage path, runs `detect.py` (pure function: audio samples in, segments out, no I/O) to find take boundaries, writes `clips` rows and a downsampled `peaks.json` for the waveform UI back to Supabase.

Clips are **virtual** — start/end timestamps on the original file, not cut files. Boundary edits in the waveform UI are instant because nothing is re-encoded.

## Detection accuracy

`detect.py`'s synthetic test suite (tone bursts with silence/noise gaps, covering every hard case in HANDOFF.md §8 plus confidence-score assertions): **31/31 passing** (`services/worker/tests/test_detect.py`).

Real-rehearsal accuracy against actual KTD recordings (HANDOFF.md §3's intended acceptance gate) has **not** been measured — that gate was explicitly skipped at Victor's request to unblock backend work sooner (see 2026-09-16 entry in DECISIONS.md). Default detection params in `detect.py`'s `DEFAULT_PARAMS` are therefore untuned against real room noise and may need adjustment once real recordings are run through the pipeline.

## Running locally

```bash
# Backend
supabase start
cd services/worker && uvicorn app.main:app --reload

# Mobile app
cd apps/mobile && npx expo start --web
```

Requires `apps/mobile/.env` and `services/worker/.env` (see `.env.example` in each) pointing at the local Supabase instance.

## Stack

- **Mobile:** Expo Router, React Native, TypeScript (strict)
- **Backend:** Supabase (Postgres, Auth, Storage, Realtime), SQL migrations in `supabase/migrations`
- **Worker:** Python 3.12, FastAPI, numpy
