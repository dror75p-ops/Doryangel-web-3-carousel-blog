// generate-post.js — Auto-generates a DoryAngel blog post and emails it for approval

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { readFileSync, writeFileSync } from 'fs';
import { createSign } from 'crypto';
import { generateSlug, toISODate, wordsToMinutes, searchUnsplashPhotos, pickImageQuery } from './lib/post-utils.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });
const resend = new Resend(process.env.RESEND_API_KEY);
const AGENT_NAME = 'Nave';
const APPROVAL_EMAIL = 'dror75p@gmail.com';

// Fallback topics used if AI topic selection fails
// Ordered owner-first: the round-robin fallback (existingPosts.length % length)
// should keep the mix skewed toward the owner-facing property-management /
// maintenance topics that actually earn search traffic. Automation & broker are
// kept for occasional coverage only.
//
// NOTE (2026-07-26): the `diy-property-management` category slug now means
// "Maintenance & Repairs" everywhere it is DISPLAYED. The slug itself is kept
// as-is on purpose — it is baked into published post URLs' article:section, the
// blog filter tabs, and the digest signup topic values — exactly the same
// display-name-≠-slug arrangement as /guides/bronx-landlord-compliance/.
// Do NOT "fix" the slug to say maintenance.
const FALLBACK_TOPICS = [
  // --- property-management (owner-facing) ---
  { title: 'The Top 3 Mistakes Bronx Landlords Make Managing Their Own Properties', category: 'property-management' },
  { title: 'What Should a Bronx Property Manager Actually Do for You?', category: 'property-management' },
  { title: 'Flat-Fee PM in the Bronx: What $99/Unit Actually Means', category: 'property-management' },
  { title: 'How Much Is Inefficient Management Costing Your Bronx or Queens Rental?', category: 'property-management' },
  { title: 'What Bronx Landlords Need to Know About HPD Lead Paint Rules', category: 'property-management' },
  { title: '4 Signs Your Bronx Rental Property Needs Professional Management', category: 'property-management' },
  { title: 'How to Screen Bronx Tenants Without Getting Sued', category: 'property-management' },
  { title: 'What Should a Bronx Landlord Expect From a Property Manager for $99 a Unit?', category: 'property-management' },
  { title: 'How Much Rent Are You Losing to Slow Tenant Turnover in Your Bronx Building?', category: 'property-management' },
  { title: 'How Do You Switch Property Managers in the Bronx Without Losing a Month of Rent?', category: 'property-management' },
  { title: "What Do You Do When a Bronx Tenant Stops Paying Rent?", category: 'property-management' },
  { title: 'What Does a Bronx Lease Need to Include to Actually Protect You in 2026?', category: 'property-management' },
  { title: 'How Many Hours a Month Does Self-Managing a Bronx Rental Really Take?', category: 'property-management' },
  // --- diy-property-management = MAINTENANCE & REPAIRS (see note above) ---
  // Hands-on building-care topics explained in plain English. The compliance /
  // legal / leasing angles that used to live here moved to property-management.
  { title: 'How Do You Get a Bronx Boiler Through Heat Season Without an HPD Complaint?', category: 'diy-property-management' },
  { title: 'What Should a Bronx Landlord Actually Check on the Roof Every Spring?', category: 'diy-property-management' },
  { title: '7 Bronx Building Repairs Worth Doing Yourself — and 5 You Should Never Touch', category: 'diy-property-management' },
  { title: 'How Do You Find and Price a Reliable Bronx Contractor Without Getting Overcharged?', category: 'diy-property-management' },
  { title: "What Belongs on Your Bronx Building's Fall Maintenance Walkthrough?", category: 'diy-property-management' },
  { title: 'Why Does the Same Bronx Radiator Keep Failing? A Plain-English Look at What Goes Wrong', category: 'diy-property-management' },
  { title: 'How Do You Stop a Small Bronx Leak From Becoming a $12,000 Ceiling Repair?', category: 'diy-property-management' },
  // Comparison / self-manage-vs-hire are proven traffic winners but they are
  // owner-economics posts, not building-care posts — they live in
  // property-management now that this category means Maintenance & Repairs.
  { title: 'Bronx vs. Mount Vernon: Where Do Landlords Actually Keep More of Their Rent?', category: 'property-management' },
  { title: 'Should You Self-Manage Your Bronx Rental or Hire Flat-Fee Management? A Real Cost Breakdown', category: 'property-management' },
  // --- investments (occasional) ---
  { title: 'Is Buying a Rental Property in the Bronx Still a Good Investment?', category: 'investments' },
  { title: '3 Bronx Neighborhoods With the Best Rental ROI in 2026', category: 'investments' },
  { title: 'How Much Cash Flow Should a Bronx Multi-Family Actually Produce in 2026?', category: 'investments' },
  { title: 'Bronx vs. Yonkers: Which Rental Market Actually Pays Owners More in 2026?', category: 'investments' },
  { title: 'Bronx vs. New Rochelle: Where Does Your Rental Investment Actually Go Further?', category: 'investments' },
  // --- property-automation (sparing) ---
  { title: '5 Smart Sensors Every Bronx Landlord Should Install in 2026', category: 'property-automation' },
  { title: 'How AI Security Cameras Are Reducing Vacancy Crimes in NYC Rental Buildings', category: 'property-automation' },
  // --- broker-partnerships (sparing) ---
  { title: 'How Do Bronx Real Estate Brokers Earn Referral Income After the Deal Closes?', category: 'broker-partnerships' },
  { title: '5 Signs Your Bronx Investor Client Needs a Property Manager — Not Just a New Agent', category: 'broker-partnerships' },
];

const CATEGORIES = [
  'property-management',
  'diy-property-management',
  'investments',
  'property-automation',
  'broker-partnerships',
];

// FORCE_CATEGORY pins today's post to one category, overriding both the picker's
// own weighting and the HARD VARIETY RULE. Used from the workflow_dispatch
// `category` input when a run needs to land in a specific bucket (e.g. "the last
// post wasn't a maintenance post — run a maintenance one"). Empty = normal.
function getForcedCategory() {
  const raw = (process.env.FORCE_CATEGORY || '').trim();
  if (!raw) return null;
  if (!CATEGORIES.includes(raw)) {
    console.warn(`FORCE_CATEGORY="${raw}" is not a known category — ignoring. Valid: ${CATEGORIES.join(', ')}`);
    return null;
  }
  return raw;
}

function getSeason(month) {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
}

