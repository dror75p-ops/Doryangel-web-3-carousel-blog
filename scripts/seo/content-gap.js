// scripts/seo/content-gap.js  —  Arlo SEO sub-skill #5 (READ-ONLY)
//
// Compares our existing /blog/ topics against common landlord / property-owner
// search themes for our service areas (Bronx, Queens, Yonkers, Mount Vernon,
// New Rochelle) and outputs a RANKED list of blog topics we have no page for —
// ready to feed the Blog Queue.
//
// Runs fully offline (reads content/blog/posts-index.json + a seed theme list).
// If ANTHROPIC_API_KEY is set, it optionally asks Claude to sharpen the top
// titles into Nave's proven owner-facing format — but falls back to the
// deterministic list if the call fails (never crashes).
//
// Env: ANTHROPIC_API_KEY (optional), SEO_CONTENT_GAP_TOP (default 12).

import { readIfExists, repoPath, SERVICE_AREAS, ok, fail, runStandalone } from './lib.js';

const TOP = parseInt(process.env.SEO_CONTENT_GAP_TOP || '12', 10);

// Evergreen landlord/property-owner search themes. `weight` = search-demand ×
// commercial intent (owner-facing, per CLAUDE.md content strategy). `kw` are
// the tokens used to detect whether an existing post already covers the theme.
const THEMES = [
  { theme: 'Security deposit law & limits', weight: 9, kw: ['security deposit'], geo: true },
  { theme: 'Eviction process / housing court', weight: 9, kw: ['eviction', 'housing court'], geo: true },
  { theme: 'Rent increase rules & rent stabilization', weight: 9, kw: ['rent increase', 'rent stabiliz', 'rent control'], geo: true },
  { theme: 'Tenant screening without getting sued', weight: 10, kw: ['tenant screen', 'screening'], geo: true },
  { theme: 'Cost of property management / flat-fee vs %', weight: 10, kw: ['flat-fee', 'flat fee', 'cost', 'percentage', 'commission', '$99'], geo: true },
  { theme: 'How to choose / find a property manager', weight: 8, kw: ['choose a property manager', 'find a property manager', 'hire a property manager', 'what should a property manager'], geo: true },
  { theme: 'Landlord insurance requirements & costs', weight: 8, kw: ['insurance'], geo: true },
  { theme: 'Property tax / tax deductions for landlords', weight: 9, kw: ['property tax', 'tax deduction', 'taxes'], geo: true },
  { theme: 'Good Cause Eviction compliance', weight: 8, kw: ['good cause'], geo: false },
  { theme: 'Local Law / HPD violation compliance', weight: 8, kw: ['local law', 'hpd', 'violation', 'compliance'], geo: true },
  { theme: 'Lead paint / Local Law 31 compliance', weight: 7, kw: ['lead paint', 'local law 31', 'lead-based'], geo: false },
  { theme: 'Certificate of occupancy / legal apartments', weight: 6, kw: ['certificate of occupancy', 'legal apartment', 'illegal unit'], geo: false },
  { theme: 'Reducing vacancy / turnover time', weight: 8, kw: ['vacancy', 'turnover'], geo: true },
  { theme: 'Rent collection & late-payment handling', weight: 7, kw: ['rent collection', 'late payment', 'late rent'], geo: true },
  { theme: 'Maintenance & repair responsibilities', weight: 7, kw: ['maintenance', 'repair'], geo: true },
  { theme: 'Section 8 / housing voucher landlords', weight: 7, kw: ['section 8', 'voucher', 'housing choice'], geo: true },
  { theme: 'Rental property ROI / cap rate analysis', weight: 8, kw: ['roi', 'cap rate', 'return on investment', 'rent-to-value', 'rent to value'], geo: true },
  { theme: '1031 exchange for rental owners', weight: 6, kw: ['1031', 'exchange'], geo: false },
  { theme: 'Short-term rental (Airbnb) rules', weight: 6, kw: ['short-term rental', 'short term rental', 'airbnb'], geo: true },
  { theme: 'Self-managing vs hiring a PM', weight: 9, kw: ['self-manag', 'self manag', 'diy', 'vs flat-fee', 'vs hire'], geo: true },
  { theme: 'Lease renewal strategy', weight: 7, kw: ['lease renewal', 'renewal'], geo: true },
  { theme: 'Smart-home / PropTech for landlords', weight: 6, kw: ['smart sensor', 'smart home', 'ai camera', 'automation', 'proptech', 'technology'], geo: true },
];

// Area weighting per CLAUDE.md: Bronx is primary; adjacent boroughs allowed.
const AREA_WEIGHT = { 'Bronx': 1.0, 'Queens': 0.7, 'Yonkers': 0.6, 'Mount Vernon': 0.55, 'New Rochelle': 0.5, 'North Jersey': 0.4 };

