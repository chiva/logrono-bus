# Agent instructions (logrono-bus)

Read `docs/desarrollo/arquitectura.md` and the ADRs in `docs/adr/` before designing changes.

- **Language:** code, identifiers and comments in English; everything user-facing (UI, errors,
  docs under `docs/guia/`) in Spanish.
- **Tasks:** `uv run just <recipe>`; `uv run just ci` must pass before proposing a PR.
- **Contract:** Python (`packages/logrono-bus`) and TypeScript (`web/packages/core`) normalise the
  same way. A behaviour change touches both, regenerates goldens with `just golden`, and the diff
  of `contracts/fixtures/expected` is reviewed. API changes: `just gen`.
- **Upstream etiquette:** no new polling loops or higher request rates against
  transporteurbano.logrono.es beyond the documented ones (arrivals every 30 s per board; bus
  positions every 15 s only while a route view is open, ADR 0008; timetables at most once per
  line and local day, ADR 0009). Tests use
  `contracts/fixtures`; live calls only in `-m live`.
- **Directions:** never guess a direction; unresolved stays `null` (ADR 0005).
- **State:** a board is its URL (ADR 0003/0004). Do not add a database or accounts.
- **Commits/PRs:** Conventional Commits. Only push or open PRs when the maintainer asks; follow
  `~/git/personal/AGENTS.md` identity checks.