// Clarity per-category attention signal: pulls last-3-day scroll depth +
// engagement per blog URL, maps each URL to its post category, and aggregates
// so Nave can lean toward the categories that actually hold readers. Consent-
// gated + 3-day window = thin data, so the picker is told to treat it as
// directional and ignore tiny samples. Returns null when the token is absent.
async function getClarityCategorySignals(existingPosts) {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) {
    console.log('Clarity: CLARITY_API_TOKEN not set — engagement signal skipped');
    return null;
  }
  try {
    const res = await fetch(
      'https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3&dimension1=URL',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Clarity ${res.status}`);
    const data = await res.json();

    const byName = {};
    for (const m of data) byName[m.metricName] = m.information || [];

    const catBySlug = {};
    for (const p of existingPosts) catBySlug[p.slug] = p.category;
    const catForUrl = (u) => {
      const m = (u || '').match(/\/blog\/([^/]+)\/?/);
      return m ? catBySlug[m[1]] : null;
    };

    const agg = {}; // category -> { scrollSum, scrollN, engSec, sessions }
    const bump = (c) => (agg[c] = agg[c] || { scrollSum: 0, scrollN: 0, engSec: 0, sessions: 0 });
    for (const r of (byName.ScrollDepth || [])) {
      const c = catForUrl(r.Url);
      if (c && r.averageScrollDepth != null) { const a = bump(c); a.scrollSum += r.averageScrollDepth; a.scrollN += 1; }
    }
    for (const r of (byName.EngagementTime || [])) {
      const c = catForUrl(r.Url); if (c) bump(c).engSec += +(r.totalTime || 0);
    }
    for (const r of (byName.Traffic || [])) {
      const c = catForUrl(r.Url); if (c) bump(c).sessions += +(r.totalSessionCount || 0);
    }

    const categories = Object.entries(agg)
      .map(([category, v]) => ({
        category,
        avgScroll: v.scrollN ? Math.round(v.scrollSum / v.scrollN) : null,
        engSec: v.engSec,
        sessions: v.sessions,
      }))
      .filter(c => c.sessions > 0 || c.avgScroll != null)
      .sort((a, b) => (b.avgScroll || 0) - (a.avgScroll || 0));

    if (!categories.length) {
      const urlRows = (byName.Traffic || []).length || (byName.ScrollDepth || []).length;
      console.log(`Clarity: API OK but 0 blog-category signals (raw URL rows: ${urlRows}) — likely thin data post-Vercel-move (2026-07-07) or no blog traffic in the 3-day window`);
      return null;
    }
    return { windowDays: 3, categories };
  } catch (err) {
    console.warn(`Clarity topic signals failed: ${err.message}`);
    return null;
  }
}

async function pickTopicWithAI(existingPosts, claritySignals, avoidNote = null) {
  const today = toISODate(new Date());
  const season = getSeason(new Date().getMonth() + 1);
  const recentTitles = existingPosts.slice(0, 10).map(p => `- ${p.title}`).join('\n') || 'None yet';
  const forcedCategory = getForcedCategory();

  const engagementLine = claritySignals && claritySignals.categories.length
    ? claritySignals.categories
        .map(c => `${c.category} ${c.avgScroll != null ? c.avgScroll + '% scroll' : 'no scroll data'} (${c.sessions} sess)`)
        .join(', ')
    : null;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Today is ${today} (${season}). Suggest one blog post topic for Bronx landlords.

Recent posts to avoid repeating:
${recentTitles}

Rules:
- Geography: anchor every title to the Bronx as the primary location. Two natural extensions are allowed: (a) a second adjacent NYC borough (Queens or Manhattan) when it reads naturally — e.g. "...Your Bronx or Queens Rental?"; (b) a Bronx-vs-adjacent-area COMPARISON, a proven high-traffic format — the "Bronx vs. Mount Vernon" comparison was one of the best-performing posts. Mount Vernon (the Westchester city bordering the Bronx) is allowed ONLY inside a Bronx-anchored comparison, never as the sole location. Never use a non-Bronx borough or city as the sole anchor.
- COMPARISON FORMAT IS THE TOP PERFORMER — lean into it: the Bronx-vs-adjacent-area comparison (and self-manage-vs-hire comparisons) has been our single best-performing shape by real traffic. Aim for roughly 1 in every 3-4 posts to use a head-to-head comparison ("Bronx vs. Mount Vernon", "Bronx vs. Yonkers", "Bronx vs. New Rochelle", "Self-Managing vs. Flat-Fee Management") whenever a natural angle exists for today's category — don't save it for only rare occasions.
- WINNING TITLE FORMULA (validated by real traffic): lead with the OWNER'S pain or cost and address the owner directly with "you"/"your". Include a concrete number, dollar figure, or NYC law. These outperform service-description titles. Head-to-head comparisons ("X vs. Y", "Is A cheaper than B?") perform especially well — especially owner-facing self-manage-vs-hire and Bronx-vs-neighboring-area angles.
  Gold-standard examples to emulate the SHAPE of:
    • "How Much Is Inefficient Management Costing Your Bronx or Queens Rental?"
    • "Bronx vs. Mount Vernon: Where Do Landlords Actually Keep More of Their Rent?"  (proven high-traffic comparison shape)
    • "Should You Self-Manage Your Bronx Rental or Hire Flat-Fee Management? A Real Cost Breakdown"
    • "How to Screen Tenants in NYC Without Getting Sued"
    • "Flat-Fee PM in the Bronx: What $99/Unit Actually Means"
  Avoid generic, geo-less, marketing-speak titles (these got zero traffic): "Maximizing Returns with Management Investment Strategies", "The Power of Transparent Management Practices".
- Title must be a question OR start with a number — but VARY the opening word. Do NOT start with "Are", "Is", "Can", or "How" if more than one of the last 5 titles already uses that word
- Address a real landlord pain point; use seasonal relevance where fitting
- Category must be exactly one of: property-management, diy-property-management, investments, property-automation, broker-partnerships
- CATEGORY PREFERENCE (data-driven by real search traffic): the site's organic clicks come almost entirely from owner-facing "property management bronx" searches. Weight new topics accordingly:
    • "diy-property-management" IS OUR MAINTENANCE & REPAIRS CATEGORY (the slug is legacy — it is displayed as "Maintenance & Repairs"). Use it for hands-on building care: heating and boilers, roofs and facades, plumbing and leaks, pests, seasonal walkthroughs, hiring and pricing contractors, what to inspect and when, what to document. This is a PRIORITY direction for the blog right now.
    • DEFAULT to "property-management" or "diy-property-management" (maintenance) — pick one of these unless a genuinely strong angle in another category fits this season. These are the categories that actually convert.
    • Target roughly 1 in every 3 posts as a maintenance ("diy-property-management") post so building-care coverage builds up steadily.
    • Use "investments" occasionally, when a concrete Bronx ROI / market / rent-vs-buy angle fits the season.
    • Use "property-automation" or "broker-partnerships" only sparingly and only for a genuinely fresh angle — automation targets a speculative audience and broker posts target agents (not the owners who convert), so do NOT default to them.
    • HARD VARIETY RULE — this one is not a preference, follow it exactly: if the SAME category appears in the two most recent posts listed above, you MUST NOT choose that category again. Pick the best topic from any other category. (Historically this rule was worded as a soft preference and lost to the "when in doubt pick property-management" instruction, producing five straight property-management posts — do not let that happen.)
- "broker-partnerships" posts target NYC real estate brokers/agents as referral partners — topics should cover referral income, how to advise landlord clients, or how the DoryAngel partner program works
${engagementLine ? `- ENGAGEMENT SIGNAL (Clarity, last ${claritySignals.windowDays}d — consent-gated + short window, so it is THIN; treat as directional and IGNORE categories with only a handful of sessions): how well each blog category held readers, by average scroll depth — ${engagementLine}. When two categories are otherwise equally good candidates for today, prefer the one that holds attention better. Do NOT override the owner-facing category preference above based on a few sessions.` : ''}
${forcedCategory ? `\nCATEGORY IS FIXED FOR THIS RUN — this overrides every category preference and variety rule above: you MUST return "category": "${forcedCategory}"${forcedCategory === 'diy-property-management' ? ' (our Maintenance & Repairs category). Suggest a hands-on building-care subject: heating and boilers, roofs and facades, plumbing and leaks, pests, seasonal walkthroughs, hiring and pricing contractors, what to inspect and when, what to document.' : '.'} Pick the strongest title you can WITHIN that category — do not switch categories to get a better title.` : ''}
${avoidNote ? `\nIMPORTANT: Your last suggestion covered substantially the same theme as an already-published post ("${avoidNote}"). Pick a genuinely different subject or angle this time — not just a reworded or re-seasoned version of that post.` : ''}

Reply ONLY with valid JSON: {"title": "...", "category": "..."}`,
      }],
    });

    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      // Belt and braces: the prompt fixes the category, this guarantees it.
      if (parsed.title && parsed.category) {
        return forcedCategory ? { ...parsed, category: forcedCategory } : parsed;
      }
    }
  } catch (err) {
    console.warn(`AI topic selection failed (${err.message}) — using fallback`);
  }

  // Fallback round-robin, restricted to the forced category when one is set.
  const pool = forcedCategory
    ? FALLBACK_TOPICS.filter(t => t.category === forcedCategory)
    : FALLBACK_TOPICS;
  return pool[existingPosts.length % pool.length];
}

