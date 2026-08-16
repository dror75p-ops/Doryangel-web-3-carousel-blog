// scripts/lib/improvement-governance.js
//
// The governance rules of Arlo's continuous-improvement loop, in ONE place.
//
// Two scripts depend on these rules and they must never drift apart:
//   • scripts/daily-audit.js        — Arlo. Observes, measures, scouts, recommends.
//                                     Reads these rules so a recommendation it
//                                     files is already flagged the way the
//                                     approval script will judge it.
//   • scripts/queue-approved-post.js — the manual human gate. Re-checks EVERY
//                                     rule at approval time and refuses on any
//                                     failure.
//
// ⚠️ The approval script must never "trust" Arlo's own classification. Arlo
// writes `legal_review_required` into its recommendation, but the approval
// script recomputes it from requiresLegalReview() and takes the STRICTER of the
// two. A model that forgets to set the flag must not be able to open the gate.
//
// Per the philosophy in post-utils.js: shared BEHAVIOUR lives here. Per-script
// data (watch terms, prompts, image queries) stays local to its script.

import { readFileSync } from 'fs';
import { createHash } from 'crypto';

// ─── Cadence ──────────────────────────────────────────────────────────────────

export const CYCLE_DAYS = 14;

// File paths, shared so the two scripts can never disagree about where the
// loop's state lives. All of these sit under project/ or content/:
//   project/seo/  — excluded by .vercelignore, so nothing here is ever published.
//   content/blog/ — IS published (blog-loader.js fetches it client-side), so the
//                   approved queue must never carry anything private. It holds
//                   post briefs only: title, category, excerpt. Same class of
//                   data as posts-index.json itself.
export const CYCLE_STATE_FILE   = './project/seo/improvement-state.json';
export const RECOMMENDATIONS_FILE = './project/seo/recommendations.json';
export const EXPERIMENTS_FILE   = './project/seo/experiments.json';
export const APPROVED_QUEUE_FILE = './content/blog/approved-queue.json';
export const POSTS_INDEX_FILE   = './content/blog/posts-index.json';

// ⚠️ THE STATE FILE IS DELIBERATELY ONE KEY. It exists to answer exactly one
// question — "is the 14-day cycle due?" — and nothing else. Every extra field
// invites the next person to park an API response, a lead count or a subscriber
// name in a file that gets committed to a public repo on every run. Measurements
// belong in daily-series.json, findings in recommendations.json, neither of
// which is load-bearing for the cadence.
export const ALLOWED_CYCLE_STATE_KEYS = ['lastCycleDate'];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Strip a raw parsed state object down to the allowed keys. Never throws. */
export function sanitizeCycleState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  if (typeof raw.lastCycleDate === 'string' && ISO_DAY.test(raw.lastCycleDate)) {
    out.lastCycleDate = raw.lastCycleDate;
  }
  return out;
}

export function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86400000);
}

/**
 * The cadence gate. Enforced in code, not by the cron: the daily workflow fires
 * every morning, and a workflow_dispatch can fire it again ten minutes later.
 * A second run on the same day must be a no-op for the expensive cycle — the
 * whole point of a 14-day rhythm is that the measurement windows do not overlap.
 */
export function isCycleDue(state, todayISO, cycleDays = CYCLE_DAYS) {
  const last = sanitizeCycleState(state).lastCycleDate;
  if (!last) return true;                     // never run — run it now
  const elapsed = daysBetween(last, todayISO);
  if (elapsed <= 0) return false;             // same day (or clock went backwards)
  return elapsed >= cycleDays;
}

// ─── The read-only guard ──────────────────────────────────────────────────────
//
// ⚠️ DO NOT REMOVE. This is the runtime half of the invariant "the
// recommendation engine cannot write to the blog index";
// __verify__/verify-improvement-governance.js is the test half.
//
// It hashes content/blog/posts-index.json around the whole analysis phase, so
// any future edit that adds a write — directly, or through a helper that does —
// turns a silent governance breach into a loud failed run. It lives in this
// module rather than in daily-audit.js so the check can be tested without
// importing (and therefore executing) the daily audit script.

