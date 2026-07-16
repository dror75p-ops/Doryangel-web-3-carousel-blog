# Arlo — SEO Audit Suite (`seo_doryangel`)

> The skill group and its npm commands are named **`seo_doryangel`**. The code
> lives in `scripts/seo/` and reports in `reports/seo/` (those directory paths
> are unchanged).

A **read-only**, weekly SEO audit suite that extends Arlo (DoryAngel's automation
agent, `scripts/daily-audit.js`). It crawls the site, pulls read-only analytics,
checks local-SEO consistency, finds content gaps, and writes one dated report to
`reports/seo/`.

It exists to catch the class of bug that hurt us in the Wix→Vercel migration
(a catch-all redirect that soft-404'd old URLs and dropped rankings from
position 5 → 47, fixed in PR #226) **early**, and to track recovery
week-over-week.

## Hard rules (by design)

- **READ-ONLY.** Nothing here writes to, edits, publishes to, or deploys the
  live site. The only file it writes is the report under `reports/seo/`.
- **No secrets in code.** Every key is read from an environment variable. A
  missing key makes that one sub-skill **skip gracefully** and note it in the
  report — the run never crashes.
- It does **not** touch `blog-autopublish.yml` or any publish/deploy workflow.

## The sub-skills

| # | Sub-skill | What it reports | Needs |
|---|-----------|-----------------|-------|
| 1 | `technical-audit` | broken links (w/ source page), **soft-404s** (200-but-homepage / wrong canonical — prioritized), missing/dup title & meta, canonical/OG mismatch, orphan pages | nothing (crawls the live site; falls back to the checked-out build if the site is unreachable) |
| 2 | `gsc-quickwins` | queries at position 4–20 with CTR < ~3% (quick wins) + cannibalization (2+ of our URLs on one query) | `GOOGLE_SA_KEY`, `GSC_SITE_URL` |
| 3 | `traffic-report` | sessions, top pages, % change vs. previous period (Vercel Analytics — **GA4 is intentionally not used**) | `VERCEL_ANALYTICS_TOKEN`, `VERCEL_PROJECT_ID` |
| 4 | `local-nap` | Name/Address/Phone consistency vs. canonical, in our own build + external listings | nothing (external listings need `NAP_LISTINGS`) |
| 5 | `content-gap` | ranked blog topics we have no page for, for the Blog Queue | nothing (`ANTHROPIC_API_KEY` optional, sharpens titles) |
| 6 | `reporter` | combines 1–5 into the dated report + the sheet paste-row + week-over-week diff | nothing |

## Running it

Full audit (runs 1–5, then writes the report):

```bash
npm run seo_doryangel:audit
```

Each sub-skill also runs standalone and prints JSON:

```bash
npm run seo_doryangel:technical      # node scripts/seo/technical-audit.js
npm run seo_doryangel:gsc
npm run seo_doryangel:traffic
npm run seo_doryangel:nap
npm run seo_doryangel:content-gap
npm run seo_doryangel:report         # re-render the report (gathers results itself, or pass a results.json path)
```

Output:
- `reports/seo/YYYY-MM-DD.md` — the dated report (plain-English summary on top).
- The full audit also prints the **tab-separated sheet row** to stdout:
  `date  sessions  unique_visitors  forms  top_quick_win_keyword  issues_found`
  — paste it straight into the **Weekly Analytics Log** tab.

## Environment variables

All optional — a missing one skips just that sub-skill.

| Var | Used by | Notes |
|-----|---------|-------|
| `GOOGLE_SA_KEY` | gsc-quickwins | Service-account JSON (raw or base64). **Same secret Arlo already uses for GA4.** The service account must be added as a *user* on the GSC property. |
| `GSC_SITE_URL` | gsc-quickwins | GSC property, e.g. `https://www.doryangel.com/` or `sc-domain:doryangel.com`. Default: the www URL-prefix. |
| `VERCEL_ANALYTICS_TOKEN` (or `VERCEL_TOKEN`) | traffic-report | Vercel access token with analytics read. |
| `VERCEL_PROJECT_ID` | traffic-report | The project id/name. |
| `VERCEL_TEAM_ID` | traffic-report | Optional (team-scoped projects). |
| `VERCEL_ANALYTICS_URL` | traffic-report | Optional override of the stats endpoint if your plan differs. |
| `ANTHROPIC_API_KEY` | content-gap | Optional — sharpens the top gap titles into Nave's owner-facing format. Falls back to deterministic titles. |
| `NAP_LISTINGS` | local-nap | Optional JSON: `[{"source":"Google Business Profile","url":"https://..."}]`. Without it, a manual-verify checklist of the major directories is emitted. |
| `SEO_BASE_URL` | all | Default `https://www.doryangel.com`. |
| `SEO_CRAWL_MODE` | technical-audit | `auto` (default) / `live` / `local`. |
| `SEO_MAX_PAGES` | technical-audit | Crawl cap (default 400). |
| `SEO_PERIOD_DAYS` | traffic-report | Comparison window (default 28). |

Local dev: put these in an untracked `.env` (already git-ignored) and load it
however you prefer, or export them in your shell. **Never commit real keys.**

## Attaching a trigger later (no code change)

The audit is a plain Node entry point, so any scheduler can wrap it.

### GitHub Actions (cron)

A ready-to-enable example lives at
[`.github/workflows/seo-audit.yml.disabled`](../../.github/workflows/seo-audit.yml.disabled).
It is **disabled on purpose** (the `.disabled` extension means GitHub ignores
it). To turn it on: rename it to `seo-audit.yml`, add the secrets above to the
repo, and commit. It runs `npm run seo_doryangel:audit` and commits the report (it never
touches the site or the publish workflow).

### n8n

Add an **Execute Command** node (or a CI step) that runs:

```bash
npm ci && npm run seo_doryangel:audit
```

with the env vars set on the node. Then a follow-up node can read
`reports/seo/<date>.md` / the printed TSV row and post it wherever you like
(email, Slack, a Google Sheet append). n8n only *reads* the produced report —
the suite itself still writes nothing but the report.

## Notes

- **`forms` in the sheet row** is `n/a` — form-submission counts live in the
  Make/Sheets lead pipeline, not in this read-only suite. Fill it in by hand, or
  wire it later from Arlo's existing `getMakeStats()` if you want it automated.
- When the live site is unreachable from the run environment (e.g. a sandbox
  with a restrictive egress policy), `technical-audit` analyzes the **checked-out
  build** instead and says so in the report. The live-only soft-404 *serving*
  probe is skipped in that case — run it from GitHub Actions / n8n (direct
  egress) for the real check.