// Semantic dedupe gate against the FULL post history (not just the last 10 shown
// to the topic-picker above) — catches recurring themes worded differently, e.g.
// a new "August move-out costs" post re-covering old "cut vacancy time in half" /
// "reduce vacancy rates" ground. Mirrors Arlo's findDuplicateOpenIssue() in
// daily-audit.js. Fails open (treats as not-duplicate) on any error, same as Arlo.
async function findSimilarPublishedTopic(topic, existingPosts) {
  if (!existingPosts.length) return null;
  const titles = existingPosts.map(p => `${p.title} [${p.category}]`);
  const prompt = `You are a strict deduplication gate for a property-management blog.

NEW topic title: "${topic.title}"
NEW topic category: ${topic.category}

ALREADY PUBLISHED post titles (most recent first):
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Does the NEW topic cover substantially the SAME underlying theme/angle as any ALREADY PUBLISHED post, even if worded differently, re-seasoned, or using different numbers (e.g. "cost of vacancy" vs "cut vacancy time in half" vs "August move-out costs" are the same theme)? Only answer false if the core subject is genuinely distinct.

Return ONLY JSON: {"duplicate": true|false, "of": "<exact existing title, or empty>"}`;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content.find(b => b.type === 'text')?.text ?? '{}';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return parsed.duplicate ? (parsed.of || 'an existing post') : null;
  } catch (err) {
    console.warn(`Topic dedupe gate failed (${err.message}) — proceeding anyway`);
    return null;
  }
}

const HASHTAGS_BY_CATEGORY = {
  'property-management':     ['propertymanagement', 'bronxlandlord', 'nyc', 'flatfee', 'doryangel'],
  'diy-property-management': ['propertymaintenance', 'bronxlandlord', 'buildingrepairs', 'preventivemaintenance', 'doryangel'],
  'investments':             ['realestateinvesting', 'bronx', 'nycrealestate', 'rentalincome', 'doryangel'],
  'property-automation':     ['smartproperty', 'proptech', 'bronxlandlord', 'IoT', 'doryangel'],
  'broker-partnerships':     ['bronxrealestate', 'nycbroker', 'propertymanagement', 'referralincome', 'doryangel'],
};

const IMAGE_QUERIES = {
  'property-management': [
    'business professional reviewing documents bright office',
    'office worker computer modern bright',
    'manhattan skyscraper daylight blue sky',
    'modern nyc office building',
  ],
  'diy-property-management': [
    'handyman repairing apartment bright',
    'maintenance worker tools toolbox',
    'professional plumber working bright',
    'building boiler room heating system',
    'roof inspection worker building rooftop',
    'radiator heating apartment window',
  ],
  'investments': [
    'manhattan skyline daylight bright',
    'businesswoman laptop modern office bright',
    'nyc skyscrapers blue sky',
    'bronx residential building daylight',
  ],
  'property-automation': [
    'smart door lock apartment building entrance',
    'security camera apartment building exterior',
    'smart thermostat device white wall home',
    'building keypad entry security door residential',
  ],
  'broker-partnerships': [
    'real estate broker professional handshake office',
    'realtor reviewing documents bright office',
    'business partners meeting modern office nyc',
    'real estate agent client consultation bright',
  ],
};

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1600&q=80';

async function fetchCoverImage(category, title = '') {
  const queries = IMAGE_QUERIES[category] || IMAGE_QUERIES['property-management'];
  const query = pickImageQuery(queries, title);
  console.log(`Searching Unsplash for: "${query}"`);

  try {
    const results = await searchUnsplashPhotos(query);
    const photo = results[Math.floor(Math.random() * Math.min(results.length, 10))];
    return `${photo.urls.raw}&w=1600&q=80&fit=crop`;
  } catch (err) {
    console.warn(`Unsplash failed (${err.message}) — using fallback image`);
    return FALLBACK_IMAGE;
  }
}

