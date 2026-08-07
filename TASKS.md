# DoryAngel — Website Task List

Living list of outstanding work. Newest status: **2026-08-07**.

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
| 1 | **Rotate the Web3Forms access keys.** Create a new key per form in the Web3Forms dashboard, send the values, they get swapped in, **then** delete the old key — that order, or all 8 forms break. | ~10 min | **This is what actually stops the inbox spam.** The current key is public in the page source, so bots POST directly and never load the site. No code change can stop that. |
| 2 | **Request re-indexing of the homepage** in Search Console (paste `https://www.doryangel.com/`, click Request Indexing). | 30 sec | Cuts the wait on the new title from weeks to days. |
| 3 | **Turn off GitHub Pages** — repo → Settings → Pages → **Source: None**. | ~1 min | Production has been on Vercel since 2026-07-07, but Pages still rebuilds and serves a stale duplicate of the whole site at `dror75p-ops.github.io/Doryangel-web-3-carousel-blog/` on every push. Verified safe: **zero** references to that URL anywhere on the site, no `CNAME`, and the other github.io micro-sites are different repos. |
| 4 | **Read the Page indexing counts** in Search Console (Indexing → Pages) and send a screenshot. | 1 min | The report lists `Discovered - not indexed`, `Crawled - not indexed` and `Duplicate, Google chose different canonical` — but the **counts were never read**. Three trivial pages and a third of the site look identical until you do. Probably the highest-value unanswered SEO question. |
| 5 | Verify `doryangel.com` in Resend. | ~10 min | Lifts the sandbox-sender restriction so agent email comes from the brand domain. Long-standing item. |
| 6 | Set budget caps on Make.com and Anthropic. | ~5 min | Cost safety. Long-standing item. |

**No longer needed:** resubmitting `sitemap.xml`. Verified 2026-08-06 — submitted 07-24, last read 08-05, **65 discovered pages**, "processed successfully". Nothing was ever wrong with it.

---

## 📅 Waiting on a date — no action needed

| Date | What happens |
|---|---|
| **~2026-08-09** | The forced maintenance-post run finishes (`category-plan.json` hits 0) and normal category variety resumes by itself. *(Checked 2026-08-05: `remaining` is 2, not 0 — the earlier ~08-05 estimate was based on the manual-dispatch burst and was too aggressive. Two posts left at the 2-day cadence.)* |
| **~2026-08-30** | **Decision point.** Check Arlo's email: has `bronx property management` moved off **~20**? If not, the homepage title was not the constraint — go to backlinks or a Google Business Profile rather than iterating on wording. Baseline: 75 clicks / 5,460 impressions / 1.37% CTR. |

**Do not stack SEO changes before that date.** The whole point of the rank tracking is attribution; changing several things at once makes the result unreadable.

**Rank check 2026-08-05** (3 days after the title change, into a 28-day rolling window — far too early to attribute anything):

| | 07-31 | 08-05 |
|---|---|---|
| Site clicks | 75 | **85** |
| Site impressions | 5,460 | **6,036** |
| Site avg position | 29.6 | 29.5 |
| `bronx property management` | 19.9 | **24.6** |

Volume is up ~13% and average position is flat. The one term that moved meaningfully is `bronx property management`, down 4.7 — but **it was already sliding before the title merged** (19.9 → 20.5 on 08-01), and 3 days can only weight ~11% of a 28-day average, so the title is very unlikely to be the cause. The other three tracked terms moved 0.2–0.5, which is noise. **Watch, do not act.**

---

## 🧹 Open pull requests — a backlog worth triaging

As of 2026-08-05 there are **6 open PRs**, some since mid-July. Worth a pass:

- **#266 — should be CLOSED, do not merge.** It adds `<input name="_honey">` to the contact form. `_honey` is FormSubmit.co's field name; **Web3Forms uses `botcheck`**, which `index.html` already has on that form. Merging it adds a non-functional field that Web3Forms treats as ordinary data and **mails to the owner on every lead**. It also edits the same `CLAUDE.md` line as #278, so the two conflict.
- **#278** — this task list + the do-not-do warnings. *(Merging this is what puts these notes where the next session finds them.)*
- **#279** — one-word `keepalive` guard on the contact form's Make webhook.
- **#283 — MERGED 2026-08-06.** Phase 1 audit fixes. *(Lesson from it: it conflicted with two auto-published posts while open. Generated `blog/*/index.html` files are never hand-merged — merge main, keep the branch's `scripts/build-blog.js`, then re-run it. Auto-publish fires on odd days, so PRs touching those files should be merged quickly.)*
- **#260, #229** — not reviewed; open since July.

---

## 🔧 Code work — ready to pick up any time

