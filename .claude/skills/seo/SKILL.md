---
name: seo
description: Runs Arlo's read-only weekly SEO audit suite (scripts/seo/) and reports the results — technical crawl (broken links, soft-404s, title/meta/canonical), GSC quick wins, Vercel traffic, local NAP consistency, and blog content gaps — combined into one dated report at reports/seo/YYYY-MM-DD.md with a paste-ready sheet row. Use when the user says "/seo", "run the SEO audit", "check for soft-404s", "SEO quick wins", "content gaps", "NAP check", or wants the weekly SEO report.
---

# /seo — Read-only SEO Audit Suite

This skill drives the `seo` sub-skills that live in `scripts/seo/` (executable
Node, same conventions as Arlo's `scripts/daily-audit.js`). Everything here is
**READ-ONLY**: it crawls/reads the site and read-only APIs and writes exactly
one file — the dated report under `reports/seo/`. It never edits, publishes, or
deploys the live site, and never touches `blog-autopublish.yml`.

Full docs, env vars, and how to attach n8n / GitHub Actions:
`scripts/seo/README.md`.

## When to use

- `/seo` or "run the SEO audit" / "weekly SEO report" → run the full audit.
- "check for soft-404s" / "did the redirect bug come back?" → `seo:technical`.
- "SEO quick wins" / "what's ranking 4–20?" → `seo:gsc`.
- "traffic since the move" → `seo:traffic`.
- "is our NAP consistent?" → `seo:nap`.
- "what blog posts are we missing?" / "feed the Blog Queue" → `seo:content-gap`.

## Procedure

### Full audit (default)

Run the entry command:

```bash
npm run seo:audit
```

It runs the five data sub-skills in sequence, writes `reports/seo/<today>.md`
(plain-English summary on top + week-over-week diff), and prints the
tab-separated **Weekly Analytics Log** row to stdout.

Then:
1. Read the generated `reports/seo/<today>.md`.
2. Relay the **Summary** section to the user (traffic ±, new soft-404s, top-5
   quick wins, posts to write) — plus anything CRITICAL/HIGH from the technical
   audit.
3. Give them the paste-ready TSV row for the sheet.
4. If any sub-skill **skipped**, tell the user which env var is missing (see the
   README table) — don't treat a skip as a failure.

### A single sub-skill

Run just the relevant one (each prints JSON) and summarize it:

```bash
npm run seo:technical      # or seo:gsc / seo:traffic / seo:nap / seo:content-gap
```

## Rules

- **Never** use this suite to change the site. If the user wants a fix applied
  (e.g. add a missing meta description), that's a separate task — use the normal
  branch-and-PR flow (`pr-flow`), not this skill.
- **Soft-404s are the priority finding** — they're the class of bug (Wix→Vercel
  catch-all) that dropped rankings 5→47 (PR #226). Surface them first.
- When the live site is unreachable from the run environment, the technical
  audit analyzes the checked-out build and says so; the live soft-404 *serving*
  probe only works where the live site is reachable (GitHub Actions / n8n).
- Missing API keys are expected in some environments — the run degrades, it
  doesn't fail. Report the degradation plainly.