function loadPosts() {
  const raw = readIfExists(repoPath('content', 'blog', 'posts-index.json'));
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function covers(post, kws) {
  const hay = `${post.title || ''} ${post.slug || ''} ${post.excerpt || ''} ${post.seoTitle || ''}`.toLowerCase();
  return kws.some(k => hay.includes(k.toLowerCase()));
}

// Detect which service areas a post already anchors on.
function postAreas(post) {
  const hay = `${post.title || ''} ${post.slug || ''} ${post.excerpt || ''}`.toLowerCase();
  return SERVICE_AREAS.filter(a => hay.includes(a.toLowerCase()));
}

export async function run() {
  const SKILL = 'content-gap';
  try {
    const posts = loadPosts();
    if (!posts.length) return fail(SKILL, 'content/blog/posts-index.json missing or empty — cannot compute content gaps.');

    const areaCoverage = {};
    for (const a of SERVICE_AREAS) areaCoverage[a] = 0;
    for (const p of posts) for (const a of postAreas(p)) areaCoverage[a]++;

    const gaps = [];
    for (const t of THEMES) {
      const postsCovering = posts.filter(p => covers(p, t.kw));
      const coveredAreas = new Set();
      postsCovering.forEach(p => postAreas(p).forEach(a => coveredAreas.add(a)));

      if (!t.geo) {
        // Non-geo theme: a single page covers it site-wide.
        if (postsCovering.length === 0)
          gaps.push({ theme: t.theme, area: null, score: t.weight, suggestedTitle: null, coveredBy: [] });
        continue;
      }
      // Geo theme: flag each *uncovered* service area (Bronx-priority weighting).
      for (const area of SERVICE_AREAS) {
        const areaCovered = postsCovering.some(p => postAreas(p).includes(area));
        if (!areaCovered) {
          gaps.push({
            theme: t.theme, area,
            score: +(t.weight * (AREA_WEIGHT[area] || 0.4)).toFixed(2),
            suggestedTitle: null,
            coveredBy: postsCovering.slice(0, 2).map(p => p.slug),
          });
        }
      }
    }

    gaps.sort((a, b) => b.score - a.score);
    const top = gaps.slice(0, TOP);
    top.forEach(g => { g.suggestedTitle = deterministicTitle(g); });

    // Optional: sharpen the top titles with Claude (Nave's owner-facing formula).
    let enrichedWith = 'deterministic';
    if (process.env.ANTHROPIC_API_KEY) {
      const sharpened = await sharpenTitles(top).catch(() => null);
      if (sharpened) { top.forEach((g, i) => { if (sharpened[i]) g.suggestedTitle = sharpened[i]; }); enrichedWith = 'claude'; }
    }

    return ok(SKILL, {
      existingPosts: posts.length,
      areaCoverage,
      totalGaps: gaps.length,
      titlesFrom: enrichedWith,
      topGaps: top,
    });
  } catch (err) {
    return fail(SKILL, `content-gap crashed: ${err.message}`);
  }
}

// Deterministic owner-facing title in Nave's proven shape (pain-first + geo).
function deterministicTitle(g) {
  const area = g.area || 'Bronx';
  const m = {
    'Good Cause Eviction compliance': `Is Your ${area} Building Good Cause Eviction Compliant? A 2026 Checklist`,
    'Lead paint / Local Law 31 compliance': `The Lead-Paint (Local Law 31) Deadlines Costing ${area} Landlords Big Fines`,
    'Certificate of occupancy / legal apartments': `Is Your ${area} Rental Unit Legal? What Your Certificate of Occupancy Really Says`,
    '1031 exchange for rental owners': `How ${area} Landlords Use a 1031 Exchange to Defer Taxes on a Sale`,
    'Security deposit law & limits': `What Every ${area} Landlord Must Know About Security Deposit Limits in 2026`,
    'Eviction process / housing court': `How the ${area} Eviction Process Actually Works (and What It Costs You)`,
    'Rent increase rules & rent stabilization': `How Much Can You Legally Raise Rent on Your ${area} Rental in 2026?`,
    'Tenant screening without getting sued': `How to Screen Tenants in ${area} Without Getting Sued`,
    'Cost of property management / flat-fee vs %': `Flat-Fee vs. Percentage: What Property Management Really Costs ${area} Owners`,
    'How to choose / find a property manager': `What Should a ${area} Property Manager Actually Do for You?`,
    'Landlord insurance requirements & costs': `What Landlord Insurance Really Costs ${area} Owners in 2026`,
    'Property tax / tax deductions for landlords': `The Tax Deductions ${area} Landlords Miss Every Year`,
    'Local Law / HPD violation compliance': `The HPD Violations Costing ${area} Landlords the Most in 2026`,
    'Reducing vacancy / turnover time': `How to Cut Vacancy Time in Half on Your ${area} Rental`,
    'Rent collection & late-payment handling': `How ${area} Landlords Can Stop Losing Money to Late Rent`,
    'Maintenance & repair responsibilities': `Which Repairs Are You Legally On the Hook For as a ${area} Landlord?`,
    'Section 8 / housing voucher landlords': `Should You Accept Section 8 Vouchers on Your ${area} Rental?`,
    'Rental property ROI / cap rate analysis': `Is Your ${area} Rental Actually Making Money? A Real ROI Breakdown`,
    'Short-term rental (Airbnb) rules': `Can You Legally Airbnb Your ${area} Rental in 2026?`,
    'Self-managing vs hiring a PM': `Self-Managing Your ${area} Rental vs. Hiring a Manager: The Real Math`,
    'Lease renewal strategy': `The Lease-Renewal Moves ${area} Landlords Are Leaving Money On`,
    'Smart-home / PropTech for landlords': `The PropTech Upgrades Saving ${area} Landlords the Most in 2026`,
  };
  return m[g.theme] || `What ${area} Landlords Need to Know About ${g.theme}`;
}

async function sharpenTitles(gaps) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  const list = gaps.map((g, i) => `${i + 1}. Theme: ${g.theme} | Area: ${g.area || 'Bronx'}`).join('\n');
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are Nave, DoryAngel's blog title writer. For each theme+area below, write ONE blog title in the proven owner-facing formula: lead with the OWNER'S pain/cost, address them as "you/your", include a number/$/law where natural, anchor to the given area (Bronx primary). Return ONLY a JSON array of ${gaps.length} strings, in order.\n\n${list}`,
    }],
  });
  const text = msg.content.map(b => b.text || '').join('');
  const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  return Array.isArray(arr) ? arr : null;
}

runStandalone(import.meta.url, run);
