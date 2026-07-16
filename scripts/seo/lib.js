// scripts/seo/lib.js
// Shared helpers for Arlo's SEO audit suite (read-only).
//
// Every sub-skill imports from here. Nothing in this file — or anywhere in
// scripts/seo/ — is allowed to WRITE, EDIT, PUBLISH, or DEPLOY the live site.
// The suite only READS (HTTP GET + local file reads) and produces reports.
//
// Conventions mirror scripts/daily-audit.js (Arlo): ESM, env-var config only,
// fail-soft (never throw out of a sub-skill — return a {status} result), and
// the same hand-rolled service-account JWT used for Google APIs.

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { createSign } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

export const AGENT_NAME = 'Arlo';
export const SUITE_NAME = 'seo';

// ─── Site facts (canonical source of truth) ───────────────────────────────────

export const SITE_URL = (process.env.SEO_BASE_URL || 'https://www.doryangel.com').replace(/\/$/, '');

// Canonical NAP — lifted from the LocalBusiness JSON-LD in index.html.
// This is what every external listing SHOULD match. If the business's real
// address/phone differs, update it here (it's the single source of truth for
// the local-nap check) — do not hard-code NAP anywhere else.
export const CANONICAL_NAP = {
  name: 'DoryAngel LLC',
  // Common display variants the checker treats as a match for `name`.
  nameAliases: ['DoryAngel', 'Dory Angel', 'DoryAngel Property Management', 'DoryAngel LLC'],
  phone: '+15168474999',           // 516-847-4999 — the business line in JSON-LD
  street: '557 Grand Concourse',
  city: 'Bronx',
  region: 'NY',
  postalCode: '10451',
  get address() { return `${this.street}, ${this.city}, ${this.region} ${this.postalCode}`; },
};

// Service areas (from areaServed in the JSON-LD). Drives content-gap + local seeds.
export const SERVICE_AREAS = ['Bronx', 'Queens', 'Yonkers', 'Mount Vernon', 'New Rochelle', 'North Jersey'];

// ─── Time / small utils ───────────────────────────────────────────────────────

export function today() { return new Date().toISOString().split('T')[0]; }

export function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
}

export function pct(a, b) {
  if (!b) return a ? Infinity : 0;
  return ((a - b) / b) * 100;
}

export function fmtPct(n) {
  if (n === Infinity) return 'new';
  if (n === -100) return '-100%';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(1)}%`;
}

export function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'");
}

// ─── Repo paths (for the local-filesystem crawl fallback) ─────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dir, '..', '..');

export function repoPath(...p) { return join(REPO_ROOT, ...p); }

// Every deployable .html file in the repo, excluding dev-only trees that
// .vercelignore keeps out of the deploy.
export function listLocalHtml() {
  const skip = new Set(['project', 'chats', 'node_modules', '.git', 'scripts']);
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.html')) out.push(full);
    }
  })(REPO_ROOT);
  return out;
}

// Map a local file path to the public URL path it deploys to.
// Vercel serves `foo/index.html` at `/foo/` and `bar.html` at `/bar.html`.
export function localPathToUrlPath(fullPath) {
  let rel = fullPath.slice(REPO_ROOT.length).replace(/\\/g, '/');
  if (!rel.startsWith('/')) rel = '/' + rel;
  if (rel.endsWith('/index.html')) rel = rel.slice(0, -'index.html'.length);
  if (rel === '/index.html') rel = '/';
  return rel;
}

// ─── HTML head extraction ─────────────────────────────────────────────────────

export function parseHead(html) {
  const pick = (re) => { const m = html.match(re); return m ? decodeEntities(m[1].trim()) : null; };
  return {
    title:       pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description: pick(/<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i),
    canonical:   pick(/<link[^>]+rel=["']canonical["'][^>]*href=["']([\s\S]*?)["']/i),
    ogTitle:     pick(/<meta[^>]+property=["']og:title["'][^>]*content=["']([\s\S]*?)["']/i),
    ogUrl:       pick(/<meta[^>]+property=["']og:url["'][^>]*content=["']([\s\S]*?)["']/i),
    robots:      pick(/<meta[^>]+name=["']robots["'][^>]*content=["']([\s\S]*?)["']/i),
    h1:          pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i),
  };
}

// All internal href targets on a page, normalized to site-absolute URL paths.
export function extractLinks(html, fromUrlPath) {
  const links = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') ||
        href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    // Only internal links (same host or relative).
    if (/^https?:\/\//i.test(href)) {
      try {
        const u = new URL(href);
        if (u.host !== new URL(SITE_URL).host) continue;
        href = u.pathname + (u.search || '');
      } catch { continue; }
    } else if (href.startsWith('//')) {
      continue; // protocol-relative external
    } else {
      // Resolve relative against the current page path.
      try { href = new URL(href, SITE_URL + fromUrlPath).pathname; } catch { continue; }
    }
    links.add(href.replace(/#.*$/, ''));
  }
  return [...links];
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────

export function parseSitemapUrls(xml) {
  const out = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

// ─── Network (read-only GET, with timeout) ────────────────────────────────────

export async function httpGet(url, { timeoutMs = 15000, method = 'GET' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'DoryAngel-SEO-Audit/1.0 (+Arlo; read-only)' },
    });
    const text = method === 'HEAD' ? '' : await res.text();
    return { ok: res.ok, status: res.status, url, finalUrl: res.url, text, headers: res.headers };
  } catch (err) {
    return { ok: false, status: 0, url, finalUrl: url, text: '', error: err.message };
  } finally {
    clearTimeout(t);
  }
}

// Quick probe: can we actually GET the live homepage as HTML from here?
// A 403/407 from an egress proxy, a timeout, or a non-HTML body all count as
// "not reachable" → the crawl falls back to the checked-out build.
export async function liveSiteReachable() {
  const r = await httpGet(SITE_URL + '/', { timeoutMs: 8000 });
  return r.ok && /<html|<!doctype/i.test(r.text);
}

// ─── Google service-account access token (same JWT as daily-audit.js) ─────────

export async function getGoogleAccessToken(credentials, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope,
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

export function parseServiceAccount(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* maybe base64 */ }
  try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { return null; }
}

// ─── Sub-skill result shape ───────────────────────────────────────────────────
//
// Every sub-skill returns { skill, status, ...payload }.
//   status: 'ok'      → ran and produced data
//           'skipped' → a required env var / dependency was missing (note why)
//           'error'   → unexpected failure (note the message); NEVER throws out
//
// `skip()` and `fail()` build those results so a missing key degrades the
// report instead of crashing the run (hard constraint).

export function ok(skill, payload) { return { skill, status: 'ok', ...payload }; }
export function skip(skill, note) { return { skill, status: 'skipped', note }; }
export function fail(skill, note) { return { skill, status: 'error', note }; }

export const SEV = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
export const SEV_LABEL = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// Read a local file if present, else null (never throws).
export function readIfExists(path) {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null; } catch { return null; }
}

// Standard standalone-runner guard: `node scripts/seo/<skill>.js` runs it and
// pretty-prints JSON. Sub-skills call this at the bottom of their module.
export async function runStandalone(importMetaUrl, fn) {
  const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
  if (!invoked) return;
  try {
    const result = await fn();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`[${SUITE_NAME}] fatal:`, err.message);
    process.exit(1);
  }
}
