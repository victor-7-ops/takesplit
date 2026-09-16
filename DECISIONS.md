# Decisions Log

- **2026-09-16** — Adopted the clip confidence score feature (see `docs/superpowers/specs/2026-09-16-clip-confidence-score-design.md`) into Phase 0/4 of the base plan, rather than treating it as a later add-on. Reason: it's cheap to add while writing `detect.py` for the first time, expensive to retrofit once clip schema and UI are built around a binary auto_detected flag.
- **2026-09-16** — Confidence data stored in `rehearsals.detection_params` jsonb rather than a new `clips.confidence` column. Reason: avoids a schema migration for a display-only, non-authoritative value; accepted tradeoff is no SQL-level filtering across clips by confidence tier at MVP scale.
