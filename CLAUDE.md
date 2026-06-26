# DoryAngel Website — Project Memory

## Latest version
**Dori Angel Web.3 — Carousel Blog**

- GitHub repo: https://github.com/dror75p-ops/Doryangel-web-3-carousel-blog
- Live URL (production): https://beta.doryangel.com/ — GitHub Pages served via the `beta.doryangel.com` custom domain. The raw `dror75p-ops.github.io/Doryangel-web-3-carousel-blog/` URL still resolves but is NOT canonical; use beta.doryangel.com for canonicals, sitemap, OG, and any in-app links to this site's own pages.
- Owner GitHub account: dror75p-ops
- Owner email: office@doryangel.com (notification emails go to dror75p@gmail.com via Resend)

### Last changes (as of 2026-05-17)

- **Digest topic segmentation, end-to-end** (2026-06-26): subscribers now pick interests at signup and only receive matching posts.
  - **Signup**: the Digest tool-gate modal (`index.html`) shows a Digest-only topic picker (the 4 blog categories) and POSTs a `topics` array to the Make signup webhook → stored in the subscriber sheet's `topic` column.
  - **Send**: `scripts/generate-post.js` → `notifyDigestSubscribers()` filters subscribers by exact topic-slug match (no-topics = gets all posts) and delivers via a new Make.com **Gmail** broadcast scenario — NOT Resend. The Resend sandbox domain (`onboarding@resend.dev`) only reaches the account owner, so the subscriber blast must go through Gmail (`office@doryangel.com`). Post links use canonical `beta.doryangel.com`.
  - Also relaxed the Digest signup filter to accept **email-only** signups (name optional) — previously no-name signups were silently dropped from both the sheet and the welcome email.