export function fileFingerprint(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

export const BLOG_INDEX_VIOLATION = (label) =>
  `GOVERNANCE VIOLATION: ${label} modified ${POSTS_INDEX_FILE}. The recommendation engine is read-only with respect to blog content — publishing goes through scripts/queue-approved-post.js and a human. Investigate before merging anything from this run.`;

/**
 * Run `fn` with the blog index frozen. If the file changed, `onViolation` is
 * called with the message (so the caller can emit its own annotation) and the
 * error is thrown — a run that edited the blog index must not report success.
 */
export async function withBlogIndexFrozen(label, fn, onViolation = () => {}) {
  const before = fileFingerprint(POSTS_INDEX_FILE);
  try {
    return await fn();
  } finally {
    if (before !== fileFingerprint(POSTS_INDEX_FILE)) {
      const msg = BLOG_INDEX_VIOLATION(label);
      try { onViolation(msg); } catch {}
      throw new Error(msg);
    }
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────
//
// ⚠️ THREE CATEGORIES ARE QUEUEABLE, NOT FIVE. The blog has five categories in
// posts-index.json; only these three may be created through the approval gate.
// `property-automation` and `broker-partnerships` are still perfectly valid for
// Nave's own weighting — this allowlist governs the approval path only, and is
// deliberately the narrower of the two. Widening it is a governance decision, so
// it belongs in a reviewed commit, never in a silent fallback.
//
// The aliases exist so a human typing `--category PM` at the terminal is not
// silently rejected over a slug they never see in the email.
export const APPROVED_CATEGORIES = ['diy-property-management', 'property-management', 'investments'];

const CATEGORY_ALIASES = {
  'diy': 'diy-property-management',
  'diy-property-management': 'diy-property-management',
  'maintenance': 'diy-property-management',
  'maintenance & repairs': 'diy-property-management',
  'pm': 'property-management',
  'property-management': 'property-management',
  'investments': 'investments',
  'investment': 'investments',
};

/** Returns the canonical slug, or null if this is not an approved category. */
export function resolveCategory(input) {
  const key = String(input ?? '').trim().toLowerCase();
  const slug = CATEGORY_ALIASES[key];
  return APPROVED_CATEGORIES.includes(slug) ? slug : null;
}

export function isApprovedCategory(input) {
  return resolveCategory(input) !== null;
}

// ─── Legal / regulatory classification ────────────────────────────────────────
//
// ⚠️ THIS IS A BLOCKING CONTROL, NOT A WARNING. A recommendation that trips any
// of these patterns cannot be queued unless the human passes --legal-reviewed.
//
// Deliberately over-broad. A false positive costs one extra flag on the command
// line; a false negative puts unreviewed housing-law claims on a page that
// carries the real business NAP, for a company that separates itself from
// licensed brokerage activity (see disclaimer.html:60). The asymmetry is the
// whole design. Do not "tighten" these to reduce noise.
export const LEGAL_TOPIC_PATTERNS = [
  /\bhpd\b/i,
  /\bdob\b/i,
  /\bhcr\b/i,
  /\bfdny\b/i,
  /\bevict(ion|ions|ing)?\b/i,
  /\bhousing court\b/i,
  /\btenant(?:'s|s')? rights?\b/i,
  /\brent(?:-|\s)?(?:regulat|stabiliz|stabilis|controll)/i,
  /\bgood cause\b/i,
  /\blocal law \d+/i,
  /\brpie\b/i,
  /\bviolation(s)?\b/i,
  /\bfine(s)?\b|\bpenalt(y|ies)\b/i,
  /\bcompliance\b|\bcompliant\b/i,
  /\blegal(ly)?\b|\blawsuit\b|\bsued?\b|\bstatute\b|\bcourt\b/i,
  /\blease\s+(?:law|termination|renewal)\b/i,
  /\bsecurity deposit\b/i,
  /\bfair housing\b|\bdiscriminat/i,
  /\bcertificate of occupancy\b/i,
  /\binspection\s+(?:law|mandate|requirement)/i,
  /\bregulat(ion|ory|ed)\b/i,
  /\bgovernment\b|\bcity\s+requirement/i,
  /\btax(es|ation)?\b/i,
  /\bdeadline\b.*\bfil(e|ing)\b|\bfil(e|ing)\b.*\bdeadline\b/i,
];

/**
 * True when ANY of the supplied strings looks like regulated-topic content.
 * Called on the title, the action and the evidence together — a neutral title
 * over a body about eviction timelines is still eviction content.
 */
export function requiresLegalReview(...texts) {
  const blob = texts.filter(Boolean).join(' \n ');
  return LEGAL_TOPIC_PATTERNS.some(re => re.test(blob));
}

/** Which patterns fired — so the report can say WHY, instead of just "legal". */
export function legalReviewReasons(...texts) {
  const blob = texts.filter(Boolean).join(' \n ');
  const hits = [];
  for (const re of LEGAL_TOPIC_PATTERNS) {
    const m = blob.match(re);
    if (m) hits.push(m[0].trim().toLowerCase());
  }
  return [...new Set(hits)].slice(0, 6);
}

// ─── Duplicate detection ──────────────────────────────────────────────────────
//
// Three layers, because each one alone has a hole:
//   1. slug        — catches a literal re-run of the same topic
//   2. exact title — catches a re-worded slug over the same headline
//   3. fuzzy title — catches "Bronx vs. Mt. Vernon HVAC: Who Pays Less?" against
//                    "Bronx vs. Queens AC Repair Costs", which is the real
//                    failure mode. Those two shipped two days apart on
//                    2026-07-30 / 08-01 and competed for the same queries.
//
// Deliberately arithmetic, not a model call: this runs inside the manual
// approval script, where a silent API failure must not be able to fail open.
// findSimilarPublishedTopic() in generate-post.js already fails open on error —
// that is exactly how the HVAC duplicate got through.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'for', 'your', 'you', 'is', 'are',
  'what', 'why', 'how', 'when', 'do', 'does', 'did', 'it', 'its', 'this', 'that',
  'with', 'from', 'at', 'by', 'or', 'vs', 'versus', 'actually', 'really', 'should',
  'could', 'will', 'can', 'be', 'before', 'after', 'about', 'much', 'many', 'more',
]);

// Light normalisation so trivial spelling variants collapse together. "Mt." and
// "Mount" are the same city; "AC" and "A/C" the same system.
const SYNONYMS = {
  mt: 'mount', ac: 'airconditioning', 'a/c': 'airconditioning', hvac: 'airconditioning',
  nyc: 'newyork', apts: 'apartment', apt: 'apartment', apartments: 'apartment',
  landlords: 'landlord', tenants: 'tenant', costs: 'cost', repairs: 'repair',
  buildings: 'building', rentals: 'rental', prices: 'price', fees: 'fee',
};

export function normaliseTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[‐-―−]/g, ' ')
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTokens(title) {
  return normaliseTitle(title)
    .split(' ')
    .map(w => SYNONYMS[w] || w)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

/** Sørensen–Dice over the token sets. 1 = identical, 0 = nothing in common. */
export function titleSimilarity(a, b) {
  const A = new Set(titleTokens(a));
  const B = new Set(titleTokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

// Tuned against the real catalogue: the Mt. Vernon / Queens HVAC pair scores
// above this, while genuinely different posts in the same category score below.
// verify-improvement-governance.js asserts both directions on live titles, so a
// change here that starts swallowing distinct topics fails the check.
export const FUZZY_TITLE_THRESHOLD = 0.55;

// ⚠️ LAYER 4, AND WHY IT EXISTS: TOKEN OVERLAP CANNOT CATCH A RESTATEMENT.
//
// The pair this whole gate was built for —
//   "Bronx vs. Mt. Vernon HVAC: Who Pays Less?"   (2026-07-30)
//   "Bronx vs. Queens AC Repair Costs"            (2026-08-01)
// — scores 0.33 on Dice. They are the same subject two days apart, competing for
// the same queries, and they share only two tokens. Measured against the live
// catalogue, the threshold needed to catch them (0.33) flags 152 of 2,016
// published pairs; at 0.55 it flags 4. There is no threshold that catches this
// pair without rejecting most legitimate new topics. Do not go looking for one.
//
// So layer 4 asks a different question: do the two titles name the same PHYSICAL
// SUBJECT? A curated noun list, normalised through the same synonym map (HVAC
// and AC both become "airconditioning"), restricted to same-category pairs.
// Measured: 23 of 2,016 pairs (1.1%), and it does catch the HVAC pair.
//
// It is deliberately ADVISORY-BUT-BLOCKING in the approval script rather than an
// automatic rejection: 1.1% is a good signal, not a certainty, so it stops and
// asks a human instead of deciding for them.
const SUBJECT_NOUNS = new Set([
  'roof', 'boiler', 'heating', 'radiator', 'plumbing', 'leak', 'pest', 'roach', 'bedbug',
  'electrical', 'panel', 'window', 'facade', 'elevator', 'basement', 'laundry',
  'waterheater', 'airconditioning', 'floor', 'screening', 'deposit', 'eviction',
  'turnover', 'vacancy', 'insurance', 'tax', 'violation', 'super', 'snow', 'flood',
  'lease', 'mold', 'sidewalk', 'trash', 'intercom', 'stairwell', 'boilerroom',
]);

export function subjectNouns(title) {
  return new Set(titleTokens(title).filter(w => SUBJECT_NOUNS.has(w)));
}

/**
 * Published posts in the same category that name the same physical subject.
 * @returns {Array<{slug:string, title:string, shared:string[]}>}
 */
export function findSubjectOverlap(posts, candidate) {
  const mine = subjectNouns(candidate?.title);
  if (!mine.size) return [];
  const category = resolveCategory(candidate?.category) ?? candidate?.category;
  const out = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    if (category && p.category !== category) continue;
    if (p.slug === candidate?.slug) continue;
    const shared = [...subjectNouns(p.title)].filter(n => mine.has(n));
    if (shared.length) out.push({ slug: p.slug, title: p.title, shared });
  }
  return out;
}

/**
 * @returns {null | {kind:'slug'|'exact-title'|'fuzzy-title', title:string, slug:string, score:number}}
 */
export function findDuplicate(posts, candidate, threshold = FUZZY_TITLE_THRESHOLD) {
  const list = Array.isArray(posts) ? posts : [];
  const slug = String(candidate?.slug ?? '').trim().toLowerCase();
  const title = String(candidate?.title ?? '').trim();

  if (slug) {
    const hit = list.find(p => String(p.slug ?? '').toLowerCase() === slug);
    if (hit) return { kind: 'slug', title: hit.title, slug: hit.slug, score: 1 };
  }

  if (title) {
    const norm = normaliseTitle(title);
    const exact = list.find(p => normaliseTitle(p.title) === norm);
    if (exact) return { kind: 'exact-title', title: exact.title, slug: exact.slug, score: 1 };

    let best = null;
    for (const p of list) {
      const score = titleSimilarity(title, p.title);
      if (score >= threshold && (!best || score > best.score)) {
        best = { kind: 'fuzzy-title', title: p.title, slug: p.slug, score: Number(score.toFixed(3)) };
      }
    }
    if (best) return best;
  }

  return null;
}

// ─── Blog-entry schema validation ─────────────────────────────────────────────
//
// A queued brief is NOT a finished post — Nave still writes the body, picks the
// hero image and stamps the date. So this validates the SUBSET of the real
// posts-index.json schema that a recommendation can legitimately specify, and
// rejects anything outside it. An unknown field is an error rather than a
// warning: it is the signature of an entry shaped by something that does not
// know this schema, and it would ride into the published index unnoticed.
export const BRIEF_REQUIRED_FIELDS = ['slug', 'title', 'category', 'excerpt'];
export const BRIEF_OPTIONAL_FIELDS = ['hashtags', 'seoTitle', 'seoDescription', 'author', 'featured'];

// Filled by Nave at generation time. Present in every published entry, but a
// brief that carries them is trying to publish rather than to queue.
export const BRIEF_FORBIDDEN_FIELDS = ['publishedDate', 'minutesToRead', 'heroImage', 'heroImageAlt', 'content'];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateBrief(brief, posts = []) {
  const errors = [];
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
    return { ok: false, errors: ['brief is not an object'] };
  }

  for (const f of BRIEF_REQUIRED_FIELDS) {
    if (typeof brief[f] !== 'string' || !brief[f].trim()) errors.push(`missing required field: ${f}`);
  }
  for (const f of BRIEF_FORBIDDEN_FIELDS) {
    if (f in brief) errors.push(`field "${f}" is written by Nave at publish time and must not be queued`);
  }
  const allowed = new Set([...BRIEF_REQUIRED_FIELDS, ...BRIEF_OPTIONAL_FIELDS]);
  for (const f of Object.keys(brief)) {
    if (!allowed.has(f) && !BRIEF_FORBIDDEN_FIELDS.includes(f)) errors.push(`unknown field: ${f}`);
  }

  if (typeof brief.slug === 'string' && brief.slug && !SLUG_RE.test(brief.slug)) {
    errors.push(`slug "${brief.slug}" is not lowercase-hyphenated`);
  }
  if (typeof brief.slug === 'string' && brief.slug.length > 60) {
    errors.push(`slug is ${brief.slug.length} chars (build-blog.js truncates at 60)`);
  }
  if (brief.category !== undefined && !isApprovedCategory(brief.category)) {
    errors.push(`category "${brief.category}" is not an approved category (${APPROVED_CATEGORIES.join(', ')})`);
  }
  // The same limits the live catalogue satisfies on all 64 entries.
  if (typeof brief.seoTitle === 'string') {
    if (brief.seoTitle.length > 60) errors.push(`seoTitle is ${brief.seoTitle.length} chars (max 60)`);
    if (!/\|\s*DoryAngel$/.test(brief.seoTitle)) errors.push('seoTitle must end with "| DoryAngel"');
  }
  if (typeof brief.seoDescription === 'string' && brief.seoDescription.length > 155) {
    errors.push(`seoDescription is ${brief.seoDescription.length} chars (max 155)`);
  }
  if (brief.hashtags !== undefined) {
    if (!Array.isArray(brief.hashtags) || brief.hashtags.some(h => typeof h !== 'string')) {
      errors.push('hashtags must be an array of strings');
    }
  }
  if (brief.featured !== undefined && typeof brief.featured !== 'boolean') {
    errors.push('featured must be a boolean');
  }
  if (brief.author !== undefined && brief.author !== 'DoryAngel Team') {
    errors.push('author must be "DoryAngel Team"');
  }

  const dup = findDuplicate(posts, brief);
  if (dup) {
    errors.push(
      dup.kind === 'slug'
        ? `duplicate slug — already published as "${dup.title}"`
        : dup.kind === 'exact-title'
          ? `duplicate title — already published as "${dup.title}" (${dup.slug})`
          : `too similar (${dup.score}) to published post "${dup.title}" (${dup.slug}) — recommend improving that post instead of writing a new one`
    );
  }

  return { ok: errors.length === 0, errors, duplicate: dup };
}

// ─── Prioritisation ───────────────────────────────────────────────────────────
//
// Deliberately arithmetic and legible rather than a scoring engine. Three inputs
// on a 1–5 scale; effort divides because a cheap change that ships this week
// beats an expensive one that never does.
export function scoreRecommendation(rec) {
  const clamp = (n, d) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(5, Math.max(1, Math.round(v))) : d;
  };
  const impact     = clamp(rec?.impact, 3);      // expected business impact
  const confidence = clamp(rec?.confidence, 3);  // how good is the evidence
  const effort     = clamp(rec?.effort, 3);      // 1 = trivial, 5 = large
  const score = Number(((impact * confidence) / effort).toFixed(2));
  const priority = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';
  return { impact, confidence, effort, score, priority };
}

