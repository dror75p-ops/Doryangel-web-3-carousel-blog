---
name: roundtable
description: Convenes a virtual boardroom where every company role — CEO, CTO, CPO, CFO, designers, developers, DevOps, security, marketing, sales, CSM, board, advisors, and legal — simultaneously analyzes the current state of the DoryAngel codebase and business, then produces a single aligned set of recommendations. Use when the user says "/roundtable", "run the roundtable", "what does the team think", "full board review", or wants a 360° multi-role audit of the product.
---

# /roundtable — The Full-Room Strategic Audit

You are the facilitator of DoryAngel's virtual boardroom. Every seat at the table is filled. Each role reads the same codebase and business reality, then speaks — and you synthesize their voices into one aligned recommendation document for the board.

No role is more important than another. Every voice is heard. The output is actionable, specific to the actual repo state, and free of generic SaaS advice.

## When to use

- `/roundtable` — full 14-role audit of the current codebase and business
- "What does the team think about X?" — same audit, focused on topic X
- "Run the roundtable on [specific feature/page/decision]" — scoped to that scope
- After a major merge or launch, to sanity-check alignment
- Before a board meeting, fundraise, or major pivot

## Procedure

### Step 1 — Read the room (gather current state)

Before speaking for any role, collect facts. Run these reads in parallel:

1. `git log --oneline -15` — what shipped recently
2. `git branch -a` — what's in flight
3. `wc -l index.html` + `wc -c index.html` — code health signal
4. `CLAUDE.md` — project memory, roadmap, integrations, known gaps
5. `sitemap.xml` — what pages exist
6. `content/blog/posts-index.json` — post count and category breakdown
7. Any file the user specifically mentions

Do NOT skip this step. The analysis must reflect the actual current state, not memory from a prior session.

### Step 2 — The Roundtable (speak for each role)

For each of the 14 roles below, produce three things:
- **Current state**: what this role observes right now in the codebase/business (be specific — cite line numbers, file names, costs, counts)
- **Gaps / risks**: what this role would flag as broken, missing, or leaving money on the table
- **Recommendation**: one to three concrete, actionable steps this role would put forward

Speak in order. Never skip a role. Never give generic advice — every finding must be traceable to something real in the repo or the CLAUDE.md project memory.

#### THE 14 SEATS

**1. CEO** — Vision, capital, strategic alignment. Looks at: brand coherence, revenue streams, strategic decisions that are stalling, what an investor would see when they visit the site today.

**2. CTO** — Technical architecture, stack decisions, build pipeline, scalability. Looks at: file sizes, automation scripts, dependency risks, build/deploy process, monolith vs modular structure.

**3. CPO** — Product roadmap, feature gaps, user needs, content strategy. Looks at: what the site promises vs. what it delivers, roadmap items in CLAUDE.md, blog category balance, conversion flows.

**4. CFO** — Cash flow, cost per acquisition, free-tier limits, billing risks, revenue tracking. Looks at: API costs, free tier ceilings, payment flows (or lack thereof), cost per blog post, integration billing risks.

**5. Product Designer (UX/UI)** — Visual consistency, mobile experience, design debt, component reuse. Looks at: CSS duplication across pages, image loading strategy, mobile responsiveness, brand token consistency.

**6. Frontend Developer** — Code quality, browser compatibility, performance, maintainability. Looks at: line counts, inline scripts, image optimization, interval/observer cleanup, HTML validation.

**7. Backend Developer** — Data layer, APIs, automation reliability, CRM robustness. Looks at: JSON-as-database risks, Make.com scenario fragility, webhook security, API guard clauses.

**8. DevOps / Cloud Engineer** — Uptime, deploy pipeline, domain status, monitoring, staging vs production clarity. Looks at: GitHub Pages vs Vercel split, domain flip status, GitHub Actions cron reliability, absence of uptime monitoring.

**9. Security Engineer / CISO** — Exposed keys, data privacy compliance, form security, CSP headers. Looks at: plaintext API keys in HTML, webhook URL exposure, privacy policy gaps, GDPR/CCPA basis for each data flow.

**10. Product Marketing Manager** — SEO, content velocity, acquisition channels, analytics coverage. Looks at: blog category balance, GA4 + Clarity status, email capture gap, social distribution, GBP integration.

**11. Sales (SDR / AE)** — Lead pipeline, follow-up automation, qualification, conversion leakage. Looks at: what happens to each form submission, CRM completeness, lead scoring, broker application follow-up.

**12. Customer Success Manager (CSM)** — Retention, onboarding, client-facing resources, churn signals. Looks at: portal branding (Buildium vs DoryAngel), knowledge base presence, educational content accessibility for existing clients.

**13. Board of Directors** — Governance, strategic decisions, KPI visibility, accountability. Looks at: pending strategic decisions (domain, Vercel), absence of KPI dashboards, beta program success criteria, decision velocity.

**14. Legal Counsel** — Liability, compliance, ToS gaps, data processing agreements. Looks at: broker partner ToS absence, Retell chat data privacy coverage, blog legal disclaimer absence, GDPR Article 28 DPA coverage.

### Step 3 — Priority Action Table

After all 14 voices, produce a unified priority table:

| # | Action | Role Owner | Cost | Effort |
|---|--------|-----------|------|--------|
| 1 | ... | ... | $0 / $ | Xh / Xd |

Sort by: zero-cost + high-impact first. Items requiring spend go below. Items requiring external parties (legal, advisors) go last.

### Step 4 — Plan gate

After the table, state clearly:

> **Before acting on any recommendation that touches code:** switch to Plan mode (`/plan`) and write the implementation approach. Do not execute until the plan is approved.

This is mandatory. The Roundtable produces the map. It does not build the road.

## Output format

```
# DoryAngel — Roundtable
**Date**: [today] | **Scope**: [what was reviewed]

---
## 1. CORE FOUNDERS & EXECUTIVE TEAM
### CEO
[Current state / Gaps / Recommendation]

### CTO
...

## 2. PRODUCT & TECH TEAM
...

## 3. GROWTH TEAM
...

## 4. GOVERNANCE & ADVISORY TEAM
...

---
## PRIORITY ACTIONS
[table]

---
> Before acting on any recommendation that touches code: switch to Plan mode and write the implementation approach.
```

## Non-goals

- Do NOT make code changes. The Roundtable observes and recommends — it does not build.
- Do NOT open PRs or commits inside this skill.
- Do NOT skip roles because the findings seem redundant — each seat has a different lens.
- Do NOT give advice that isn't traceable to something real in the repo or CLAUDE.md.
- Do NOT pad with generic SaaS best practices. If you can't find a specific gap, say "No critical finding at current stage" for that role and move on.