Roughly in order of value per unit of risk.

- [ ] **Add owner-notify + a sheet row to Make scenario 6335620**, additively, after its existing filter. No code change. Owner briefly gets two alerts per lead — a loud, safe failure mode — and it removes the single point of failure on a public key. *Prerequisite for ever removing Web3Forms.*
- [ ] **Fix the honeypot field on 5 forms.** They use `_honey`, which is FormSubmit.co's convention — Web3Forms uses `botcheck`, so those forms have **zero** honeypot protection today. Correct in `index.html:2211`, `:2262`, `tax-checklist/index.html:376`, `flat-fee-vs-commission/index.html:596`, `guides/bronx-landlord-compliance/index.html:652`. Only `index.html:4889` is right.
- [ ] **Add `turnstile.reset()` to the contact form's error paths** (`index.html` ~5146 and ~5150). The tool gate does this; the contact form doesn't. Low severity today, becomes severe if Web3Forms ever validates the token.
- [ ] **Add `/tools/pl-dashboard/` to the sitemap.** It is the **paid** ($29.99) tool and it is unindexed. Must be fixed in **both** `buildSitemap()` (`scripts/build-blog.js`) and `sitemap.xml`, or the next Nave run reverts a file-only edit.
- [ ] **Fix the `/tools` 404 landmine.** `scripts/generate-post.js:411` tells the model to write "free at doryangel.com/tools" into posts, but there is no `tools/index.html` and no rewrite. No post has emitted it yet — harmless today, broken the day one does. Cheapest fix is a `/tools` → `/#tools` redirect in `vercel.json`.
- [ ] **Fix one truncated meta description.** `why-your-bronx-rentals-insurance-premium-could-jump-25-this` ends mid-word: `"…and how to fight ba"`. Only one of 56; renders verbatim in Google.
- [ ] **Repoint one old github.io link.** `content/blog/posts-index.json:66` still links the retired Compliance Calendar URL, sending backlink credit to the personal subdomain the migration existed to retire.
- [ ] **Update the tax checklist from 2025 to 2026.** `tax-checklist/index.html` title, meta description and H1 all advertise the prior tax year, as does the homepage tool card (`index.html:3213`, "Updated for 2025"). It is August 2026, so a live lead magnet is presenting itself as abandoned. Four strings — but **first ask the owner whether the 28 deductions still hold for the 2026 tax year**; changing only the number would be worse than leaving it. Owner deferred this on 2026-08-05.
- [ ] **Fix the hashtag chip overflowing the viewport on mobile.** A `.hashtag-row` chip sits ~9px past the right edge at 390px on **every** post page, causing horizontal scroll. Confirmed pre-existing (reproduced against the pre-change commit), so it is not a regression from the 2026-08-05 hero work. Likely one `flex-wrap` line in `scripts/build-blog.js`; regenerates all 58 pages.
- [ ] **Add a sentence-shape rule to Nave's prompt** if the forced-category run is ever repeated. Six of the last eight titles opened `"Your Bronx Building's …"`; only category and subject are constrained, not shape.

---

## 🅿️ Parked deliberately — ask before reviving

- **`/areas/` neighborhood pages.** Fully built, then dropped at owner request. Two findings worth keeping if revived: the competitor's "80–800 pages" figure is the part that would trigger a Google penalty, and the model must write prose but never facts. Note `index.html` still claims 5 neighborhoods in `areaServed` with no pages behind them.
- **Google Business Profile.** Probably the largest remaining local-SEO lever, and the natural next move if the title change doesn't land. Mostly owner time, not code.
- **Comparison / DIY pillar hubs.** Same pattern as the compliance hub; deprioritised by the owner.

---

## ✅ Recently shipped

- **2026-08-06** — Phase 1 audit of the owner's improvement plan, and its two approved fixes (PR #283). The compliance guide's four unlabelled lead-form inputs now have real labels — the same defect fixed on `flat-fee-vs-commission` in July, which had never propagated across the shared shell. And all 58 blog pages got the homepage's load fixes they never received: fonts off the critical path, `preconnect` to `fonts.gstatic.com` and `images.unsplash.com`, and the LCP hero converted from a CSS background to a real `<img>` with `srcset` and a preload. Measured: mobile now fetches the 640w image where it used to take 1200w.
- **2026-08-02** — Homepage title retargeted at the Bronx queries (PR #276). Four lines in `<head>`; nothing visible changed.
- **2026-07-31** — Google Search Console rank tracking added inside Arlo, not as a new agent. Runs daily, commits history to `project/seo/rank-history.json`.
- **2026-07-31** — Arlo no longer reports the daily digest as sent when Resend rejected it.