const SYSTEM_PROMPT = `You are a content writer for DoryAngel LLC, a NYC property management company at 557 Grand Concourse Ave #4123, Bronx NY 10451. They offer flat-fee property management at $99/unit/month and have served Bronx and NYC owners since 2010.

CRITICAL RULES — what works for our audience (validated by real traffic data):

1. Title formula (validated by real traffic): must be either a question OR start with a number ("5 Free Tools...", "Top 3 Mistakes..."). Address the owner directly with "you"/"your". Usually lead with the owner's pain or cost — problem-first beats service-description. EXCEPTION for maintenance/how-to posts: a practical "how do you actually do this" or "what should you check" title is equally valid and does NOT need to be framed as a cost ("What Should a Bronx Landlord Actually Check on the Roof Every Spring?", "How Do You Get a Bronx Boiler Through Heat Season Without an HPD Complaint?"). Do not bolt a dollar figure onto a how-to title just to satisfy the pain-first habit. Anchor to the Bronx as the primary location; a second adjacent borough (Queens or Manhattan) may be included when natural (e.g. "...Your Bronx or Queens Rental?"), but never a non-Bronx borough alone. A Bronx-vs-adjacent-area COMPARISON is a proven top-traffic format — the "Bronx vs. Mount Vernon" comparison was one of the best-performing posts; Mount Vernon (the Westchester city bordering the Bronx) is allowed ONLY inside a Bronx-anchored comparison, never as the sole location. Favor owner-facing DIY and self-manage-vs-hire angles — these convert best. Gold-standard shapes to emulate: "How Much Is Inefficient Management Costing Your Bronx or Queens Rental?", "Bronx vs. Mount Vernon: Where Do Landlords Actually Keep More of Their Rent?", "Should You Self-Manage Your Bronx Rental or Hire Flat-Fee Management? A Real Cost Breakdown", "How to Screen Tenants in NYC Without Getting Sued", "Flat-Fee PM in the Bronx: What $99/Unit Actually Means". Never write generic, geo-less, marketing-speak titles ("Maximizing Returns with Management Investment Strategies", "The Power of Transparent Management Practices") — these got zero traffic.

2. Excerpts: 1-2 sentences, concrete and never abstract or marketing-speak. Usually focus on a real landlord pain point — money lost, tenant trouble, compliance fines — and match the pain in the title. For a maintenance or how-to post whose title is practical rather than pain-framed, the excerpt should instead say plainly what the reader will be able to do or check after reading, still in specific terms ("what to look at on the roof each spring, what it costs, and which parts need a licensed roofer"). Match the excerpt to the title's promise, whichever kind it is.

3. Word count: 800-1,200 words for the body content. Below 500 = zero traffic. We need depth.

4. NYC-specific examples: include at least one specific dollar figure or NYC-specific reference (a law name, neighborhood, court process, etc.) per article. Generic content gets ignored.

5. Tone: Warm, caring, and reassuring — like a trusted neighbor who genuinely has the homeowner's back, backed by real expertise. Speak directly to a stressed Bronx owner as "you", acknowledge how draining managing a rental can feel, and lead with a little empathy before the facts (e.g. "If a 3 a.m. tenant call has ever ruined your week, you're not alone — here's how we take that off your plate."). Be encouraging, human, and on their side — never cold, corporate, or preachy. Keep the warmth genuine and anchored in specifics; never slip into fluffy marketing-speak or empty reassurance (real traffic data shows generic feel-good copy gets zero reads).

6. Structure: Use markdown headings (h2, h3), short paragraphs (2-3 sentences), bullet lists where useful. Make it scannable.

7. STRUCTURAL VARIETY — do not default to the same skeleton every time. A recurring failure mode is every post following the exact same shape: dollar-figure hook → bulleted cost breakdown → 2-3 rhetorical "### Is/Does/What Happens If...?" sub-headings → a numbered step-by-step checklist → a "Bottom Line" closer. That shape is fine occasionally, but rotate genuinely different structures post to post so the blog doesn't read like the same article rewritten with new numbers:
   - Sometimes tell it through a short, specific scenario or before/after story instead of a bulleted breakdown.
   - Sometimes debunk a common landlord myth or misconception as the spine of the piece.
   - Sometimes structure it as a direct comparison (a table or side-by-side, not just prose) rather than a checklist.
   - Sometimes just explain a topic clearly and conversationally with no numbered list and no "Bottom Line" section at all — not every post needs a step-by-step or a closer labeled that way; end naturally instead.
   - For maintenance posts, two more shapes work well: a walkthrough that moves through the building in physical order (roof → facade → basement → units), and a symptom-first piece that starts from what the owner actually notices ("the top-floor radiator is cold") and works back to cause and fix.
   - A numbered list or dollar-amount breakdown should appear only where it's the best way to convey that specific content — never as a rote habit.

8. Do NOT include the CTA in the content — the CTA is auto-appended to every post by our system.

9. Answer front-loading: The opening paragraph (first 2–3 sentences) must directly and concisely answer the post title as a search query. State the answer first, then provide depth and context. This is how Google AI Overviews and featured snippets are earned.

10. E-E-A-T voice: Write in first-person plural to signal real expertise — "In our experience managing 100+ Bronx properties...", "We've seen landlords lose $3,000 when...", "Our clients in Riverdale tell us...". Use at least one first-person experience marker per major section — but vary where and how it appears rather than opening every section the same way.

11. FAQ headings: Structure at least 2–3 H2 or H3 subheadings as direct questions ending in "?" (e.g., "## How Much Does Property Management Cost in the Bronx?" or "### What Happens If You Miss an HPD Lead Paint Inspection?"). These are automatically converted to FAQPage schema, which boosts AI Overview appearances. Not every heading needs to be phrased as a question — mix in plain descriptive headings too.

12. Banned phrases — never use these AI clichés: "delve", "testament", "it's worth noting", "it is important to note", "in conclusion", "moreover", "furthermore", "navigate", "realm", "landscape", "crucial", "key takeaways", "let's explore", "let's dive", "game-changer", "transformative", "leverage" (as a verb), "unlock", "harness", "empower", "foster", "in today's world", "stands out".

13. Tool mentions (use judgment — only when it fits naturally, not in every post): DoryAngel offers landlords a Compliance Calendar (47 HPD, DOB &amp; FDNY tasks with exact penalty amounts and seasonal checklists, delivered monthly — free at doryangel.com/tools), a Weekly Digest (Monday summary of the 5 most urgent items: overdue rent, open HPD violations, expiring leases, maintenance tickets, compliance deadlines), an Owner Dashboard (real-time view of rent collection, maintenance, HPD violations, occupancy, and monthly expenses), and a Maintenance Tracker. When the post's problem is one these tools directly solve, add one brief sentence — e.g. "DoryAngel clients get this flagged automatically in their weekly digest" or "the owner dashboard tracks this in real time" or "DoryAngel's free Compliance Calendar covers this deadline every month." Do not force it if the connection isn't genuine.

14. Broker Partner Program mentions (for broker-partnerships category posts only): DoryAngel runs a Broker Partner Program (currently in beta) where NYC brokers earn $50/unit/month in recurring passive income — approximately 30% of the total management fee — for every unit they place with DoryAngel. The broker's existing commission is untouched. The only ongoing commitment is a 30-minute quarterly call. Brokers can request beta access at doryangel.com/broker-partner. When writing broker-partnerships posts, always reference this specific program with the real numbers ($50/unit/month, beta program terms apply) rather than vague "referral income" language.

15. Internal links (SEO): When a list of existing DoryAngel articles is provided alongside the topic, weave 2–3 of them into the body as contextual inline markdown links where they genuinely help the reader — e.g. "the same math applies when you [screen a rent-stabilized applicant](URL)". Use natural, descriptive anchor text (never "click here" or a bare URL), spread the links across the post where the connection is real, and skip any that don't fit rather than forcing them. Use ONLY URLs from the provided list, copied exactly — never invent a slug or URL, and never link to a page that isn't on the list. Do not add a separate "related articles" list at the end; our system appends related posts automatically.

16. DOWN-TO-EARTH MAINTENANCE (priority direction for the blog): our readers own Bronx buildings but are not tradespeople. When a post is a maintenance post — and wherever building care comes up naturally inside any other post — actually TEACH the thing in plain English instead of only pricing the consequence of it breaking:
   - Explain how the system or part works in everyday language: what it is, what it does, what it looks like when it's failing, and what the fix involves. Assume the reader has never opened their boiler room door.
   - Gloss every trade term the first time you use it — e.g. "the low-water cutoff (the safety switch that shuts the boiler down if the water level drops too far)". Never use plumbing, HVAC, roofing, or electrical jargon bare.
   - Be concrete and checkable: what a Bronx vendor typically charges for that call, roughly how long the job takes, which season to do it in, what to ask the contractor, and what to write down afterward.
   - Say plainly when something is a reasonable do-it-yourself job and when it is a licensed-trade or permit job the owner must not touch. Owners trust us more when we tell them what they can handle themselves.
   - Weave one short, genuinely relevant building-care detail into non-maintenance posts too (a lease post can note the walkthrough that protects the deposit) — one useful detail, not a tacked-on paragraph.
   - Keep the warm neighbor voice from rule 5. This should read like an experienced building manager explaining it at the kitchen table, not a spec sheet or a manual.

When asked to write a post, also produce:
- An SEO title in field "seoTitleShort": max 48 chars, do NOT add " | DoryAngel" — the system appends it
- An SEO description (max 155 chars, includes a hook + value prop)
- A descriptive alt text for the hero image (used for accessibility + SEO)
- A Facebook/Instagram caption in field "facebookPost". KEEP IT SHORT — this is the single most important rule for it. Short captions materially out-perform long ones on both platforms, and everything past roughly 400 characters is hidden behind "See more" where almost nobody expands it. Target 40–80 words for the whole caption before the links and hashtags — never more than 100.

  Structure, in this order:
  1. A hook of ONE sentence, under 125 characters, that works completely on its own — this is all that shows before the fold on Facebook and Instagram. Make it a concrete, specific statement or question from the post, not a teaser like "You won't believe...".
  2. Two or three short lines of substance — the actual useful takeaway, not a summary of what the article contains. Plain sentences or two brief bullets, whichever reads better. Do not pad.
  3. One line pointing to the article.
  4. Exactly ONE tool line — pick the single tool most relevant to this post's topic, copied exactly from this list (labels, emojis and arrows exactly as written):

📅 Compliance Calendar (free) → https://dror75p-ops.github.io/Doryangel-preventive-maintenance-schedule.automation/
📬 DoryAngel Digest (free) → https://dror75p-ops.github.io/Doryangel-preventive-maintenance-schedule.automation/digest/
🔍 AI Property Inspector (free) → https://dror75p-ops.github.io/Transcribe_meeting/
📊 Property P&L Dashboard ($29.99) → https://www.doryangel.com/tools/pl-dashboard/
🤝 Broker Partner Program ($50/unit/mo) → https://www.doryangel.com/broker-partner.html

  Include ONE of those lines only — never the whole list, which buries the post and reads as spam. For broker-partnerships posts always use the Broker Partner Program line. For maintenance posts the Compliance Calendar (a preventive-maintenance schedule) is usually the right one.
  5. Three to five hashtags on the final line — no more.

Categories must be exactly one of: property-management, diy-property-management, investments, property-automation, broker-partnerships.

For broker-partnerships posts: the audience is NYC real estate brokers and agents, not landlords. Write peer-to-peer — broker talking to broker. Focus on referral income, protecting client relationships, and how DoryAngel works as an expert backstop. Lead with the broker's pain point (income stops at closing, clients call them about management problems, fear of losing relationships). Do NOT include any landlord-specific compliance content as the primary angle.`;

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: {
        ANSWER_FRONT_LOAD: { type: 'string', enum: ['PASS', 'FAIL'] },
        EEAT_VOICE:        { type: 'string', enum: ['PASS', 'FAIL'] },
        QUESTION_HEADINGS: { type: 'string', enum: ['PASS', 'FAIL'] },
        NYC_SPECIFICITY:   { type: 'string', enum: ['PASS', 'FAIL'] },
        NO_CLICHES:        { type: 'string', enum: ['PASS', 'FAIL'] },
      },
      required: ['ANSWER_FRONT_LOAD', 'EEAT_VOICE', 'QUESTION_HEADINGS', 'NYC_SPECIFICITY', 'NO_CLICHES'],
      additionalProperties: false,
    },
    feedback: { type: 'string' },
    overall:  { type: 'string', enum: ['PASS', 'FAIL'] },
  },
  required: ['scores', 'feedback', 'overall'],
  additionalProperties: false,
};

