// scripts/seo/technical-audit.js  —  Arlo SEO sub-skill #1 (READ-ONLY)
//
// Crawls the site and reports, severity-ranked:
//   • broken internal links (with the source page)
//   • SOFT-404s — a URL that 200s but serves homepage content / wrong canonical
//     (this is the Wix→Vercel catch-all bug that dropped us pos 5→47; prioritized)
//   • pages missing or duplicating <title> / meta description
//   • canonical ⇄ og:url mismatches and off-host canonicals
//   • orphan pages (in sitemap or on disk but linked nowhere internally)
//
// Modes:
//   LIVE  — GET www.doryangel.com (default; used by n8n / GitHub Actions).
//   LOCAL — if the live site is unreachable (sandbox egress policy, offline),
//           analyze the checked-out build (index.html, blog/*, sitemap.xml).
//           Soft-404 *serving* behavior only exists live, so LOCAL notes that
//           and runs the canonical-self-consistency proxy instead.
//
// Env: SEO_BASE_URL (default https://www.doryangel.com),
//      SEO_CRAWL_MODE = auto|live|local (default auto),
//      SEO_MAX_PAGES (default 400).

import {
  SITE_URL, httpGet, liveSiteReachable, parseHead, extractLinks, parseSitemapUrls,
  listLocalHtml, localPathToUrlPath, readIfExists, repoPath, ok, fail,
  SEV, SEV_LABEL, runStandalone,
} from './lib.js';

const MAX_PAGES = parseInt(process.env.SEO_MAX_PAGES || '400', 10);
const MODE_PREF = (process.env.SEO_CRAWL_MODE || 'auto').toLowerCase();

// A page record: { urlPath, status, head, links[], bodyLen, sig, source }
function signature(head, bodyLen) {
  // Cheap fingerprint to detect "this page is actually the homepage".
  return `${(head.title || '').toLowerCase()}|${(head.h1 || '').toLowerCase()}|${Math.round(bodyLen / 500)}`;
}

async function buildLiveMap() {
  const pages = new Map();      // urlPath -> record
  const linkStatus = new Map(); // urlPath -> http status (for broken-link check)
  const host = new URL(SITE_URL).host;

  const seeds = new Set(['/']);
  const sitemapXml = (await httpGet(SITE_URL + '/sitemap.xml')).text;
  for (const loc of parseSitemapUrls(sitemapXml)) {
    try { const u = new URL(loc); if (u.host === host) seeds.add(u.pathname); } catch {}
  }

  const queue = [...seeds];
  const seen = new Set();
  while (queue.length && pages.size < MAX_PAGES) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const res = await httpGet(SITE_URL + p);
    linkStatus.set(p, res.status);
    if (!res.ok || !/text\/html/i.test(res.headers?.get?.('content-type') || 'text/html')) continue;
    const head = parseHead(res.text);
    const links = extractLinks(res.text, p);
    // finalUrl path (after redirects) matters for soft-404: a 200 that landed on "/"
    let finalPath = p;
    try { finalPath = new URL(res.finalUrl).pathname; } catch {}
    pages.set(p, {
      urlPath: p, status: res.status, finalPath, head, links,
      bodyLen: res.text.length, sig: signature(head, res.text.length), source: 'live',
    });
    for (const l of links) if (!seen.has(l) && pages.size + queue.length < MAX_PAGES) queue.push(l);
  }

  // Resolve status for any linked-to path we didn't fetch as a page.
  const allTargets = new Set();
  for (const rec of pages.values()) rec.links.forEach(l => allTargets.add(l));
  for (const t of allTargets) {
    if (linkStatus.has(t)) continue;
    const r = await httpGet(SITE_URL + t, { method: 'GET', timeoutMs: 12000 });
    linkStatus.set(t, r.status);
  }
  return { pages, linkStatus, sitemapUrls: parseSitemapUrls(sitemapXml), host };
}

function buildLocalMap() {
  const pages = new Map();
  const files = listLocalHtml();
  const knownPaths = new Set();
  for (const f of files) knownPaths.add(localPathToUrlPath(f));
  for (const f of files) {
    const html = readIfExists(f) || '';
    const urlPath = localPathToUrlPath(f);
    const head = parseHead(html);
    const links = extractLinks(html, urlPath);
    pages.set(urlPath, {
      urlPath, status: 200, finalPath: urlPath, head, links,
      bodyLen: html.length, sig: signature(head, html.length), source: 'local',
    });
  }
  const sitemapXml = readIfExists(repoPath('sitemap.xml')) || '';
  const host = new URL(SITE_URL).host;
  return { pages, knownPaths, sitemapUrls: parseSitemapUrls(sitemapXml), host };
}

