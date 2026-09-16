# Rehearsal Splitter — Build Handoff for Claude Code

> Working name: **TakeSplit** (rename freely)
> Owner: Victor
> Build tool: Claude Code
> Pace: 3–6 hours/week, ~8 weeks
> Primary goal: **portfolio credibility**, with KTD as real users

---

## 1. Problem

Bands record full rehearsals as one 1–3 hour audio file and almost never listen back. Finding "the good take of the bridge" means scrubbing through talking, tuning, and noodling.

**TakeSplit** takes a full rehearsal recording, automatically splits it into individual takes, and lets the band tag, rate, and comment on each take so recordings actually get used.

## 2. Users

- **Primary:** KTD (Victor – drums, Harold – guitar/vocals, Paolo – bass/vocals, Azi – guitar). Mixed iOS/Android.
- **Later:** other local bands.

## 3. Success criteria (measure these for the portfolio write-up)

1. **Detection accuracy:** on real KTD rehearsals, the splitter finds at least 90% of actual takes, with at most 1 false split per 10 takes, before manual correction.
2. **Speed:** a 2-hour recording is processed in under 3 minutes.
3. **Usage:** all 4 KTD members open and tag clips from at least 3 rehearsals.

---

## 4. Scope

### MVP (in scope)
- Upload an existing recording (m4a, mp3, wav) from phone files.
- Server-side auto-split into clips.
- Waveform view with detected clips; drag to adjust clip boundaries; merge/split/delete clips.
- Tag clips: song (from band song list), take number (auto), quick tags, 1–3 star rating, notes.
- Play clips, including "all takes of this song" view.
- Band workspace with invite link; all members see the same rehearsals.
- Timestamped comments on clips.

### Phase 2 (after MVP works)
- In-app recording with background support.
- Tempo (BPM) estimate per take.
- Auto-suggest song name by comparing to previously tagged takes.
- Export/share a single clip.

### Out of scope
- Editing/mixing audio, effects, multitrack.
- Lyrics or chord charts.
- Public social features.

---

## 5. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Mobile app | **Expo (React Native, TypeScript)**, Expo Router | iOS + Android from one codebase |
| Audio playback | `expo-audio` | Official Expo audio module |
| Backend / DB / auth | **Supabase** (Postgres, Auth, Storage, RLS) | Fast to build, row-level security for bands |
| Processing worker | **Python 3.12 + FastAPI + FFmpeg + numpy** (librosa for phase 2) | Proper audio tooling |
| Worker hosting | Docker container on Railway, Render, or Fly.io | Supabase Edge Functions cannot run FFmpeg/Python |
| Storage | Supabase Storage (verify limits, see §11) | Keeps stack simple |

---

## 6. Architecture

```
[Expo app] --upload (resumable)--> [Supabase Storage: raw/]
     |                                     |
     |--insert rehearsal row (status=uploaded)
     |                                     |
     |--POST /process {rehearsal_id} --> [Python worker]
                                           | download original
                                           | ffmpeg -> mono 16kHz wav for analysis
                                           | detect segments
                                           | generate waveform peaks JSON
                                           | upload peaks to Storage
                                           | insert clip rows, status=ready
     <---- Supabase Realtime (status change) ----
```

**Important design decision:** clips are **virtual**. They are start/end timestamps on the original file, not cut files. Playback seeks into the original. This makes boundary edits instant and free. Physically cutting files only happens on export (phase 2).

Rehearsal status flow: `uploading → uploaded → processing → ready` (or `failed` with `error_message`).

---

## 7. Data model (Supabase / Postgres)