const POST_SCHEMA = {
  type: 'object',
  properties: {
    title:            { type: 'string' },
    excerpt:          { type: 'string' },
    content:          { type: 'string' },
    seoTitleShort:    { type: 'string' },
    seoDescription:   { type: 'string' },
    heroImageAlt:     { type: 'string' },
    facebookPost:     { type: 'string' },
  },
  required: ['title', 'excerpt', 'content', 'seoTitleShort', 'seoDescription', 'heroImageAlt', 'facebookPost'],
  additionalProperties: false,
};

// ── Internal linking (PR C) ─────────────────────────────────────────────
// Give Nave a shortlist of real existing posts to link to contextually, and a
// guard that neutralizes any hallucinated internal link so it can't 404.

const COMPLIANCE_HUB = {
  title: 'NYC Landlord Compliance Guide',
  url: 'https://www.doryangel.com/guides/bronx-landlord-compliance/',
  path: '/guides/bronx-landlord-compliance/',
};

const LINK_STOP_WORDS = new Set([
  'the','and','for','you','your','are','with','that','this','what','why','how',
  'could','should','does','from','into','when','will','have','has','its','our',
  'bronx','nyc','landlord','landlords','2026','2025','new','york','city','rental',
]);

function linkTokens(text) {
  return new Set(
    String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !LINK_STOP_WORDS.has(w))
  );
}

// Rank existing posts by relevance to the topic (title/excerpt overlap + a
// same-category bonus) and return the top few as {title, url} for the prompt.
function pickLinkablePosts(topic, existingPosts, limit = 8) {
  const topicSlug = generateSlug(topic.title);
  const tTokens = linkTokens(topic.title);
  return existingPosts
    .filter(p => p.slug !== topicSlug)
    .map(p => {
      const pt = linkTokens(`${p.title} ${p.excerpt || ''}`);
      let overlap = 0;
      for (const w of pt) if (tTokens.has(w)) overlap++;
      return { p, score: overlap + (p.category === topic.category ? 2 : 0) };
    })
    .sort((a, b) => b.score - a.score
      || new Date(b.p.publishedDate) - new Date(a.p.publishedDate))
    .slice(0, limit)
    .map(({ p }) => ({ title: p.title, url: `https://www.doryangel.com/blog/${p.slug}/` }));
}

// Candidates to show Nave + the full set of valid internal paths (for the guard).
function buildLinkInfo(topic, existingPosts) {
  const candidates = pickLinkablePosts(topic, existingPosts);
  const validPaths = new Set(existingPosts.map(p => `/blog/${p.slug}/`));
  validPaths.add(COMPLIANCE_HUB.path);
  return { candidates, validPaths };
}

// Unwrap any markdown link pointing at a /blog/ or /guides/ page that doesn't
// exist (a hallucinated slug) into plain text, so Nave can never ship a 404.
// Leaves valid article links, homepage/#anchor links, and /tools links intact.
function sanitizeInternalLinks(content, validPaths) {
  if (!validPaths) return content;
  return content.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\/]*doryangel\.com(\/[^)\s]*))\)/g,
    (match, anchor, _url, rawPath) => {
      let path = rawPath.split('#')[0].split('?')[0];
      if (!path.endsWith('/')) path += '/';
      if (/^\/(blog|guides)\//.test(path)) {
        return validPaths.has(path) ? match : anchor;
      }
      return match; // not an article/guide link — leave as-is
    }
  );
}

