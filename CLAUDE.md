# TakeSplit — Instructions for Claude Code

Read `HANDOFF.md` fully before starting any work. It is the source of truth for scope, architecture, data model, and build phases.

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

Feature specs beyond the base handoff live in `docs/superpowers/specs/`.