```sql
create table bands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  created_by uuid references auth.users not null,
  created_at timestamptz default now()
);

create table band_members (
  band_id uuid references bands on delete cascade,
  user_id uuid references auth.users on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner','member')),
  primary key (band_id, user_id)
);

create table songs (
  id uuid primary key default gen_random_uuid(),
  band_id uuid references bands on delete cascade not null,
  title text not null,
  unique (band_id, title)
);

create table rehearsals (
  id uuid primary key default gen_random_uuid(),
  band_id uuid references bands on delete cascade not null,
  title text,
  recorded_on date not null default current_date,
  storage_path text not null,
  peaks_path text,
  duration_sec numeric,
  status text not null default 'uploading'
    check (status in ('uploading','uploaded','processing','ready','failed')),
  error_message text,
  detection_params jsonb,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

create table clips (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid references rehearsals on delete cascade not null,
  start_sec numeric not null,
  end_sec numeric not null check (end_sec > start_sec),
  kind text not null default 'take' check (kind in ('take','talk')),
  song_id uuid references songs on delete set null,
  take_number int,
  rating smallint check (rating between 1 and 3),
  tags text[] not null default '{}',
  notes text,
  auto_detected boolean not null default true,
  created_at timestamptz default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid references clips on delete cascade not null,
  user_id uuid references auth.users not null,
  at_sec numeric,              -- position within the clip, nullable
  body text not null,
  created_at timestamptz default now()
);
```

**RLS rule for every table:** a user can read/write a row only if they are in `band_members` for that row's band. Write a helper SQL function `is_band_member(band_id)` and use it in all policies. Storage paths follow `bands/{band_id}/rehearsals/{rehearsal_id}/original.{ext}` with matching storage policies.

**Take numbers:** when a clip's song is set, assign `take_number` = count of existing clips of that song in the same rehearsal + 1, ordered by `start_sec`. Recompute on reassign.

---

## 8. Splitting algorithm spec

### Input
Original audio file of any common format, 1 min – 4 hours.

### Steps
1. **Normalize for analysis:** `ffmpeg -i input -ac 1 -ar 16000 -f wav analysis.wav`. Never modify the original.
2. **Loudness frames:** RMS energy in 100 ms windows, converted to dB.
3. **Smoothing:** moving median over ~1 s to ignore single hits and short spikes.
4. **Adaptive threshold:**
   - `noise_floor_db` = 10th percentile of frame dB
   - `music_level_db` = 90th percentile of frame dB
   - `threshold_db = noise_floor_db + (music_level_db - noise_floor_db) * threshold_ratio`
5. **Active regions:** frames above threshold.
6. **Merge gaps:** join active regions separated by less than `min_gap_sec`.
7. **Classify:** regions shorter than `min_take_sec` become `kind='talk'` (kept, but hidden by default), others `kind='take'`.
8. **Pad:** extend each region by `pad_sec` on both sides, clamped to file bounds and to not overlap neighbors.
9. **Output:** list of `{start_sec, end_sec, kind}` plus the params used (stored in `rehearsals.detection_params`).

### Default parameters (tune in Phase 0)
```json
{
  "frame_ms": 100,
  "smooth_sec": 1.0,
  "threshold_ratio": 0.35,
  "min_gap_sec": 4.0,
  "min_take_sec": 40.0,
  "pad_sec": 1.0
}
```

### Known hard cases (write tests for each)
- Talking between songs at a volume close to quiet playing.
- Quiet intro or breakdown inside a song (must not split).
- Band restarts a song after 10 seconds ("again from the top").
- Continuous noodling between songs with no real silence.
- Clipped/distorted phone recordings from a loud room.

### Waveform peaks
Generate ~2,000 min/max pairs for the whole file (scale with duration if needed) and store as JSON in Storage at `.../peaks.json`. The app renders from this; it never decodes the full audio for drawing.

### Clip confidence score

See `docs/superpowers/specs/2026-09-16-clip-confidence-score-design.md` for the full design. Summary: each detected segment also gets a `confidence` score (0–1) computed from three margins (distance from `threshold_db`, distance from `min_gap_sec`, distance from `min_take_sec`), weighted `0.4/0.3/0.3`. Tier: `high` ≥0.7, `medium` 0.4–0.7, `low` <0.4. Stored in `rehearsals.detection_params.clip_confidence`, keyed by clip UUID after insert. Surfaced in-app as a clip row badge, waveform tint, and a "N clips need review" banner. Ships as part of Phase 0 (scoring, `detect.py`) and Phase 4 (UI surfaces).

