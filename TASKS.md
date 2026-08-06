# DoryAngel — Website Task List

Living list of outstanding work. Newest status: **2026-08-06**.

`CLAUDE.md` holds the *reasoning and history*; this file holds *what's left to do*. Tick items off here and move the detail there when something ships.

---

## 🛑 Do NOT do these

**Do not follow the Turnstile fix described in CLAUDE.md's 2026-06-28 entry** (add the secret to Web3Forms, then remove `data.delete('cf-turnstile-response')`). A review on 2026-08-02 found it ships a **worse bug**: Turnstile tokens are single-use, so Web3Forms would redeem the token and Make's own check would then fail with `timeout-or-duplicate`, silently stopping **every** visitor confirmation email. It also needs a paid Web3Forms plan, and the access key is shared by 8 forms so it cannot be scoped to one. Full reasoning in `CLAUDE.md`.

**Do not remove the Web3Forms POST from the contact form** without first adding an owner-notify step to Make. Scenario 6335620 emails the *visitor*, not the owner — Web3Forms is currently the **only** thing that tells the owner a lead arrived.

**Do not re-propose** neighborhood `/areas/` pages, a rank-tracking agent, or putting the $99 price back in the homepage title. All three were decided deliberately; see `CLAUDE.md`.

---

## 👤 Needs the owner (nobody else can do these)

| | Task | Time | Why it matters |
|---|---|---|---|
| 0 | **🆕 Open the `dror75p-ops.github.io/Doryangel-web-3-carousel-blog/` GSC property and read its impressions.** Then decide: near zero → turn Pages off at repo → Settings → Pages → Source: None. Not zero → leave it and tell the next session, because the decision changes. **Do not switch Pages off before reading that property.** | ~5 min | Measured 2026-08-06: that URL returns **200** — GitHub Pages is serving a **full live duplicate of the site**. It is invisible to `sc-domain:doryangel.com`, so no rank data has ever seen it. Its canonicals point at www, which has limited the damage, but it is a second live copy competing during the consolidation window. **This is the only new blocker; everything else below is unchanged.** |
| 1 | **Rotate the Web3Forms access keys.** Create a new key per form in the Web3Forms dashboard, send the values, they get swapped in, **then** delete the old key — that order, or all 8 forms break. | ~10 min | **This is what actually stops the inbox spam.** The current key is public in the page source, so bots POST directly and never load the site. No code change can stop that. |
| 2 | **Request re-indexing of the homepage** in Search Console (paste `https://www.doryangel.com/`, click Request Indexing). | 30 sec | Cuts the wait on the new title from weeks to days. |
| 3 | Verify `doryangel.com` in Resend. | ~10 min | Lifts the sandbox-sender restriction so agent email comes from the brand domain. Long-standing item. |
| 4 | Set budget caps on Make.com and Anthropic. | ~5 min | Cost safety. Long-standing item. |

---

## 📅 Waiting on a date — no action needed