export async function run() {
  const SKILL = 'technical-audit';
  try {
    let mode = MODE_PREF;
    if (mode === 'auto') mode = (await liveSiteReachable()) ? 'live' : 'local';

    const issues = [];
    const add = (severity, type, detail) => issues.push({ severity, type, ...detail });

    let map, sitemapUrls, host, knownPaths;
    if (mode === 'live') {
      ({ pages: map, sitemapUrls, host } = await liveWrap());
    } else {
      ({ pages: map, sitemapUrls, host, knownPaths } = buildLocalMap());
    }

    const home = map.get('/');
    const sitemapPaths = new Set(sitemapUrls.map(u => { try { return new URL(u).pathname; } catch { return u; } }));

    // ── broken internal links ─────────────────────────────────────────────
    if (mode === 'live') {
      const { linkStatus } = liveState;
      for (const [, rec] of map) {
        for (const l of rec.links) {
          const st = linkStatus.get(l);
          if (st && (st >= 400 || st === 0)) {
            add(SEV.CRITICAL, 'broken-link',
              { url: l, source: rec.urlPath, note: `HTTP ${st || 'unreachable'} from link on ${rec.urlPath}` });
          }
        }
      }
    } else {
      const seenBroken = new Set();
      for (const [, rec] of map) {
        for (const l of rec.links) {
          const t = l === '/index.html' ? '/' : l;
          if (!t.startsWith('/') || isNonHtmlAsset(t)) continue; // assets can't be verified offline
          if (knownPaths.has(t) || knownPaths.has(norm(t)) || knownPaths.has(t + '/')) continue;
          const key = `${t}<=${rec.urlPath}`;
          if (seenBroken.has(key)) continue;
          seenBroken.add(key);
          add(SEV.HIGH, 'broken-link-local',
            { url: t, source: rec.urlPath, note: `Link on ${rec.urlPath} → ${t} has no matching file on disk (verify live)` });
        }
      }
    }

    // ── SOFT-404 detector (priority) ──────────────────────────────────────
    if (mode === 'live' && home) {
      for (const [, rec] of map) {
        if (rec.urlPath === '/') continue;
        // (a) 200 but the request was redirected to the homepage
        if (rec.status === 200 && rec.finalPath === '/') {
          add(SEV.CRITICAL, 'soft-404',
            { url: rec.urlPath, note: '200 OK but content resolved to the homepage (catch-all soft-404)' });
          continue;
        }
        // (b) 200 but body fingerprint matches the homepage
        if (rec.status === 200 && rec.sig === home.sig && rec.head.title === home.head.title) {
          add(SEV.CRITICAL, 'soft-404',
            { url: rec.urlPath, note: 'Serves homepage title/H1/body — likely soft-404' });
          continue;
        }
        // (c) canonical points at the homepage from a non-home page
        if (rec.head.canonical) {
          let cp = null; try { cp = new URL(rec.head.canonical).pathname; } catch {}
          if (cp === '/' ) add(SEV.CRITICAL, 'soft-404',
            { url: rec.urlPath, note: 'Canonical points to "/" from a sub-page (soft-404 signal)' });
        }
      }
      // (d) spot-check old Wix /post/... redirects still 301 (not 200→homepage)
      const wixSamples = extractWixRedirectSources().slice(0, 8);
      for (const src of wixSamples) {
        const r = await httpGet(SITE_URL + src, { timeoutMs: 12000 });
        let fp = src; try { fp = new URL(r.finalUrl).pathname; } catch {}
        if (r.status === 200 && fp === '/') {
          add(SEV.CRITICAL, 'soft-404-redirect',
            { url: src, note: 'Old Wix URL 200s onto the homepage instead of 301-redirecting (the PR #226 bug class)' });
        }
      }
    } else if (mode === 'local') {
      add(SEV.LOW, 'soft-404-skipped', {
        url: '(live crawl)',
        note: 'Soft-404 serving behavior only exists live; the live site was unreachable from this environment, ' +
              'so the live soft-404 probe was skipped. Canonical-self-consistency (below) is the offline proxy. ' +
              'Re-run with network access to the live site (n8n / GitHub Actions) for the real check.',
      });
    }

    // ── canonical / og consistency (both modes) ───────────────────────────
    for (const [, rec] of map) {
      const { canonical, ogUrl } = rec.head;
      if (canonical) {
        let ch = null, cp = null;
        try { const u = new URL(canonical); ch = u.host; cp = u.pathname; } catch {}
        if (ch && ch !== host) add(SEV.HIGH, 'canonical-offhost',
          { url: rec.urlPath, note: `Canonical host ${ch} ≠ ${host}` });
        // self-canonical mismatch (ignore home which may canonicalize to "/")
        if (cp && rec.urlPath !== '/' && norm(cp) !== norm(rec.urlPath))
          add(SEV.MEDIUM, 'canonical-mismatch',
            { url: rec.urlPath, note: `Canonical ${cp} ≠ page path ${rec.urlPath}` });
      }
      if (canonical && ogUrl && norm(safePath(canonical)) !== norm(safePath(ogUrl)))
        add(SEV.MEDIUM, 'canonical-og-mismatch',
          { url: rec.urlPath, note: `canonical (${safePath(canonical)}) ≠ og:url (${safePath(ogUrl)})` });
    }

    // ── missing / duplicate title & meta description ──────────────────────
    const titleMap = new Map(), descMap = new Map();
    for (const [, rec] of map) {
      if (isUtilityPage(rec.urlPath)) continue; // 404 / google-verification stubs aren't indexable pages
      if (!rec.head.title) add(SEV.HIGH, 'missing-title', { url: rec.urlPath, note: 'No <title>' });
      else pushMap(titleMap, rec.head.title, rec.urlPath);
      if (!rec.head.description) add(SEV.MEDIUM, 'missing-meta-description', { url: rec.urlPath, note: 'No meta description' });
      else pushMap(descMap, rec.head.description, rec.urlPath);
    }
    for (const [title, urls] of titleMap) if (urls.length > 1)
      add(SEV.MEDIUM, 'duplicate-title', { url: urls.join(', '), note: `${urls.length} pages share title "${trunc(title)}"` });
    for (const [desc, urls] of descMap) if (urls.length > 1)
      add(SEV.MEDIUM, 'duplicate-meta-description', { url: urls.join(', '), note: `${urls.length} pages share meta description "${trunc(desc)}"` });

    // ── orphan pages (in sitemap/on disk but linked nowhere internally) ────
    const linkedTo = new Set(['/']);
    for (const [, rec] of map) rec.links.forEach(l => linkedTo.add(norm(l)));
    const universe = new Set([...map.keys(), ...sitemapPaths]);
    for (const p of universe) {
      if (p === '/' || isNonHtmlAsset(p)) continue;
      if (!linkedTo.has(norm(p))) {
        const inSitemap = sitemapPaths.has(p) || sitemapPaths.has(p.replace(/\/$/, ''));
        add(inSitemap ? SEV.MEDIUM : SEV.LOW, 'orphan-page',
          { url: p, note: inSitemap ? 'In sitemap but not linked from any crawled page' : 'On disk but neither in sitemap nor internally linked' });
      }
    }
    // Sitemap URLs that don't exist as pages at all.
    for (const p of sitemapPaths) {
      if (!map.has(p) && !map.has(p.replace(/\/$/, '')) && !map.has(p + '/') && mode === 'local')
        add(SEV.MEDIUM, 'sitemap-missing-page', { url: p, note: 'Listed in sitemap.xml but no matching file on disk' });
    }

    issues.sort((a, b) => a.severity - b.severity);
    const bySeverity = SEV_LABEL.map((label, i) => ({ label, count: issues.filter(x => x.severity === i).length }));

    return ok(SKILL, {
      mode,
      pagesAnalyzed: map.size,
      sitemapUrls: sitemapUrls.length,
      totalIssues: issues.length,
      bySeverity,
      issues: issues.map(i => ({ severity: SEV_LABEL[i.severity], type: i.type, url: i.url, note: i.note })),
    });
  } catch (err) {
    return fail(SKILL, `technical-audit crashed: ${err.message}`);
  }
}