---

## 9. Worker API

All endpoints require a shared secret header `X-Worker-Key`. The worker uses the Supabase **service role key** (server-side only, never in the app).

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| POST | `/process` | Body `{ "rehearsal_id": "uuid" }`. Returns 202 immediately; runs job in background |
| POST | `/detect-preview` | Body `{ "rehearsal_id", "params" }`. Re-run detection with new params and return segments without saving (for tuning UI later) |

Processing rules:
- Set `status='processing'` at start; on any exception set `status='failed'` and `error_message`.
- Idempotent: re-processing deletes existing `auto_detected=true` clips for that rehearsal but **keeps** manually edited clips (`auto_detected=false`).
- Log duration of each step for the speed metric.

> For MVP, triggering from the app is fine. Better option later: a Supabase database webhook on `status='uploaded'` calling `/process`.

---

## 10. App screens

1. **Auth:** email magic link (Supabase Auth).
2. **Band setup:** create band or join with invite code; set display name.
3. **Rehearsals list:** date, title, duration, status badge, number of takes.
4. **Upload:** pick file, title, date; progress bar; resumable upload.
5. **Rehearsal detail:**
   - Waveform with clip regions colored (takes) and grayed (talk).
   - Clip list below: time range, song, take #, rating, tag chips.
   - Toggle "show talk segments."
6. **Clip editor:** play/pause, drag start/end handles, split at playhead, merge with next, delete. Editing sets `auto_detected=false`.
7. **Tag sheet:** song picker (with "add new song"), rating, quick tags (`best take`, `tempo rushed`, `tempo dragged`, `bridge fix`, `new idea`, `ending issue`), notes.
8. **Song view:** all takes of one song across rehearsals, newest first, with ratings.
9. **Comments:** on clip; optional "at current playhead" timestamp; tap to seek.

Playback detail: playing a clip = load original, seek to `start_sec`, stop at `end_sec`. Test seek accuracy on m4a/AAC on both iOS and Android early; if seeking is inaccurate, the worker should also produce an analysis-friendly playback copy (see §11).

---

## 11. Risks and decisions to verify early

1. **Storage upload limits.** A 2–3 hour rehearsal at 128 kbps is roughly 115–175 MB. Supabase plan limits on file size may block this. **Verify current Supabase limits in Phase 1.** Options if blocked: use resumable (TUS) uploads on a paid plan, compress to ~64 kbps mono AAC on upload, or use Cloudflare R2 for audio.
2. **Seek accuracy on compressed audio.** Some formats seek imprecisely. If clips start in the wrong place, have the worker transcode a playback copy (e.g., AAC with frequent keyframes, or constant-bitrate MP3) and play from that.
3. **Detection quality on real rooms.** This is the whole product. Phase 0 must pass before any app work.
4. **Worker cold starts / cost.** Free hosting tiers may sleep. Acceptable for MVP; note it.
5. **Privacy.** Unreleased songs are sensitive. All storage private; signed URLs only; RLS on every table.

---

## 12. Repository structure

```
takesplit/
├── CLAUDE.md
├── HANDOFF.md
├── README.md
├── DECISIONS.md
├── apps/
│   └── mobile/                 # Expo app (TypeScript)
│       ├── app/                # Expo Router screens
│       ├── components/         # Waveform, ClipRow, TagSheet...
│       ├── lib/                # supabase client, api, audio helpers
│       └── types/
├── services/
│   └── worker/                 # Python FastAPI
│       ├── app/
│       │   ├── main.py
│       │   ├── detect.py       # pure detection logic, no I/O
│       │   ├── audio.py        # ffmpeg wrappers
│       │   ├── peaks.py
│       │   └── jobs.py         # download → detect → save
│       ├── tests/
│       │   ├── fixtures/       # small synthetic audio files
│       │   └── test_detect.py
│       ├── scripts/
│       │   └── split_local.py  # Phase 0 CLI
│       ├── Dockerfile
│       └── pyproject.toml
└── supabase/
    ├── migrations/
    └── seed.sql
```