async function generatePost(topic, researchNotes = '', editorFeedback = '', linkInfo = null) {
  const today = toISODate(new Date());

  const researchBlock = researchNotes
    ? `\nResearch facts to weave in naturally (use as inspiration — do not copy verbatim):\n${researchNotes}\n`
    : '';

  const feedbackBlock = editorFeedback
    ? `\nEditor feedback — fix these issues in this rewrite:\n${editorFeedback}\n`
    : '';

  const linkBlock = linkInfo && linkInfo.candidates.length
    ? `\nInternal links you MAY use — weave 2–3 of these into the body as contextual inline markdown links where they're genuinely relevant, using natural descriptive anchor text. Use ONLY URLs from this list, copied exactly — never invent a slug or URL:\n${
        linkInfo.candidates.map(l => `- "${l.title}" — ${l.url}`).join('\n')
      }\n- "${COMPLIANCE_HUB.title}" (link when the post touches NYC law, filing deadlines, or compliance) — ${COMPLIANCE_HUB.url}\n`
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      format: { type: 'json_schema', schema: POST_SCHEMA },
    },
    messages: [{
      role: 'user',
      content: `Write a blog post on this topic: "${topic.title}"
Target category: ${topic.category}
Year context: 2026
${researchBlock}${feedbackBlock}${linkBlock}
Remember: 800-1,200 words, NYC-specific examples, pain-point focused, scannable structure, no CTA in the content.`,
    }],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response');
  let post;
  try {
    post = JSON.parse(textBlock.text);
  } catch (e) {
    throw new Error(`Claude returned invalid JSON: ${textBlock.text.slice(0, 200)}`);
  }

  // Guard: neutralize any internal /blog/ or /guides/ link to a non-existent
  // page so a hallucinated slug can never ship as a 404.
  if (linkInfo) post.content = sanitizeInternalLinks(post.content, linkInfo.validPaths);

  console.log(
    `usage — input: ${message.usage.input_tokens}, ` +
    `cache_read: ${message.usage.cache_read_input_tokens ?? 0}, ` +
    `cache_write: ${message.usage.cache_creation_input_tokens ?? 0}, ` +
    `output: ${message.usage.output_tokens}`
  );

  // Pass the title so the query matches the subject: a roof post gets the roof
  // query, not whichever of the category's queries came up at random.
  const heroImage = await fetchCoverImage(topic.category, post.title || topic.title);

  const SUFFIX = ' | DoryAngel';
  const MAX = 60;
  const stripped = post.seoTitleShort.replace(/\s*\|\s*DoryAngel\s*$/i, '').trim();
  const room = MAX - SUFFIX.length;
  const trimmed = stripped.length <= room
    ? stripped
    : stripped.slice(0, room).replace(/\s+\S*$/, '').trim();
  const seoTitle = trimmed + SUFFIX;

  return {
    slug: generateSlug(post.title),
    title: post.title,
    category: topic.category,
    excerpt: post.excerpt,
    publishedDate: today,
    minutesToRead: wordsToMinutes(post.content),
    heroImage,
    heroImageAlt: post.heroImageAlt,
    hashtags: HASHTAGS_BY_CATEGORY[topic.category],
    featured: false,
    seoTitle,
    seoDescription: post.seoDescription.slice(0, 155),
    author: 'DoryAngel Team',
    content: post.content,
    facebookPost: post.facebookPost,
  };
}

