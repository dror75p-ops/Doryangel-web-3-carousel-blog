# DoryAngel Website — Project Memory

## Project identity

**Dori Angel Web.3 — Carousel Blog**

- GitHub repo: https://github.com/dror75p-ops/Doryangel-web-3-carousel-blog
- Live URL: https://dror75p-ops.github.io/Doryangel-web-3-carousel-blog/
- Owner: dror75p-ops | dror75p@gmail.com (notification emails) | office@doryangel.com (business)

## Hosting status (as of 2026-06-20)

- **Production**: GitHub Pages at the URL above. Canonical live site.
- **Vercel**: preview/staging only — NOT production until owner explicitly says to flip.
- **Custom domain (doryangel.com)**: not yet pointed at this repo. Pending.

### Domain migration checklist — do ALL in one PR, never piecemeal

When owner says "move to Vercel" or "go live on doryangel.com":
- `index.html` — form `redirect` field + `<link rel="canonical">` + Open Graph URLs
- `thank-you.html`, `privacy.html`, `terms.html`, `disclaimer.html`, `sms-consent.html` — each canonical
- `sitemap.xml` — all URLs
- `robots.txt` — sitemap reference
- `scripts/build-blog.js` — update base URL constant and rerun (do NOT hand-edit blog/ pages)
- Resend — re-verify doryangel.com domain for new sending address

## Workflow rules

**Push policy: branches + Pull Requests for any significant change.**
- Create branch `claude/<short-description>`
- Push commits there
- Open PR via GitHub API
- Hand the PR URL to the user so they can review in the GitHub mobile app
- Wait for the user to merge before changes go live
- Exception: auto-publish workflow (DoryAngel Bot) commits directly to main on its 3-day schedule
- Exception: trivial one-line tweaks if the user explicitly says "just push it"

## What's in this repo

- `index.html` — Full website (self-contained, all CSS + JS inline)
- `blog-loader.js` — Renders blog cards on the home page; each card links to `/blog/[slug]/`
- `content/blog/posts-index.json` — Source of truth for all posts
- `scripts/generate-post.js` — Auto-publish agent Nave: Claude API → Unsplash → Resend email
- `scripts/build-blog.js` — Generates per-post HTML pages from the JSON
- `scripts/migrate-posts-once.js` — One-time schema migration (keep for reference, do not rerun)
- `scripts/refresh-images.js` — One-shot workflow to refresh all post hero images
- `blog/[slug]/index.html` — Auto-generated per-post pages (NEVER hand-edit; rerun build-blog.js)
- `.github/workflows/blog-autopublish.yml` — Cron every 3 days at 14:00 UTC
- `.github/workflows/refresh-images.yml` — Manual one-shot for image refresh
- `sitemap.xml`, `robots.txt` — SEO

## Brand / design

- Colors: navy `#0F2847`, blue `#1E5AA8`, blue-light `#5B9FEA`, blue-dim `#EBF3FD`
- Fonts: DM Serif Display (headings) + DM Sans (body) — Google Fonts
- Tone: professional, trust-first, NYC-rooted
- Hero: Living Turtle (walks in, breathes 5s loop), rotating headline (5s), rotating trust bar (4s), NYC photo cross-fade (6s). All honor `prefers-reduced-motion`.
- Scroll-triggered fade-up reveals (IntersectionObserver); hero stats count up on viewport entry; reviews carousel auto-scrolls 5s; cookie consent gates GA4 (`G-P8QR4VL8NH`) and Clarity (`x7y1bk4fhc`).

## Blog architecture

- **4 categories**: `property-management`, `diy-property-management`, `investments`, `property-automation`
- **Per-post URLs**: `/blog/[slug]/index.html` — Google-indexable
- **SEO per post**: `<title>`, meta description, canonical, Open Graph, Twitter Card, JSON-LD BlogPosting schema
- **Post page**: full-width hero image, sticky CTA, markdown body, CTA block, 3 related posts (same category)
- **Auto-publish**: `generate-post.js` → `build-blog.js` → commits together every 3 days

### Post schema fields

slug · title (question or numbered, must include NYC city) · category (4 options above) · excerpt (pain-point, 1-2 sentences) · publishedDate (ISO) · minutesToRead · heroImage (Unsplash URL) · heroImageAlt · hashtags · featured (only one post true at a time) · seoTitle (≤60 chars, ends "| DoryAngel") · seoDescription (≤155 chars) · author · content (markdown)

### Content rules (data-validated by real traffic)

- Title: question OR numbered list, MUST include a NYC city/borough
- Word count: 800–1,200 (below 500 = zero traffic)
- NYC-specific dollar figures or law/borough references required
- Tone: expert, trustworthy, practical
- No CTA in the body — auto-appended by build-blog.js
- Don't write generic AI-sounding pieces ("Power of Transparent Management Practices")

## Key integrations

- **Anthropic API** (`ANTHROPIC_API_KEY`): `claude-opus-4-7`, structured outputs, prompt caching
- **Resend** (`RESEND_API_KEY`): from `onboarding@resend.dev` to `dror75p@gmail.com` (free tier; verify doryangel.com to send to office@doryangel.com)
- **Unsplash** (`UNSPLASH_ACCESS_KEY`): per-category curated queries for cover images
- **GitHub** (`GH_TOKEN`): bot token for committing to main; needs `repo` + `workflow` scopes
- **Google Analytics 4** (`G-P8QR4VL8NH`): in `index.html`, gated by cookie consent
- **Microsoft Clarity** (`x7y1bk4fhc`): consent-gated via `loadClarity()` in cookie script
- **Retell AI + Make.com**: see section below