| Date | What happens |
|---|---|
| **~2026-08-07** | The forced maintenance-post run finishes (`category-plan.json` hits 0) and normal category variety resumes by itself. *(Checked 2026-08-06 after that day's post: `remaining` is **1**. The cron fires on odd days, so the next scheduled post — 08-07 — is the last forced one.)* |
| **~2026-08-30** | **Decision point.** Check Arlo's email: has `bronx property management` moved off **~20**? If not, the homepage title was not the constraint — go to backlinks or a Google Business Profile rather than iterating on wording. Baseline: 75 clicks / 5,460 impressions / 1.37% CTR. |

**Do not stack SEO changes before that date.** The whole point of the rank tracking is attribution; changing several things at once makes the result unreadable.

**Rank check 2026-08-06** (4 days after the title change, into a 28-day rolling window — still far too early to attribute anything):

| | 07-31 | 08-05 | 08-06 |
|---|---|---|---|
| Site clicks | 75 | 85 | **85** |
| Site impressions | 5,460 | 6,036 | **6,072** |
| `bronx property management` | 19.9 | 24.6 | **25.0** |

`bronx property management` has now gone 19.9 → 20.5 → 22.8 → 23.5 → 25.0 — **drifting the wrong way, and it was already sliding before the title merged**. Do not read it as the title hurting: consecutive snapshots share 27 of 28 days, which is exactly the confound the series files exist to remove. **Watch, do not act.**

**🆕 But this no longer has to be guesswork.** Arlo's first real series run (2026-08-06) put **478 days of true per-day history** on disk in `project/seo/daily-series.json` + `query-series.json`, with `annotations.json` as the matching change log. **Answering this properly from the per-day data is the single highest-value analysis task now available** — see the code list below.

**Host split, 2026-08-06:** www **4,309** impr @ **34.0** · apex **1,358** @ **6.2** · beta **1,123** @ **27.1**. Versus 08-03 (www 2,510 @ 47.7 · apex 1,355 @ 5.9 · beta 68 @ 11.2): www is genuinely improving, apex is flat at the local-pack signature, and **beta jumped ~16×**. Beta redirects correctly per-path (measured), so that is Google serving more beta URLs, not a fault. **Watch the beta number.**

---

## 🧹 Open pull requests — a backlog worth triaging

As of 2026-08-06 there are **3 open PRs** — #266, #278 and #283/#284 have all been resolved since the last pass:

- **#279** — one-word `keepalive` guard on the contact form's Make webhook. Cheap and self-describing; the PR body is honest that it guards a plausible race rather than fixing a measured defect.
- **#260** — docs-only; records the Nave maintenance-pivot dry run. Open since 2026-07-26.
- **#229** — docs-only; GA4 bounce-rate follow-up. Open since 2026-07-17, and its premise ("traffic too thin to conclude") is now stale given the 478-day series.

**Unmerged branch, no PR opened:** `claude/agent-nave-2re5c3` carries two `CLAUDE.md` commits from 2026-08-06 — the measured host check + the github.io finding, and Arlo's first-run verification. **Nothing depends on it, but the github.io finding lives there and nowhere else on `main`.**

---

## 🔧 Code work — ready to pick up any time

Roughly in order of value per unit of risk.

- [ ] **🆕 Answer the `bronx property management` question from the per-day series instead of the rolling snapshots.** `project/seo/daily-series.json` (per-day clicks/impressions/position, split by host) + `query-series.json` (per-day, per-watch-term) + `annotations.json` (change log from `git log`) now hold **478 days**. The 28-day snapshots cannot attribute a move to a cause — that is why these files exist. **Do this before the ~08-30 decision point**, so that decision rests on a measurement rather than an inference. Also worth asking the same data: what actually drove beta from 68 to 1,123 impressions.
- [ ] **🆕 Bump `actions/checkout@v4` and `actions/setup-node@v4` to `@v5`** across all six workflows. Run logs now warn they target Node 20 and are being **force-run on Node 24**. Nothing is broken yet; this is pre-emptive, and it stops the warning drowning real annotations.
- [ ] **🆕 Wire up or delete `hasBreadcrumbInBlog`.** `scripts/daily-audit.js:120` is a **hardcoded `false`** with the comment "checked separately in build-blog.js", so every audit prints it as a failing check. Breadcrumb JSON-LD **is** present on blog pages (verified 2026-08-06). It reads like a regression in every daily email.
- [ ] **Add owner-notify + a sheet row to Make scenario 6335620**, additively, after its existing filter. No code change. Owner briefly gets two alerts per lead — a loud, safe failure mode — and it removes the single point of failure on a public key. *Prerequisite for ever removing Web3Forms.*
- [ ] **Fix the honeypot field on 5 forms.** They use `_honey`, which is FormSubmit.co's convention — Web3Forms uses `botcheck`, so those forms have **zero** honeypot protection today. Correct in `index.html:2211`, `:2262`, `tax-checklist/index.html:376`, `flat-fee-vs-commission/index.html:596`, `guides/bronx-landlord-compliance/index.html:652`. Only `index.html:4889` is right.
- [ ] **Add `turnstile.reset()` to the contact form's error paths** (`index.html` ~5146 and ~5150). The tool gate does this; the contact form doesn't. Low severity today, becomes severe if Web3Forms ever validates the token.
- [ ] **Add `/tools/pl-dashboard/` to the sitemap.** It is the **paid** ($29.99) tool and it is unindexed. Must be fixed in **both** `buildSitemap()` (`scripts/build-blog.js`) and `sitemap.xml`, or the next Nave run reverts a file-only edit.
- [ ] **Fix the `/tools` 404 landmine.** `scripts/generate-post.js:411` tells the model to write "free at doryangel.com/tools" into posts, but there is no `tools/index.html` and no rewrite. No post has emitted it yet — harmless today, broken the day one does. Cheapest fix is a `/tools` → `/#tools` redirect in `vercel.json`.
- [ ] **Fix one truncated meta description.** `why-your-bronx-rentals-insurance-premium-could-jump-25-this` ends mid-word: `"…and how to fight ba"`. Only one of 56; renders verbatim in Google.
- [ ] **Repoint one old github.io link.** `content/blog/posts-index.json:66` still links the retired Compliance Calendar URL, sending backlink credit to the personal subdomain the migration existed to retire.
- [ ] **Add a sentence-shape rule to Nave's prompt** if the forced-category run is ever repeated. Six of the last eight titles opened `"Your Bronx Building's …"`; only category and subject are constrained, not shape.

---

## 🅿️ Parked deliberately — ask before reviving

- **`/areas/` neighborhood pages.** Fully built, then dropped at owner request. Two findings worth keeping if revived: the competitor's "80–800 pages" figure is the part that would trigger a Google penalty, and the model must write prose but never facts. Note `index.html` still claims 5 neighborhoods in `areaServed` with no pages behind them.
- **Google Business Profile.** Probably the largest remaining local-SEO lever, and the natural next move if the title change doesn't land. Mostly owner time, not code.
- **Comparison / DIY pillar hubs.** Same pattern as the compliance hub; deprioritised by the owner.

---

## ⚠️ Known-good, so nobody re-debugs it

**A job that dies at exactly 15:01 with `runner_id: 0`, no steps and no logs is a GitHub runner-allocation failure, not a bug here.** On 2026-08-06 this killed 4 runs (Arlo ×3, Nave ×1) plus GitHub's own Pages build ×3. `actions/checkout` never runs, so no script in this repo can be involved. **The recovery is simply to re-dispatch.** Both agents were re-run unchanged that evening and passed in 3m51s and 38s. Commit `e93a6ea` misdiagnosed this as a hanging Google `fetch` — its timeouts are fine to keep, but they did not fix it. Full reasoning in `CLAUDE.md`.

---

## ✅ Recently shipped

- **2026-08-06** — Host consolidation measured for real from a runner (`host-check.yml`): all 8 redirects correct, beta deep paths preserved, `/tenants` live. Found the github.io duplicate (owner item 0 above).
- **2026-08-06** — Arlo's rank-series code had its first live run: **478 days backfilled**, no empty-query-series warning. The "93% of impressions are address lookups" claim is now dead — commercial terms are **2,443** impressions to address lookups' **30**.
- **2026-08-02** — Homepage title retargeted at the Bronx queries (PR #276). Four lines in `<head>`; nothing visible changed.
- **2026-07-31** — Google Search Console rank tracking added inside Arlo, not as a new agent. Runs daily, commits history to `project/seo/rank-history.json`.
- **2026-07-31** — Arlo no longer reports the daily digest as sent when Resend rejected it.
