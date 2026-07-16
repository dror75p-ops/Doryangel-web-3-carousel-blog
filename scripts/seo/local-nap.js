// scripts/seo/local-nap.js  —  Arlo SEO sub-skill #4 (READ-ONLY)
//
// Checks Name / Address / Phone (NAP) consistency for DoryAngel against the
// canonical values (from the LocalBusiness JSON-LD, in lib.js) across:
//   1. OUR OWN BUILD — every tel:/address mention in the deployed HTML. This
//      runs offline and catches internal drift (e.g. the business line vs. the
//      "Call AI" number both living in the site).
//   2. EXTERNAL LISTINGS — directory profiles we can fetch (Google Business,
//      Yelp, BBB, Facebook, …). Configure real profile URLs via NAP_LISTINGS;
//      any source we can't fetch is flagged "verify manually", not failed.
//
// Output per source: the value it shows + whether it matches canonical NAP.
//
// Env: NAP_LISTINGS — optional JSON array like
//        [{"source":"Google Business Profile","url":"https://..."}]
//      If unset, a checklist of the major directories is emitted for manual
//      verification (no scraping of gated profiles).

import {
  CANONICAL_NAP, httpGet, listLocalHtml, localPathToUrlPath, readIfExists,
  stripTags, ok, fail, runStandalone,
} from './lib.js';

// Directories DoryAngel should have consistent NAP on. url:null → manual check.
const DEFAULT_LISTINGS = [
  { source: 'Google Business Profile', url: null },
  { source: 'Yelp', url: null },
  { source: 'Better Business Bureau', url: null },
  { source: 'Facebook Page', url: null },
  { source: 'Bing Places', url: null },
  { source: 'Apple Maps / Business Connect', url: null },
];

function digits10(s) { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; }
const CANON_PHONE_10 = digits10(CANONICAL_NAP.phone);

// Extract distinct phone numbers from raw HTML. Only trusts phone-shaped
// contexts — tel: links and separator-formatted visible numbers — so it does
// NOT match the incidental digit runs inside base64 images, JSON-LD ids, etc.
function findPhones(rawHtml) {
  const html = String(rawHtml || '');
  const visible = stripTags(html);
  const seen = new Map();
  const addRaw = (raw) => {
    const norm = digits10(raw);
    if (norm.length === 10 && norm[0] !== '0' && norm[0] !== '1' && !seen.has(norm)) seen.set(norm, { raw: raw.trim(), norm });
  };
  // tel: hrefs (authoritative). Require 10–11 digits.
  for (const m of html.matchAll(/tel:(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/gi)) addRaw(m[1]);
  // Visible, separator-formatted numbers only: a separator is REQUIRED between
  // the area code / exchange / line groups, and the run must be bounded by
  // non-word chars (defeats base64 / hash false positives).
  for (const m of visible.matchAll(/(?<![\w-])(?:\+?1[-.\s])?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}(?![\w-])/g)) addRaw(m[0]);
  return [...seen.values()];
}

function matchesPhone(norm) { return norm === CANON_PHONE_10; }

export async function run() {
  const SKILL = 'local-nap';
  try {
    const results = [];

    // ── 1. Internal build: distinct phones + where they appear ────────────
    const phoneLocations = new Map(); // norm -> {raw, pages:Set}
    let addressPresent = false;
    for (const f of listLocalHtml()) {
      const html = readIfExists(f) || '';
      const urlPath = localPathToUrlPath(f);
      if (html.includes(CANONICAL_NAP.street)) addressPresent = true;
      for (const ph of findPhones(html)) {
        if (!phoneLocations.has(ph.norm)) phoneLocations.set(ph.norm, { raw: ph.raw, pages: new Set() });
        phoneLocations.get(ph.norm).pages.add(urlPath);
      }
    }
    const internalPhones = [...phoneLocations.entries()].map(([norm, v]) => ({
      value: formatPhone(norm),
      matchesCanonical: matchesPhone(norm),
      note: matchesPhone(norm) ? 'matches canonical business line'
        : `NOT the canonical ${CANONICAL_NAP.phone} — appears on ${v.pages.size} page(s), e.g. ${[...v.pages][0]}`,
    }));

    // ── 2. External listings ──────────────────────────────────────────────
    let listings = DEFAULT_LISTINGS;
    if (process.env.NAP_LISTINGS) {
      try { listings = JSON.parse(process.env.NAP_LISTINGS); } catch { /* keep default */ }
    }
    for (const l of listings) {
      if (!l.url) { results.push({ source: l.source, url: null, reachable: false, phone: null, matchesPhone: null, note: 'No profile URL configured — verify NAP manually and add its URL to NAP_LISTINGS.' }); continue; }
      const r = await httpGet(l.url, { timeoutMs: 12000 });
      if (!r.ok) { results.push({ source: l.source, url: l.url, reachable: false, phone: null, matchesPhone: null, note: `Unreachable from this environment (HTTP ${r.status || 'error'}) — verify manually.` }); continue; }
      const text = stripTags(r.text);
      const phones = findPhones(r.text);
      const phone = phones[0] ? formatPhone(phones[0].norm) : null;
      const addrMatch = text.includes(CANONICAL_NAP.street) && text.includes(CANONICAL_NAP.postalCode);
      results.push({
        source: l.source, url: l.url, reachable: true,
        phone, matchesPhone: phone ? matchesPhone(digits10(phone)) : null,
        addressMatches: addrMatch,
        note: phone && !matchesPhone(digits10(phone)) ? `Phone ${phone} ≠ canonical ${CANONICAL_NAP.phone}`
          : (!phone ? 'No phone found on page' : 'Phone matches canonical'),
      });
    }

    const internalConsistent = internalPhones.every(p => p.matchesCanonical);
    const externalMismatches = results.filter(r => r.matchesPhone === false || (r.reachable && r.addressMatches === false)).length;

    return ok(SKILL, {
      canonicalNAP: { name: CANONICAL_NAP.name, address: CANONICAL_NAP.address, phone: CANONICAL_NAP.phone },
      internal: {
        addressPresentInBuild: addressPresent,
        distinctPhones: internalPhones,
        consistent: internalConsistent,
        note: internalConsistent ? 'Only the canonical business line appears in the build.'
          : 'Multiple phone numbers appear in the build — confirm each is intentional (e.g. a separate voice/AI line) or unify.',
      },
      externalListings: results,
      summary: {
        internalConsistent,
        externalMismatches,
        manualChecksNeeded: results.filter(r => r.url === null || !r.reachable).length,
      },
    });
  } catch (err) {
    return fail(SKILL, `local-nap crashed: ${err.message}`);
  }
}

function formatPhone(n10) { return `+1 ${n10.slice(0, 3)}-${n10.slice(3, 6)}-${n10.slice(6)}`; }

runStandalone(import.meta.url, run);
