// social-post.js — Vera: DoryAngel's social distribution agent
// Reads the handoff file left by Nave and posts to the DoryAngel Facebook Page.
//
// TWO INVARIANTS — see CLAUDE.md before changing either:
//   1. Vera must NEVER fail the workflow. Every path exits 0. A social hiccup
//      must not block a post that is already written, built and committed.
//   2. Vera runs AFTER the commit/push step, so the blog page is already on its
//      way to Vercel when the link goes out. Do not move it back before commit.
//
// Anything Vera skips or fails is emitted as a GitHub Actions annotation. A
// plain console.log is not enough: an empty FACEBOOK_PAGE_ACCESS_TOKEN silently
// skipped every post from 2026-06-20 to 2026-07-27 on green checkmarks.

// Resend is imported dynamically inside emailFallback(), not at the top level:
// a top-level import throws at module load, before any try/catch can run, so a
// missing dependency would take the whole step down. See invariant 1 above.
import { readFileSync, existsSync } from 'fs';

const AGENT_NAME     = 'Vera';
const BASE_URL       = 'https://www.doryangel.com';
const QUEUE_FILE     = '/tmp/social-queue.json';
const GRAPH          = 'https://graph.facebook.com/v22.0';
const APPROVAL_EMAIL = 'dror75p@gmail.com';

// Vercel redeploys ~1 min after the commit lands, so poll the post URL before
// handing Facebook a link that would 404 for whoever clicks it first.
const READY_TRIES    = 6;
const READY_DELAY_MS = 15_000;

const log  = m => console.log(`[${AGENT_NAME}] ${m}`);
const warn = m => console.log(`::warning title=${AGENT_NAME}::${m}`);
const fail = m => console.log(`::error title=${AGENT_NAME}::${m}`);

const escapeHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Graph normally answers JSON, but an edge 5xx or a proxy in the way answers
// HTML — parsing that blind turns a readable outage into "Unexpected token '<'".
async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: `non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}` } };
  }
}

// Graph errors carry code/subcode alongside the message — keep them, they are
// the difference between "token expired" and "caption rejected".
function graphError(data, res) {
  const e     = data?.error ?? {};
  const parts = [e.message ?? `HTTP ${res.status}`];
  if (e.code !== undefined) parts.push(`code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''}`);
  let msg = parts.join(' — ');
  if (e.code === 190) {
    msg += ' — the Page access token is expired or invalid. Remint a long-lived Page token (CLAUDE.md → Vera / Facebook token) and update the FACEBOOK_PAGE_ACCESS_TOKEN secret.';
  }
  return new Error(msg);
}

// VERA_VERIFY mode: confirm the token works and names the right Page, post nothing.
async function verifyToken(token) {
  const res  = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
  const data = await readJson(res);
  if (!res.ok) throw graphError(data, res);
  return data;
}

async function waitForPage(url) {
  for (let i = 1; i <= READY_TRIES; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        log(`Blog page live after ${i} check${i > 1 ? 's' : ''}`);
        return true;
      }
    } catch {
      // network blip — treat exactly like not-ready and try again
    }
    if (i < READY_TRIES) await new Promise(r => setTimeout(r, READY_DELAY_MS));
  }
  // Fail open: a slow deploy is not a reason to drop the post entirely.
  log(`Blog page still not responding after ${READY_TRIES} checks — posting anyway`);
  return false;
}

async function postToFacebook(pageId, token, slug, caption) {
  const blogUrl = `${BASE_URL}/blog/${slug}/`;
  await waitForPage(blogUrl);

  const body = new URLSearchParams({
    message:      caption,
    link:         blogUrl,
    access_token: token,
  });

  const res  = await fetch(`${GRAPH}/${pageId}/feed`, { method: 'POST', body });
  const data = await readJson(res);
  if (!res.ok) throw graphError(data, res);
  log(`Posted to Facebook — post ID: ${data.id}`);
  log(`Blog URL: ${blogUrl}`);
}