/** ARLO-YYYY-MM-DD-NN — stable, sortable, and quotable in an approval command. */
export function makeRecommendationId(dateISO, n) {
  return `ARLO-${dateISO}-${String(n).padStart(2, '0')}`;
}

export const RECOMMENDATION_ID_RE = /^ARLO-\d{4}-\d{2}-\d{2}-\d{2}$/;

// ─── PII guard ────────────────────────────────────────────────────────────────
//
// Lead reporting is aggregate counts only. getMakeStats() already returns nothing
// but counts, so this is a backstop against a future change — and against the
// model, which is handed analytics summaries and could echo an address or an
// email it invented into a recommendation that then gets emailed and committed.
const PII_PATTERNS = [
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'phone', re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g },
  { kind: 'ssn',   re: /\b\d{3}-\d{2}-\d{4}\b/g },
];

// The site's own published contact details are not PII leakage — they are on
// every page of the website already.
// ⚠️ No `g` flag. This constant is used with BOTH .replace() and .test(), and a
// global regex carries lastIndex between .test() calls, so every second call on
// the same string returns false. Callers add `g` locally where they need it.
const PUBLIC_CONTACTS = /office@doryangel\.com|dror75p@gmail\.com|onboarding@resend\.dev|\+?1?\s*\(?516\)?[\s.-]?774[\s.-]?3249/i;

export function findPII(text) {
  const blob = String(text ?? '').replace(new RegExp(PUBLIC_CONTACTS.source, 'gi'), '');
  const hits = [];
  for (const { kind, re } of PII_PATTERNS) {
    const found = blob.match(new RegExp(re.source, re.flags));
    if (found) hits.push(...found.map(v => ({ kind, value: v })));
  }
  return hits;
}

/** Replace anything that looks like PII with a placeholder. Never throws. */
export function redactPII(text) {
  let out = String(text ?? '');
  for (const { kind, re } of PII_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), (m) =>
      PUBLIC_CONTACTS.test(m) ? m : `[redacted-${kind}]`
    );
  }
  return out;
}