async function researchTopic(topic) {
  // Maintenance posts need trade facts (what a job costs, how a system fails),
  // not the fines-and-court-timeline facts that suit compliance topics. Asking
  // for the wrong facts is what used to push every maintenance draft back into
  // the "here's what it costs you when it breaks" frame.
  const isMaintenance = topic.category === 'diy-property-management';

  const factsWanted = isMaintenance
    ? `- What the repair or service actually costs in the Bronx: typical vendor call-out fees, hourly trade rates, part prices, and full replacement ranges
- How the system or component works and how it typically fails — the specific failure mode, and the early warning signs an owner can actually notice
- Whether the job is owner-doable or requires a licensed trade and/or a DOB permit in NYC
- The NYC seasonal timing that matters (e.g. the Oct 1–May 31 heat season, when to schedule a boiler service, when facade or roof work is practical)
- Any NYC rule that sets a standard for it (heat and hot water minimums, HPD violation classes, Local Law 11 facade cycles) — one or two, not a list
- How long the job takes and what the owner should document afterward`
    : `- Dollar amounts (fines, rents, costs — specific NYC/Bronx figures)
- NYC law or rule names with numbers where applicable (e.g., Local Law 11, HPD §27-2005, Good Cause Eviction Law)
- Bronx-specific market data or neighborhood references
- Timelines, deadlines, or court procedures relevant to this topic
- Real statistics or percentages if applicable`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are a research assistant for DoryAngel, a Bronx property management company.

For the blog post: "${topic.title}" (category: ${topic.category})

List 5–7 specific, concrete facts a Bronx landlord content writer should weave into this article. Include:
${factsWanted}

Be specific. Avoid vague generalities. Format: numbered list, one fact per line, no headers.`,
      }],
    });
    const notes = response.content.find(b => b.type === 'text')?.text?.trim() ?? '';
    console.log(`Research: ${notes.split('\n').filter(l => l.trim()).length} facts gathered`);
    return notes;
  } catch (err) {
    console.warn(`Research step failed (${err.message}) — proceeding without`);
    return '';
  }
}

async function reviewPost(post, topic) {
  const wordCount = post.content.trim().split(/\s+/).length;
  const wordCountNote = wordCount >= 800 && wordCount <= 1200
    ? `${wordCount} words — within target`
    : `${wordCount} words — OUTSIDE target (800–1200), flag in feedback`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      output_config: {
        format: { type: 'json_schema', schema: REVIEW_SCHEMA },
      },
      messages: [{
        role: 'user',
        content: `Review this blog post draft for DoryAngel. Score each criterion PASS or FAIL.

1. ANSWER_FRONT_LOAD: Do the first 2–3 sentences directly answer the post title as a search query?
2. EEAT_VOICE: Does the post use at least one first-person plural experience marker ("In our experience...", "We've seen...", "Our clients...")?
3. QUESTION_HEADINGS: Does the post have at least 2 H2 or H3 headings ending in "?"?
4. NYC_SPECIFICITY: Does it include at least one specific, checkable NYC detail? Any ONE of these counts: a dollar figure, a law or rule name, a neighborhood, a court process, OR — for maintenance and how-to posts — a concrete trade specific such as a vendor rate, part cost, permit requirement, seasonal deadline, or named building system. A practical how-to that cites real Bronx repair costs and NYC seasonal timing but no statute PASSES; do not fail it for lacking a law name.
5. NO_CLICHES: Is it free of: "delve", "testament", "it's worth noting", "moreover", "furthermore", "navigate the", "realm", "landscape", "crucial", "game-changer", "transformative", "unlock", "harness", "empower", "foster", "in today's world", "stands out"?

Word count: ${wordCountNote}.
Title: "${topic.title}"

Content:
${post.content}`,
      }],
    });
    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    const result = JSON.parse(text);
    const failed = Object.entries(result.scores).filter(([, v]) => v === 'FAIL').map(([k]) => k);
    console.log(`Quality review: ${result.overall}${failed.length ? ` — failed: ${failed.join(', ')}` : ' — all checks passed'}`);
    return result;
  } catch (err) {
    console.warn(`Review step failed (${err.message}) — skipping`);
    return { scores: {}, feedback: '', overall: 'PASS' };
  }
}

async function sendApprovalEmail(post, digestStats) {
  const fbPost = post.facebookPost;
  const isDryRun = digestStats?.dryRun === true;
  const digestLine = isDryRun
    ? `<p style="margin:0;font-size:12px;color:#8B6F1A;font-weight:700;">🧪 DRY RUN — preview only. This post was NOT published and NO subscribers were emailed.</p>`
    : digestStats?.skipped === true
    ? `<p style="margin:0;font-size:12px;color:#8B6F1A;font-weight:700;">🌿 BRANCH RUN — the post is committed to a branch, not to the live site. NO subscribers were emailed and nothing was posted to Facebook. Both go out on the next scheduled run after the branch is merged.</p>`
    : digestStats?.error
    ? `<p style="margin:0;font-size:12px;color:#B91C1C;">⚠️ Subscriber emails failed: ${digestStats.error}</p>`
    : `<p style="margin:0;font-size:12px;color:#1B6B1B;font-weight:700;">📬 ${digestStats?.sent ?? 0} subscriber${(digestStats?.sent ?? 0) !== 1 ? 's' : ''} emailed with this post</p>`;

  await resend.emails.send({
    from: 'DoryAngel Blog <onboarding@resend.dev>',
    to: APPROVAL_EMAIL,
    subject: `${isDryRun ? '🧪 [DRY RUN] ' : ''}📱 Instagram-ready: "${post.title}"`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A2740;">
        <div style="background:#0F2847;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h1 style="color:white;font-size:18px;margin:0;">📱 Ready to post — Instagram</h1>
          <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0;">Facebook goes out automatically — this is the Instagram half</p>
        </div>
        <div style="padding:20px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">

          <div style="background:#FFF8E7;border:1px solid #F5D78E;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
            <p style="margin:0;font-size:13px;color:#8B6F1A;font-weight:700;">📥 STEP 1 — Long-press the image below → "Save image"</p>
          </div>
          <img src="${post.heroImage}" alt="${post.heroImageAlt}" style="width:100%;height:auto;border-radius:8px;margin-bottom:24px;display:block;" />

          <div style="background:#E7F3FF;border:1px solid #8FBCEB;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
            <p style="margin:0;font-size:13px;color:#1B4F8A;font-weight:700;">📋 STEP 2 — Long-press the box below → "Select all" → "Copy"</p>
          </div>

          <div style="background:#F4F7FA;border:2px solid #1E5AA8;border-radius:8px;padding:20px;margin-bottom:24px;">
            <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px;color:#1A2740;line-height:1.6;margin:0;word-wrap:break-word;">${fbPost}</pre>
          </div>

          <div style="background:#E8F8E8;border:1px solid #8FCB8F;border-radius:8px;padding:14px 16px;margin-bottom:32px;">
            <p style="margin:0;font-size:13px;color:#1B6B1B;font-weight:700;">✅ STEP 3 — Post it on Instagram: "New post" → attach the saved image + paste the caption (the link isn't clickable on Instagram — that's fine, it drives to "link in bio")</p>
            <p style="margin:8px 0 0;font-size:12px;color:#4A6B4A;">Facebook is posted automatically by Vera — don't post it again there. If the auto-post ever fails you'll get a separate "Facebook auto-post failed" email with the caption to paste by hand.</p>
          </div>

          <div style="background:#F0FAF4;border:1px solid #8FCB8F;border-radius:8px;padding:12px 16px;margin-bottom:32px;">
            ${digestLine}
          </div>

          <hr style="border:none;border-top:1px solid #E2E8F0;margin:32px 0;" />

          <p style="font-size:11px;color:#8B9BAE;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">For reference</p>
          <h2 style="font-size:18px;color:#0F2847;margin:0 0 6px;">${post.title}</h2>
          <p style="color:#1E5AA8;font-size:12px;font-weight:700;margin:0 0 16px;">${post.category} · ${post.minutesToRead} min read · Live on doryangel.com</p>

          <details style="margin-bottom:24px;">
            <summary style="cursor:pointer;color:#1E5AA8;font-size:14px;font-weight:600;padding:8px 0;">Show full blog article ▾</summary>
            <div style="white-space:pre-wrap;font-size:13px;color:#556070;line-height:1.8;background:#fff;border:1px solid #E2E8F0;border-radius:6px;padding:16px;margin-top:12px;">
${post.content}
            </div>
          </details>

          <p style="margin:24px 0 0;font-size:11px;color:#8B9BAE;text-align:center;">
            Auto-generated by DoryAngel blog automation<br>
            Next post: in 2 days
          </p>
        </div>
      </div>
    `,
  });
}

async function main() {
  const indexPath = './content/blog/posts-index.json';
  const posts = JSON.parse(readFileSync(indexPath, 'utf8'));

  // Guard: skip if a post was already published today (prevents double-runs on schedule)
  // Bypass with FORCE_PUBLISH=true (or DRY_RUN=true, which never publishes anyway)
  const today = toISODate(new Date());
  if (posts[0]?.publishedDate === today && process.env.FORCE_PUBLISH !== 'true' && process.env.DRY_RUN !== 'true') {
    console.log(`Post already published today (${today}) — skipping to avoid duplicate.`);
    console.log('To override, set FORCE_PUBLISH=true');
    process.exit(0);
  }

  const claritySignals = await getClarityCategorySignals(posts);
  if (claritySignals) {
    console.log(`Clarity signal: ${claritySignals.categories.map(c => `${c.category}=${c.avgScroll}%/${c.sessions}s`).join(', ')}`);
  }
  let topic = await pickTopicWithAI(posts, claritySignals);
  let dupOf = await findSimilarPublishedTopic(topic, posts);
  for (let attempt = 0; dupOf && attempt < 2; attempt++) {
    console.log(`Topic "${topic.title}" overlaps published post "${dupOf}" — retrying (attempt ${attempt + 1}/2)`);
    topic = await pickTopicWithAI(posts, claritySignals, dupOf);
    dupOf = await findSimilarPublishedTopic(topic, posts);
  }
  if (dupOf) console.log(`Still overlapping after retries ("${dupOf}") — proceeding anyway (fail-open)`);
  console.log(`Topic: "${topic.title}" (${topic.category})`);

  const researchNotes = await researchTopic(topic);
  const linkInfo = buildLinkInfo(topic, posts);
  console.log(`Internal-link candidates offered: ${linkInfo.candidates.length}`);

  let post = await generatePost(topic, researchNotes, '', linkInfo);
  console.log(`Generated: "${post.title}"`);

  const review = await reviewPost(post, topic);
  if (review.overall === 'FAIL') {
    console.log(`Rewriting with feedback: ${review.feedback}`);
    post = await generatePost(topic, researchNotes, review.feedback, linkInfo);
    console.log(`Rewrite complete: "${post.title}"`);
  }

  // Surface the caption size in the run log. Facebook and Instagram both hide
  // everything past roughly 400 characters behind "See more", so a caption that
  // creeps back toward the old 200–280-word format is a regression worth seeing.
  const capChars = post.facebookPost.length;
  const capWords = post.facebookPost.trim().split(/\s+/).length;
  const capHook = post.facebookPost.trim().split('\n')[0];
  console.log(`Caption: ${capWords} words / ${capChars} chars, hook ${capHook.length} chars${capChars > 900 ? ' — LONG, check the caption rules held' : ''}`);

  // facebookPost is for the email only — strip before persisting
  const { facebookPost, ...postForIndex } = post;

  // DRY_RUN: generate + print + send the owner approval email ONLY.
  // No index write, no subscriber broadcast, no Facebook/Instagram queue —
  // safe preview of the post and the approval email (tone, image, caption).
  if (process.env.DRY_RUN === 'true') {
    console.log('\n===== DRY RUN — not published (no index write, no subscriber broadcast, no social post) =====\n');
    console.log(`TITLE:    ${postForIndex.title}`);
    console.log(`CATEGORY: ${postForIndex.category}`);
    console.log(`SLUG:     ${postForIndex.slug}`);
    console.log(`EXCERPT:  ${postForIndex.excerpt}`);
    console.log(`READ:     ${postForIndex.minutesToRead} min`);
    console.log('\n----- BODY (markdown) -----\n');
    console.log(postForIndex.content);
    console.log('\n----- FACEBOOK / INSTAGRAM CAPTION -----\n');
    console.log(facebookPost);
    console.log('\n===== END DRY RUN =====\n');
    await sendApprovalEmail(post, { dryRun: true });
    console.log(`Dry-run approval email sent to ${APPROVAL_EMAIL} (preview only — not published)`);
    return;
  }

  posts.unshift(postForIndex);
  writeFileSync(indexPath, JSON.stringify(posts, null, 2));
  console.log('Added to posts-index.json');

  // A run on a branch writes the post but must NOT go outbound: the post URL only
  // goes live once the branch is merged and Vercel redeploys, so a digest blast or
  // a Facebook post from here would hand every subscriber a 404. The workflow sets
  // this whenever the ref is not main; the scheduled run on main never does.
  if (process.env.SKIP_BROADCAST === 'true') {
    console.log('SKIP_BROADCAST=true (branch run) — no subscriber digest, no social queue. Post written to the index only.');
    await sendApprovalEmail(post, { skipped: true });
    console.log(`Approval email sent to ${APPROVAL_EMAIL}`);
    return;
  }

  // Run subscriber digest first so the count lands in the approval email
  const digestStats = await notifyDigestSubscribers(postForIndex);

  await sendApprovalEmail(post, digestStats);
  console.log(`Approval email sent to ${APPROVAL_EMAIL}`);

  // Hand off to Vera (social-post.js) via a temp file — keeps Nave's scope clean
  const { writeFileSync: wf } = await import('fs');
  wf('/tmp/social-queue.json', JSON.stringify({ slug: postForIndex.slug, facebookPost }));
  console.log('Social queue written for Vera → /tmp/social-queue.json');
}