- **Bronx Landlord Tax Deduction Checklist lead magnet** (2026-06-26): `tax-checklist/index.html` (landing) + `tax-checklist/checklist.html` (28 deductions). Form posts to ONE backend — the Make.com "Tax Checklist" scenario (welcome email + owner notify + Google Sheet log). The homepage entry is a 4th `.tool-card` in the DIY toolkit grid (not a banner). Web3Forms was removed from this form to stop duplicate owner emails.
- **Flat-fee vs. % calculator landing page** (2026-06-26): new `flat-fee-vs-commission/index.html` — interactive savings calculator (units × rent × commission %), comparison table, 3 real Bronx examples (Mott Haven / Fordham / Riverdale), FAQ + FAQPage/BreadcrumbList JSON-LD, and a Web3Forms lead-capture form. Calculator is anchored to published pricing ($99/mo single unit, $199/mo flat for 2–10 units) — do NOT invent other numbers. Linked from the pricing section of `index.html` (a styled CTA card) and added to `sitemap.xml`. Consolidates Arlo issues #119/#125/#126/#127.
- **Removed**: Owner/Tenant Portal card widget from the hero section (the tab + ledger mockup). Merged via PR #43. Reason: it distracted from the primary lead-collection CTA flow.
- **Accessibility fixes** (merged PR #43): contact form labels linked to inputs via `for`/`id`; FAQ buttons now have `aria-expanded`; hero photo divs have `role="img"` + `aria-label`; blog carousel has `<noscript>` static fallback.
- **Logo promo flip** (pending PR): hamburger button removed from the flip animation — now always static. Logo flips every 5 seconds (first at 5s after load), shows promo for 3s, then flips back.

### Hosting status (as of 2026-06-26)

- **Production**: GitHub Pages served at **https://beta.doryangel.com/** (custom domain). This is the canonical live site — all canonicals/sitemap/OG and same-site links use `beta.doryangel.com`. (Separate micro-app tools — Compliance Calendar, Digest landing, AI Property Inspector, owner-portal-reports — keep their own `dror75p-ops.github.io/...` URLs; they are NOT pages on beta.doryangel.com.)
- **Vercel**: the owner also publishes to Vercel, but the Vercel deployment is **not** production yet. Treat any Vercel URL as preview/staging only until the owner explicitly says to flip.
- **Planned rename: `beta.doryangel.com` → `doryangel.com`** (apex). The owner's intent is that beta IS the production site and will simply be renamed to the apex once DNS is ready — same content, new hostname. Not done yet (apex DNS not pointed at the repo). Until then, keep EVERYTHING on `beta.doryangel.com` (do NOT pre-point anything at the apex — canonicals must reference the domain that actually serves the page).
- **Vercel**: the owner also publishes to Vercel, but the Vercel deployment is **not** production yet. Treat any Vercel URL as preview/staging only until the owner explicitly says to flip.

### Apex migration plan (run as ONE coordinated PR when apex DNS is live)

Because the whole repo is now uniformly on `beta.doryangel.com`, the rename is a single find-replace + a few infra steps. Do NOT do any of this piecemeal beforehand.

1. **Repo find-replace** `beta.doryangel.com` → `doryangel.com` everywhere. Touches: all root `*.html` canonicals/OG/Twitter, `sitemap.xml`, `robots.txt`, every `blog/[slug]/index.html` (regenerate via `scripts/build-blog.js` — bump `SITE_URL`, don't hand-edit), `scripts/social-post.js` (`BASE_URL`), `scripts/generate-post.js` (blog post URL + any links), and the **Make.com email templates** (welcome/broadcast/tax — they link to `beta.doryangel.com`). The separate micro-app `dror75p-ops.github.io/...` tool links are NOT part of this — leave them.
2. **301 redirect** `beta.doryangel.com/*` → `doryangel.com/*` — CRITICAL so SEO equity transfers instead of splitting. (If it's a GitHub Pages custom-domain *swap* rather than keeping both, confirm how redirects are handled at the DNS/Pages level.)
3. **Google Search Console** — "Change of address" beta → apex, then resubmit `sitemap.xml`.
4. **Resend** — verify `doryangel.com` as the sending domain (also lifts the sandbox-domain limit; lets owner email send from the brand domain).
5. Update this CLAUDE.md (Live URL + this section) once the flip is done.

Open question to confirm at migration time: is beta being *renamed* to the apex (custom-domain swap) or kept alive alongside it? That decides whether step 2 is a redirect rule or just a Pages setting.

## Workflow rules

**Push policy: branches + Pull Requests for any significant change.**
- Create branch `claude/<short-description>`
- Push commits there
- Open PR via `gh` / GitHub API
- Hand the PR URL to the user so they can review in the GitHub mobile app
- Wait for the user to merge before changes go live
- Exception: auto-publish workflow runs as the DoryAngel Bot and commits directly to main on its 3-day schedule
- Exception: trivial one-line tweaks if the user explicitly says "just push it"

## What's in this repo

- `index.html` — Full website (self-contained, all CSS inline, all JS inline at bottom)
- `blog-loader.js` — Renders blog cards on the home page; each card links to `/blog/[slug]/`
- `content/blog/posts-index.json` — Source of truth for all posts
- `scripts/generate-post.js` — Agent **Nave**: generates the post (Claude API → Unsplash) → writes `posts-index.json` → fires the topic-segmented digest broadcast (Make/Gmail) → Resend approval email to owner → hands a social queue to Vera
- `scripts/social-post.js` — Agent **Vera**: posts the new article to the Facebook Page (reads `/tmp/social-queue.json` from Nave). Does NOT touch subscribers.
- `scripts/build-blog.js` — Generates per-post HTML pages from the JSON
- `scripts/migrate-posts-once.js` — One-time schema migration (kept for reference)
- `scripts/refresh-images.js` — One-shot workflow to refresh all post hero images
- `blog/[slug]/index.html` — Auto-generated per-post pages (NEVER hand-edit; rerun build-blog.js)
- `.github/workflows/blog-autopublish.yml` — Cron-triggered every 3 days at 14:00 UTC
- `.github/workflows/refresh-images.yml` — Manual one-shot for image refresh
- `sitemap.xml`, `robots.txt` — SEO
- `.gitignore` — node_modules, .env, .DS_Store, logs, /tmp/

## Brand / design

- Brand colors: navy `#0F2847`, blue `#1E5AA8`, blue-light `#5B9FEA`, blue-dim `#EBF3FD`
- Fonts: DM Serif Display (headings) + DM Sans (body) — Google Fonts
- Tone: professional, trust-first, NYC-rooted

## Hero animations (the "top part")

- **Living Turtle**: walks in on load, breathes on a 5s loop, pops on hover
- **Rotating headline**: 3 value props cycle every 5s with fade
- **Rotating trust bar**: first chip cycles every 4s through 4 proof points
- **NYC photo cross-fade**: 4 bright NYC photos cycle every 6s at ~22% opacity behind the hero
- All animations honor `prefers-reduced-motion`

## Other site features

- Scroll-triggered fade-up reveals (IntersectionObserver) on hero, section titles, audience/pillars/pricing grids
- Hero stats count up from 0 when entering viewport
- Reviews carousel auto-scrolls every 5s when visible
- Cookie consent banner with Google Analytics 4 (`G-0W61NYHM78`) — only loads after Accept
- All animations + tracking fully GDPR-compliant

## Blog architecture (current)

- **4 categories**: `property-management`, `diy-property-management`, `investments`, `property-automation`
- **Per-post URLs**: `/blog/[slug]/index.html` — Google-indexable
- **SEO per post**: `<title>`, meta description, canonical, Open Graph, Twitter Card, JSON-LD BlogPosting schema
- **Featured post** flag on JSON for the larger card on the index
- **Post page** has: full-width hero image, sticky CTA, markdown body, CTA block, "Continue reading" related posts (3 from same category)
- **Auto-publish workflow** (`blog-autopublish.yml`, every 3 days): Nave (`generate-post.js`, also sends the topic-segmented digest) → `build-blog.js` → Vera (`social-post.js`, Facebook) → commit all to main. The digest broadcast needs no new secret (the Make webhook is a public URL); it reads subscribers via `GOOGLE_SA_KEY` (or public CSV fallback). Note: the digest fires before the post page is committed/deployed, so a clicked link can 404 for the ~1–2 min until GitHub Pages rebuilds — pre-existing, low-impact.

### Post schema (current)

```jsonc
{
  "slug": "...",
  "title": "...",                  // question OR numbered, with city anchor
  "category": "property-management | diy-property-management | investments | property-automation",
  "excerpt": "...",                // pain-point focused, 1-2 sentences
  "publishedDate": "2026-04-27",   // ISO date
  "minutesToRead": 5,
  "heroImage": "https://images.unsplash.com/...",
  "heroImageAlt": "...",           // required for SEO/a11y
  "hashtags": ["...", "..."],
  "featured": false,               // only one post should be true
  "seoTitle": "...",               // ≤60 chars, ends in "| DoryAngel"
  "seoDescription": "...",         // ≤155 chars
  "author": "DoryAngel Team",
  "content": "..."                 // markdown body
}
```

### Content rules (data-validated by real traffic)

- Title format: question OR numbered list, MUST include a NYC city
- Word count: 800-1,200 (below 500 = zero traffic)
- NYC-specific dollar figures or law/borough references required
- Tone: expert, trustworthy, practical
- No CTA in the body — auto-appended by build-blog.js
- Don't write generic AI-sounding pieces ("Power of Transparent Management Practices")

## Key integrations

- **Anthropic API** (`ANTHROPIC_API_KEY` secret): `claude-opus-4-7`, structured outputs, prompt caching
- **Resend** (`RESEND_API_KEY` secret): from `onboarding@resend.dev` — **owner-facing emails only** (Nave's approval email, daily-audit report) go to `dror75p@gmail.com`. The sandbox domain can ONLY reach the account owner, so it is NOT used for subscriber-facing email. Verify doryangel.com in Resend to lift this.
- **Unsplash** (`UNSPLASH_ACCESS_KEY` secret): per-category curated queries for cover images
- **GitHub** (`GH_TOKEN` secret): the bot's token for committing to main; needs `repo` + `workflow` scopes
- **Google Analytics 4** (`G-0W61NYHM78`): in `index.html`, gated by cookie consent (was `G-P8QR4VL8NH` before the beta.doryangel.com move, PR #79, 2026-06-16)
- **Retell AI + Make.com lead capture**: see section below

### Make.com scenarios (team 998919, org 6531616, eu1)

All subscriber-facing email is sent here via the **Gmail** connection (`office@doryangel.com`, conn 5113797) — reliable to any inbox. The **Google** connection (`office@doryangel.com`, conn 5113631) writes the sheets.

| Scenario | ID | Webhook (`hook.eu1.make.com/…`) | Does |
|---|---|---|---|
| DoryAngel Digest — New Subscriber | 5549170 | `2qo6r1tr15cckv1opo8em9x89ip3ku4x` | signup → sheet `1-9IDAD1…` + welcome email. Filter accepts **email-only** (name optional). Maps `topics` (col C). |
| DoryAngel Digest — New Post Broadcast | 6347243 | `rbh91p9c72r0qypeuhmjvlsey3hutzgr` | one POST per matched subscriber from `generate-post.js` → Gmail sends them the new post. **This is the recurring digest send.** |
| DoryAngel Tax Checklist — Download & Welcome Email | 6346876 | `l1ydothnj57j2ngk6952oam9wds2wgk1` | checklist signup → welcome email + owner notify + sheet `1KbVggQ…` (tagged `Tax Checklist`) |
| DoryAngel Chat — New Leads | 5578524 | (Retell) | see Retell section below |

Subscriber sheets are owned by `dror75p@gmail.com`, shared with `office@doryangel.com`. Digest subscribers: sheet `1-9IDAD1VmlnCvTdU3JqDWahjEFQaUFtRG-WayHZ9N8o` (cols: name, email, topic, date, active, address).

## Retell AI lead capture

AI **web chat** agent "Hailey" ("Doryangel web chat lead", agent ID `agent_88fd2bc14215e7210629dfafda`) is embedded on the website via the Retell chat widget. When a chat ends and is analyzed, Retell fires a `chat_analyzed` webhook to Make.com which logs the lead to Google Sheets and emails the owner.

The mobile "Call AI" button (`tel:+15167743249`) is a separate voice channel and is NOT connected to this Make.com scenario.

### Retell chat widget (index.html)

Embedded just before `</body>`:
```html
<!-- Retell AI Chat Widget — Hailey lead capture -->
<script
  id="retell-widget"
  src="https://dashboard.retellai.com/retell-widget.js"
  type="module"
  data-public-key="public_key_274f92a0516ded273d147"
  data-agent-id="agent_88fd2bc14215e7210629dfafda"
  data-title="Chat with Hailey"
  data-color="#1E5AA8"
  data-bot-name="Hailey"
  data-popup-message="Hi! I'm Hailey — ask me anything about DoryAngel's property management."
  data-show-ai-popup="true"
  data-show-ai-popup-time="8"
></script>
```

**Important**: Retell simulation mode does NOT fire webhooks. Only real chat sessions (widget on the live site) fire real `chat_analyzed` webhooks.

### Architecture

```
Retell chat ends + analyzed
  → webhook POST to Make.com (event_type = "chat_analyzed")
  → filter: chat_analyzed only (chat_started and chat_ended are dropped)
  → Google Sheets: append row to "DoryAngel Chat Leads" spreadsheet
  → Gmail: notify dror75p@gmail.com
```

### Make.com scenario

- **Name**: DoryAngel Chat — New Leads (scenario ID 5578524)
- **Webhook URL**: `https://hook.eu1.make.com/ii1kuc8ba6gk3yvs506ggrnutp6iwz4h`
- **Google Sheets**: spreadsheet ID `1druOTrJhRVhrbAPrGBWD8HtMNkxy-h-PiJcYEhGsuHk`, tab `Sheet1`
- **Both connections**: `office@doryangel.com` Google account

### Sheet columns (A–O)

All 14 lead fields are configured in Retell as **Post-Chat Data Extraction**. For a **chat agent**, the correct Make.com path is `{{1.chat.chat_analysis.custom_analysis_data.FIELD}}` — NOT `call.call_analysis.*`.

| Col | Field | Make.com expression |
|-----|-------|---------------------|
| A | Timestamp | `{{now}}` |
| B | caller_role | `{{1.chat.chat_analysis.custom_analysis_data.caller_role}}` |
| C | full_name | `{{1.chat.chat_analysis.custom_analysis_data.full_name}}` |
| D | callback_phone | `{{1.chat.chat_analysis.custom_analysis_data.callback_phone}}` |
| E | email_address | `{{1.chat.chat_analysis.custom_analysis_data.email_address}}` |
| F | property_address | `{{1.chat.chat_analysis.custom_analysis_data.property_address}}` |
| G | unit_details | `{{1.chat.chat_analysis.custom_analysis_data.unit_details}}` |
| H | is_occupied | `{{1.chat.chat_analysis.custom_analysis_data.is_occupied}}` |
| I | current_mgmt | `{{1.chat.chat_analysis.custom_analysis_data.current_mgmt}}` |
| J | is_urgent | `{{1.chat.chat_analysis.custom_analysis_data.is_urgent}}` |
| K | appointment_set | `{{1.chat.chat_analysis.custom_analysis_data.appointment_set}}` |
| L | chosen_slot | `{{1.chat.chat_analysis.custom_analysis_data.chosen_slot}}` |
| M | chat_summary | `{{1.chat.chat_analysis.custom_analysis_data.chat_summary}}` |
| N | chat_successful | `{{1.chat.chat_analysis.custom_analysis_data.chat_successful}}` |
| O | user_sentiment | `{{1.chat.chat_analysis.custom_analysis_data.user_sentiment}}` |

### Filter

Only `chat_analyzed` events trigger the pipeline (`chat_started` and `chat_ended` are dropped). This guarantees one row per chat with all post-chat extraction fields populated.

### Gmail notification

- **To**: `dror75p@gmail.com`
- **Subject**: `New Chat Lead — {{1.chat.chat_analysis.custom_analysis_data.full_name}} ({{1.chat.chat_analysis.custom_analysis_data.caller_role}})`

### History of bugs fixed 2026-05-06

1. **Column offset**: mapper keys were 1-indexed instead of 0-indexed, so Timestamp landed in column B and everything was shifted right. Fixed.
2. **Wrong data source path**: Fields were being read from `retell_llm_dynamic_variables.*` — but this agent uses Post-Chat Data Extraction, which writes to `custom_analysis_data.*`. Fixed.
3. **Duplicate rows**: Filter passed both `call_ended` and `call_analyzed`, creating 2 rows per chat. Fixed: `chat_analyzed` only.
4. **Wrong event name**: Filter used `call_analyzed` but chat agents fire `chat_analyzed`. Fixed.
5. **Wrong payload root key**: Make.com paths used `1.call.call_analysis.*` but chat agent payloads use `1.chat.chat_analysis.*`. Confirmed via 4-path debug email test — Path A (`chat.chat_analysis`) had all real data. Fixed.

### History of bugs fixed 2026-06-23

6. **Built-in analysis fields pathed one level too deep**: `chat_summary` (col M), `chat_successful` (col N), and `user_sentiment` (col O) were mapped to `1.chat.chat_analysis.custom_analysis_data.<field>` — but these three are Retell **built-in** analysis fields, siblings of `custom_analysis_data`, not children. They returned null on every row, so column N (the success signal) was always blank and Hailey's success rate was unmeasurable. Fixed in both the Sheets mapper and the Gmail body to `1.chat.chat_analysis.<field>` (no `.custom_analysis_data`). The 14 custom-extraction fields stay under `custom_analysis_data` — only these three reserved built-ins moved. Verify: run one real chat that gives a name + phone/email; column N should now read TRUE/FALSE.

## Cost (per blog post)

~$0.02-0.05/post (Opus 4.7), ~$2-3/month total

## Status (as of 2026-06-17)

This repo is now the **primary active design** and will replace the Wix website in the coming days.
- Hamburger mobile nav is live (merged PRs #11, #12, #13)
- Auto-publish blog pipeline running every 3 days
- Daily website audit automation live (PR #87) — runs every 9 AM EST, auto-fixes + creates GitHub Issues
- Microsoft Clarity live (ID `x7y1bk4fhc`, consent-gated)
- LocalBusiness + RealEstateAgent JSON-LD schema live in `<head>`
- Client testimonials section added (PR #85)
- GitHub Pages live at the URL above; custom domain switch pending

## Improvement roadmap (exposure / SEO)

Priority order for next sessions:

### 1. Custom domain
- Point doryangel.com → GitHub Pages (CNAME record + Pages settings)
- Verify doryangel.com in Resend so approval emails go to office@doryangel.com
- Update canonical URLs and sitemap.xml once domain is live

### 2. Content velocity
- Import the 10 priority posts from the developer guide (real-traffic-tested topics)
- Consider bumping auto-publish to every 2 days (change cron in blog-autopublish.yml)
- Add an `investments` and `diy-property-management` featured post (currently likely missing)

### 3. Technical SEO
- Submit sitemap to Google Search Console (already verified)
- ~~Add `LocalBusiness` + `RealEstateAgent` JSON-LD schema to index.html~~ ← **DONE** (in `<head>`)
- Add breadcrumb JSON-LD to blog post pages
- Add `hreflang` if Spanish content is ever added (large Bronx audience)

### 4. Conversion / CRO
- A/B test hero headline: rotating vs. static (measure via GA4 events)
- Add a lead-capture form or exit-intent popup for free audit CTA ← **DONE 2026-05-18** (Elfsight FOMO widget added)
- Add social proof counters (Google review count, years in business) above the fold
- ~~Add Microsoft Clarity heatmaps + session recording~~ ← **DONE** (tracking ID `x7y1bk4fhc`, consent-gated via `loadClarity()` in the cookie script)

### 5. Performance
- Compress the base64 logo image in index.html — it is ~80KB inline and delays first paint
- Add `loading="lazy"` to below-fold images
- Consider splitting the single 2,400-line index.html into partials built at deploy time

### 6. Off-page / distribution
- Set up Google Business Profile posts linked to each new blog post
- Auto-share new posts to LinkedIn / Facebook (extend generate-post.js)
- Build backlinks: submit to NYC landlord forums, Bronx community boards, BiggerPockets

## Outstanding / nice-to-have

- Verify doryangel.com in Resend so emails can go to office@doryangel.com directly
- Import the 10 priority posts from the developer guide (real-traffic-tested topics)
- Custom domain (doryangel.com) for the new repo if/when ready
- Compress the base64 logo (largest single byte cost in index.html)

## Previous versions / reference

- Doeryangelweb.2 — design prototype (in `project/` folder of this repo)
- dror75p-ops/Doryangel-website — original main website repo
- dror75p-ops/Doryangel.web.google.studio.v3 — earlier version