## Retell AI lead capture

AI web chat agent **Hailey** (agent ID `agent_88fd2bc14215e7210629dfafda`, public key `public_key_274f92a0516ded273d147`) embedded via Retell widget just before `</body>` in `index.html`. On chat end, Retell fires `chat_analyzed` webhook → Make.com → Google Sheets + Gmail.

**Important**: Retell simulation mode does NOT fire webhooks. Only live widget sessions do.

The mobile "Call AI" button (`tel:+15167743249`) is a separate voice channel, NOT connected to this scenario.

### Make.com scenario

- **Name**: DoryAngel Chat — New Leads (scenario ID `5578524`)
- **Webhook**: `https://hook.eu1.make.com/ii1kuc8ba6gk3yvs506ggrnutp6iwz4h`
- **Google Sheets**: ID `1druOTrJhRVhrbAPrGBWD8HtMNkxy-h-PiJcYEhGsuHk`, tab `Sheet1`
- **Connection account**: `office@doryangel.com`
- **Filter**: `chat_analyzed` only — `chat_started` and `chat_ended` are dropped (one row per chat)
- **14 fields** (cols A–O): Timestamp → caller_role → full_name → callback_phone → email_address → property_address → unit_details → is_occupied → current_mgmt → is_urgent → appointment_set → chosen_slot → chat_summary → chat_successful → user_sentiment
- **Path pattern**: `{{1.chat.chat_analysis.custom_analysis_data.FIELD_NAME}}` (NOT `call.call_analysis.*`)
- **Gmail subject**: `New Chat Lead — {{1.chat.chat_analysis.custom_analysis_data.full_name}} ({{1.chat.chat_analysis.custom_analysis_data.caller_role}})`

## Nave — Blog Auto-Publish Agent

Named **Nave** (`AGENT_NAME = 'Nave'` in `scripts/generate-post.js` line 9).

Current state (post 2026-06-20 fixes):
- Approval email → `dror75p@gmail.com` (was wrongly set to `office@doryangel.com`)
- Workflow gracefully exits if nothing to commit (no false failure on duplicate runs)

### Nave email output

Every approval email includes a Facebook-ready post with all 5 tool links:

```
📅 Compliance Calendar (free) → https://dror75p-ops.github.io/Doryangel-preventive-maintenance-schedule.automation/
📬 DoryAngel Digest (free) → https://dror75p-ops.github.io/Doryangel-preventive-maintenance-schedule.automation/digest/
🔍 AI Property Inspector (free) → https://dror75p-ops.github.io/Transcribe_meeting/
📊 Property P&L Dashboard ($29) → https://beta.doryangel.com/tools/pl-dashboard/
🤝 Broker Partner Program ($50/unit/mo) → https://beta.doryangel.com/broker-partner.html
```

- Broker-partnerships posts: Broker Partner link moves to TOP
- Most relevant tool gets ★ highlight

## Social Media — Facebook Posting (current plan)

**Current**: Publer free tier — manual copy-paste from Nave email → Publer → DoryAngel Facebook Page.
Limits: 3 accounts, 10 scheduled posts/account/month (tight at 3-day cadence).
**Upgrade path**: Ayrshare ($29/mo) — REST API wires directly into `generate-post.js` for fully automatic posting including Google My Business.

## QA Checklist — Joy & Rafael

Google Sheet for non-technical testers checking beta.doryangel.com:
- **URL**: https://docs.google.com/spreadsheets/d/1QVjHZec8VJc-lxcqG6dWZ7jFlR-idxAjTTN2KDLb3uE/edit
- 43 items across 10 sections (Page Load, Navigation, Content, Forms, Tools & Links, Blog, Chat, Contact & Social, Legal Pages, Overall)
- Columns: #, Section, Task, Joy ✅❌⚠️, Joy Notes, Rafael ✅❌⚠️, Rafael Notes

## Cost

~$0.02–0.05/post (claude-opus-4-7), ~$2–3/month total

## Status (as of 2026-06-20)

- Auto-publish blog pipeline running every 3 days
- Daily website audit automation live — runs 9 AM EST, auto-fixes + creates GitHub Issues
- LocalBusiness + RealEstateAgent JSON-LD schema live in `<head>`
- Client testimonials section live
- Microsoft Clarity + GA4 live (both consent-gated)
- GitHub Pages live; custom domain (doryangel.com) switch pending

## Improvement roadmap

### 1. Custom domain
- Point doryangel.com → GitHub Pages (CNAME + Pages settings)
- Verify doryangel.com in Resend → enables sending to office@doryangel.com
- Update canonical URLs and sitemap.xml once live

### 2. Content velocity
- Import the 10 priority posts from the developer guide (real-traffic-tested topics)
- Consider bumping auto-publish to every 2 days (change cron in blog-autopublish.yml)
- Add `investments` and `diy-property-management` featured posts

### 3. Technical SEO
- Add breadcrumb JSON-LD to blog post pages
- Add `hreflang` if Spanish content added (large Bronx audience)

### 4. Conversion / CRO
- A/B test hero headline: rotating vs. static (measure via GA4 events)
- Add social proof counters (Google review count, years in business) above the fold

### 5. Performance
- Compress the base64 logo in index.html (~80KB inline, delays first paint)
- Add `loading="lazy"` to below-fold images

### 6. Off-page / distribution
- Set up Google Business Profile posts per blog post ← **IN PROGRESS** (Publer free, manual)
- Auto-share to Facebook/LinkedIn ← **IN PROGRESS** (Nave generates caption; upgrade to Ayrshare for automation)
- Build backlinks: NYC landlord forums, Bronx community boards, BiggerPockets