// live crawl needs its linkStatus shared with the analysis block
let liveState = null;
async function liveWrap() {
  liveState = await buildLiveMap();
  return { pages: liveState.pages, sitemapUrls: liveState.sitemapUrls, host: liveState.host };
}

// ── small helpers ────────────────────────────────────────────────────────────
function norm(p) { return (p || '').replace(/\/+$/, '') || '/'; }
function safePath(u) { try { return new URL(u).pathname; } catch { return u; } }
function pushMap(m, k, v) { if (!m.has(k)) m.set(k, []); m.get(k).push(v); }
function trunc(s, n = 60) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }
function isNonHtmlAsset(p) { return /\.(png|jpe?g|svg|webp|gif|ico|css|js|json|xml|txt|pdf|woff2?|map|xlsx?|docx?|csv|zip)(\?|$)/i.test(p); }
function isUtilityPage(p) { return p === '/404.html' || /^\/google[0-9a-f]+\.html$/i.test(p); }

// Parse the old-Wix /post/... redirect sources from vercel.json (for the live probe).
function extractWixRedirectSources() {
  try {
    const cfg = JSON.parse(readIfExists(repoPath('vercel.json')) || '{}');
    return (cfg.redirects || []).map(r => r.source).filter(s => typeof s === 'string' && s.startsWith('/post'));
  } catch { return []; }
}

runStandalone(import.meta.url, run);