---

## 13. Build phases with acceptance criteria

### Phase 0 — Prove detection (week 1–2) **do this first**
- `scripts/split_local.py input.m4a --out ./clips` implementing §8.
- Outputs: clips as separate audio files, `segments.json` (including per-segment `confidence`), and a PNG waveform plot with segment boundaries drawn.
- `--params` flag to override defaults.
- Synthetic test fixtures generated in code (tone bursts with silence/noise gaps) and pytest tests for every hard case in §8, plus confidence-score assertions per `docs/superpowers/specs/2026-09-16-clip-confidence-score-design.md`.
- **Accept when:** run on 2–3 real KTD rehearsals, Victor manually counts actual takes, and accuracy meets §3 target (or the failures are understood and documented).

### Phase 1 — Backend (week 3)
- Supabase migrations for §7, RLS policies, storage bucket and policies.
- **Verify storage limits (§11.1).**
- **Accept when:** RLS tests prove a non-member cannot read another band's rehearsals, clips, or files.

### Phase 2 — Worker service (week 3–4)
- FastAPI endpoints from §9, Dockerfile, deploy.
- **Accept when:** uploading a file manually to Storage and calling `/process` produces clip rows and peaks JSON, and a failure sets `status='failed'`.

### Phase 3 — App core (week 4–5)
- Auth, band create/join, rehearsal list, upload with progress, realtime status, clip list, clip playback.
- **Accept when:** Victor uploads a real rehearsal from iPhone and plays correct clips.

### Phase 4 — Editing and tagging (week 5–6)
- Waveform, boundary drag, split/merge/delete, tag sheet, songs, auto take numbers, clip confidence UI (badge, waveform tint, review banner).
- **Accept when:** a full rehearsal can be cleaned and tagged in under 10 minutes.

### Phase 5 — Band collaboration (week 7)
- Invite flow, comments, song view across rehearsals.
- **Accept when:** all 4 KTD members are using it on their own phones (TestFlight for iOS, internal build/APK for Android).

### Phase 6 — Polish and portfolio (week 8)
- Error states, empty states, loading states.
- README with architecture diagram, demo GIF, and measured accuracy/speed from §3.

---

## 14. Instructions for Claude Code (copy into CLAUDE.md)

- Work **one phase at a time**. Do not start a phase until the previous phase's acceptance criteria pass. Ask before moving on.
- Before writing code in a new phase, propose a short plan (files to create, decisions) and wait for approval.
- Keep detection logic in `detect.py` **pure** (arrays in, segments out, no file or network I/O) so it is easily tested.
- Write tests alongside code. Worker: pytest. App: test pure helpers (take numbering, time formatting, clip merge/split math).
- TypeScript strict mode. No `any` without a comment explaining why.
- Never put the Supabase service role key or worker key in the mobile app or commit them. Use `.env` files and provide `.env.example`.
- Every schema change is a new migration file; never edit applied migrations.
- Do not modify the original uploaded audio, ever.
- When a requirement here is ambiguous or conflicts with what you find (library limits, platform behavior), stop and ask instead of guessing.
- Keep a `DECISIONS.md` log: date, decision, reason. This becomes portfolio material.
- Commit in small, working steps with clear messages.

---

## 15. Before starting (Victor's checklist)

- [ ] Record 2–3 full KTD rehearsals on phone (Voice Memos is fine).
- [ ] Write down actual takes per recording (song + approximate time) as ground truth.
- [ ] Install FFmpeg, Python 3.12, Node LTS, Expo tooling, Supabase CLI.
- [ ] Create a Supabase project (don't build Phase 1 yet).
- [ ] Decide final app name.