const SUBSCRIBER_SHEET_ID = '1-9IDAD1VmlnCvTdU3JqDWahjEFQaUFtRG-WayHZ9N8o';

// Make.com "DoryAngel Digest — New Post Broadcast" scenario (sends via Gmail / office@doryangel.com).
// One POST per matched subscriber; the scenario emails them the new post.
const DIGEST_BROADCAST_WEBHOOK = 'https://hook.eu1.make.com/rbh91p9c72r0qypeuhmjvlsey3hutzgr';

async function getGoogleAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const toSign = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(toSign);
  const sig = sign.sign(credentials.private_key, 'base64url');
  const jwt = `${toSign}.${sig}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

function parseCSV(text) {
  return text.trim().split(/\r?\n/).map(line => {
    const result = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(field); field = '';
      } else {
        field += ch;
      }
    }
    result.push(field);
    return result;
  });
}

async function notifyDigestSubscribers(post) {
  let rows = null;

  // Primary: Sheets API with service account auth
  const saKey = process.env.GOOGLE_SA_KEY;
  if (saKey) {
    try {
      const credentials = JSON.parse(saKey);
      const token = await getGoogleAccessToken(credentials);
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SUBSCRIBER_SHEET_ID}/values/Sheet1`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        rows = (data.values || []).slice(1);
        console.log('Subscriber list loaded via Sheets API');
      } else {
        console.warn(`Sheets API returned ${res.status} — falling back to public CSV`);
      }
    } catch (err) {
      console.warn(`SA auth failed (${err.message}) — falling back to public CSV`);
    }
  }

  // Fallback: public CSV export (requires sheet set to "Anyone with the link can view")
  if (rows === null) {
    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${SUBSCRIBER_SHEET_ID}/export?format=csv&gid=0`;
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(`CSV export returned ${res.status}`);
      rows = parseCSV(await res.text()).slice(1);
      console.log('Subscriber list loaded via public CSV');
    } catch (err) {
      console.warn(`Subscriber digest failed: ${err.message}`);
      return { sent: 0, total: 0, error: err.message };
    }
  }

  // col A=name, B=email, C=topics, D=date, E=active("Yes"), F=address
  // Reach-first: every ACTIVE subscriber receives every post. Topic preferences
  // (column C) are still collected at signup, so strict per-topic segmentation
  // can be switched back on later once the list is large enough to benefit from
  // it (see notes in CLAUDE.md). De-dupe by email so a subscriber listed on
  // multiple rows only gets one copy per post.
  const seen = new Set();
  const subscribers = rows.filter(r => {
    const email  = (r[1] || '').trim().toLowerCase();
    const active = (r[4] || '').trim().toLowerCase();
    if (!(email.includes('@') && email.length > 6 && active === 'yes')) return false;
    if (seen.has(email)) return false;   // already queued this address
    seen.add(email);
    return true;
  });

  console.log(`Notifying ${subscribers.length} active digest subscribers`);
  if (subscribers.length === 0) return { sent: 0, total: 0 };

  const postUrl = `https://www.doryangel.com/blog/${post.slug}/`;
  // Shared secret so the public broadcast webhook can't be triggered by anyone but
  // this server-side job. The Make scenario filter drops any POST whose `secret`
  // field doesn't match. (Server-to-server only — never expose this in client code.)
  const webhookSecret = process.env.DIGEST_WEBHOOK_SECRET || '';
  if (!webhookSecret) {
    console.warn('  ⚠ DIGEST_WEBHOOK_SECRET not set — broadcast may be rejected once the Make filter requires it');
  }
  let sent = 0;

  // Delivery goes through the Make.com broadcast scenario (Gmail / office@doryangel.com)
  // rather than Resend — the Resend sandbox domain can only reach the account owner,
  // whereas the Gmail channel reliably delivers to any subscriber.
  for (const sub of subscribers) {
    const email = (sub[1] || '').trim();
    const name  = (sub[0] || '').trim();
    try {
      const res = await fetch(DIGEST_BROADCAST_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: webhookSecret, name, email, title: post.title, excerpt: post.excerpt, url: postUrl }),
      });
      if (!res.ok) throw new Error(`broadcast webhook returned ${res.status}`);
      sent++;
    } catch (e) {
      console.warn(`  ✗ ${email}: ${e.message}`);
    }
  }

  console.log(`Digest broadcast queued for ${sent}/${subscribers.length} subscribers`);
  return { sent, total: subscribers.length };
}

main().catch(err => {
  if (err instanceof Anthropic.APIError) {
    console.error(`Anthropic API error ${err.status}: ${err.message}`);
    if (err.request_id) console.error(`Request ID: ${err.request_id}`);
  } else {
    console.error('Error:', err.message);
  }
  process.exit(1);
});
