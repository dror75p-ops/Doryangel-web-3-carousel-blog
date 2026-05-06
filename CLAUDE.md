# DoryAngel Website — Project Memory

## Latest version
**Dori Angel Web.3 — Carousel Blog**

- GitHub repo: https://github.com/dror75p-ops/Doryangel-web-3-carousel-blog
- Live URL: https://dror75p-ops.github.io/Doryangel-web-3-carousel-blog/
- Owner GitHub account: dror75p-ops
- Owner email: office@doryangel.com (notification emails go to dror75p@gmail.com via Resend)

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
- `scripts/generate-post.js` — Auto-publish: Claude API → Unsplash → Resend email
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
- Cookie consent banner with Google Analytics 4 (`G-P8QR4VL8NH`) — only loads after Accept
- All animations + tracking fully GDPR-compliant

## Blog architecture (current)

- **3 categories**: `property-management`, `diy-property-management`, `investments`
- **Per-post URLs**: `/blog/[slug]/index.html` — Google-indexable
- **SEO per post**: `<title>`, meta description, canonical, Open Graph, Twitter Card, JSON-LD BlogPosting schema
- **Featured post** flag on JSON for the larger card on the index
- **Post page** has: full-width hero image, sticky CTA, markdown body, CTA block, "Continue reading" related posts (3 from same category)
- **Auto-publish workflow** runs `generate-post.js` → `build-blog.js` → commits all together every 3 days

### Post schema (current)

```jsonc
{
  "slug": "...",
  "title": "...",                  // question OR numbered, with city anchor
  "category": "property-management | diy-property-management | investments",
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
- **Resend** (`RESEND_API_KEY` secret): from `onboarding@resend.dev` to `dror75p@gmail.com` (free tier limit; verify doryangel.com domain to send to office@doryangel.com)
- **Unsplash** (`UNSPLASH_ACCESS_KEY` secret): per-category curated queries for cover images
- **GitHub** (`GH_TOKEN` secret): the bot's token for committing to main; needs `repo` + `workflow` scopes
- **Google Analytics 4** (`G-P8QR4VL8NH`): in `index.html`, gated by cookie consent
- **Retell AI + Make.com lead capture**: see section below

## Retell AI lead capture

AI phone agent "Hailey" ("Doryangel web chat lead") is reachable via the mobile "Call AI" button (`tel:+15167743249`). When a call ends, Retell fires a webhook to Make.com which logs the lead to Google Sheets and emails the owner.

### Architecture

```
Retell AI call ends / analyzed
  → webhook POST to Make.com
  → filter: call_ended OR call_analyzed only (call_started is dropped)
  → Google Sheets: append row to "DoryAngel Chat Leads" spreadsheet
  → Gmail: notify dror75p@gmail.com
```

### Make.com scenario

- **Name**: DoryAngel Chat — New Leads (scenario ID 5578524)
- **Webhook URL**: `https://hook.eu1.make.com/ii1kuc8ba6gk3yvs506ggrnutp6iwz4h`
- **Google Sheets**: spreadsheet ID `1druOTrJhRVhrbAPrGBWD8HtMNkxy-h-PiJcYEhGsuHk`, tab `Sheet1`
- **Both connections**: `office@doryangel.com` Google account

### Sheet columns (A–O)

| Col | Field | Source |
|-----|-------|--------|
| A | Timestamp | `{{now}}` |
| B | caller_role | dynamic variable |
| C | full_name | dynamic variable |
| D | callback_phone | dynamic variable |
| E | email_address | dynamic variable |
| F | property_address | dynamic variable |
| G | unit_details | dynamic variable |
| H | is_occupied | dynamic variable |
| I | current_mgmt | dynamic variable |
| J | is_urgent | dynamic variable |
| K | appointment_set | dynamic variable |
| L | chosen_slot | dynamic variable |
| M | chat_summary | call_analysis |
| N | chat_successful | call_analysis |
| O | user_sentiment | call_analysis |

### Notes

- Both `call_ended` and `call_analyzed` events pass the filter → **each call writes 2 rows and sends 2 emails**. The `call_ended` row has empty analysis columns (M–O); the `call_analyzed` row fills them in.
- Retell webhook events configured: `call_started`, `call_ended`, `call_analyzed` (started is dropped by filter)
- Column offset bug fixed 2026-05-06: mapper keys corrected from 1-indexed to 0-indexed so Timestamp lands in column A

## Cost (per blog post)

~$0.02-0.05/post (Opus 4.7), ~$2-3/month total

## Status (as of 2026-04-29)

This repo is now the **primary active design** and will replace the Wix website in the coming days.
- Hamburger mobile nav is live (merged PRs #11, #12, #13)
- Auto-publish blog pipeline running every 3 days
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
- Add `LocalBusiness` + `RealEstateAgent` JSON-LD schema to index.html
- Add breadcrumb JSON-LD to blog post pages
- Add `hreflang` if Spanish content is ever added (large Bronx audience)

### 4. Conversion / CRO
- A/B test hero headline: rotating vs. static (measure via GA4 events)
- Add a lead-capture form or exit-intent popup for free audit CTA
- Add social proof counters (Google review count, years in business) above the fold

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