// Only sent when Facebook was configured and still refused the post — the owner
// needs the caption in hand to post it manually. A missing secret is the
// annotation's job, not the inbox's.
async function emailFallback(slug, caption, reason) {
  if (!process.env.RESEND_API_KEY) {
    log('RESEND_API_KEY not set — no fallback email sent');
    return;
  }
  const blogUrl = `${BASE_URL}/blog/${slug}/`;
  try {
    const { Resend } = await import('resend');
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: 'DoryAngel Blog <onboarding@resend.dev>',
      to: APPROVAL_EMAIL,
      subject: `⚠️ Facebook auto-post failed — post "${slug}" by hand`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A2740;">
          <div style="background:#0F2847;padding:20px 24px;border-radius:8px 8px 0 0;">
            <h1 style="color:white;font-size:18px;margin:0;">⚠️ Vera couldn't post to Facebook</h1>
            <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0;">The blog post is live — only the Facebook post was missed</p>
          </div>
          <div style="padding:20px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
            <div style="background:#FEF2F2;border:1px solid #F5A9A9;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
              <p style="margin:0;font-size:13px;color:#B91C1C;">${escapeHtml(reason)}</p>
            </div>
            <p style="font-size:14px;margin:0 0 12px;">Paste this on the Facebook Page manually:</p>
            <div style="background:#F4F7FA;border:2px solid #1E5AA8;border-radius:8px;padding:20px;margin-bottom:20px;">
              <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px;color:#1A2740;line-height:1.6;margin:0;word-wrap:break-word;">${escapeHtml(caption)}</pre>
            </div>
            <p style="font-size:14px;margin:0;">Link: <a href="${blogUrl}" style="color:#1E5AA8;">${blogUrl}</a></p>
          </div>
        </div>
      `,
    });
    log(`Fallback email sent to ${APPROVAL_EMAIL} — post it by hand`);
  } catch (e) {
    log(`Fallback email failed too: ${e.message}`);
  }
}

async function main() {
  const pageId     = process.env.FACEBOOK_PAGE_ID;
  const token      = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const configured = Boolean(pageId && token);
  const missing    = !pageId ? 'FACEBOOK_PAGE_ID' : 'FACEBOOK_PAGE_ACCESS_TOKEN';

  if (process.env.VERA_VERIFY === 'true') {
    if (!configured) {
      fail(`${missing} is not set — nothing to verify.`);
      return;
    }
    try {
      const me = await verifyToken(token);
      log(`Token OK — resolves to "${me.name}" (id ${me.id})`);
      if (me.id !== pageId) {
        fail(`token resolves to id ${me.id} but FACEBOOK_PAGE_ID is ${pageId} — these must match, or posts go to the wrong Page.`);
      }
    } catch (e) {
      fail(`token check failed: ${e.message}`);
    }
    return;
  }

  if (!existsSync(QUEUE_FILE)) {
    log('No social queue file found — nothing to post (Nave may have skipped)');
    return;
  }

  let slug, facebookPost;
  try {
    ({ slug, facebookPost } = JSON.parse(readFileSync(QUEUE_FILE, 'utf8')));
    if (!slug || !facebookPost) throw new Error('queue file is missing "slug" or "facebookPost"');
  } catch (e) {
    fail(`could not read the social queue (${e.message}) — no Facebook post was made.`);
    return;
  }
  log(`Picked up post: ${slug}`);

  if (!configured) {
    warn(`${missing} is not set — NO Facebook post was made for "${slug}". Add the secret in repo Settings → Secrets and variables → Actions (CLAUDE.md → Vera / Facebook token).`);
    return;
  }

  try {
    await postToFacebook(pageId, token, slug, facebookPost);
  } catch (e) {
    fail(`Facebook post failed: ${e.message}`);
    log('Blog is live and the digest was sent — only the social post was skipped');
    await emailFallback(slug, facebookPost, e.message);
  }
}

// Never fail the workflow: swallow anything unexpected and exit clean.
main()
  .catch(e => fail(`unexpected error: ${e.message}`))
  .finally(() => { process.exitCode = 0; });
