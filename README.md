# DoryAngel — Web 3, Carousel Blog

The **live production website** for DoryAngel Property Management, Bronx NY.

- **Production:** https://www.doryangel.com/ — served by Vercel since the DNS cutover on 2026-07-07
- **Owner:** dror75p-ops

## 👉 Read `CLAUDE.md` first

**`CLAUDE.md` is the source of truth for this repo** — architecture, the three automation agents, integrations, credentials-by-reference, and a long list of hard-won gotchas that will cost you hours if you rediscover them yourself. Read it before changing anything.

## ⚠️ This README used to say something else

It was the auto-generated handoff README from a Claude Design export, and it instructed coding agents to treat **`project/index.html`** as "the primary design they want built."

**That is no longer true, and following it would be a mistake.** `project/` holds the superseded *Doeryangelweb.2* prototype. It is kept for reference only, is excluded from deployment via `.vercelignore`, and must not be used as a source of truth for anything.

The real site is **`index.html`** at the repo root — a single self-contained file with all CSS and JS inline.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The entire website. All CSS and JS inline. ~310KB. |
| `blog/<slug>/index.html` | **Generated.** Never hand-edit — re-run `scripts/build-blog.js`. |
| `content/blog/posts-index.json` | Source of truth for every blog post. |
| `guides/`, `faq/`, `tax-checklist/`, `flat-fee-vs-commission/`, `tools/` | Standalone landing pages on a shared shell. |
| `scripts/` | The automation agents and build scripts (not deployed). |
| `project/seo/rank-history.json` | Daily Google Search Console snapshots. Committed, never deployed. |
| `project/`, `chats/` | Superseded design prototype and its transcripts. Reference only, not deployed. |
| `vercel.json` | 163 redirects (the old Wix URLs) + security headers. |

## The three agents

There are exactly **three**, and that is deliberate — a proposal to add a fourth and fifth was rejected in favour of extending these:

| Agent | Script | Does |
|---|---|---|
| **Nave** | `scripts/generate-post.js` | Writes and publishes a blog post every 2 days, emails the owner, fires the subscriber digest. |
| **Arlo** | `scripts/daily-audit.js` | Daily site audit + auto-fixes + a report email covering GA4 traffic, leads, Clarity behaviour and Google Search Console rankings. |
| **Vera** | `scripts/social-post.js` | Posts each new article to the Facebook Page via Make. |

## Working on this repo

- Branch as `claude/<short-description>`, push, open a PR, and let the owner merge. See the `pr-flow` skill.
- `scripts/lib/__verify__/*.js` are offline checks — no network, no writes. Run them after touching anything in `scripts/lib/`.
- The sandbox has no `ANTHROPIC_API_KEY` and restricted network, so the agents cannot be run locally. Exercise them with `workflow_dispatch`, using each workflow's `dry_run` input first.
