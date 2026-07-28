// social-post.js — Vera: DoryAngel's social distribution agent
// Reads the handoff file left by Nave and posts the new article to the DoryAngel
// Facebook Page — via the Make scenario "DoryAngel Blog — Facebook Auto-Post",
// NOT by calling the Graph API directly.
//
// WHY MAKE AND NOT THE GRAPH API (changed 2026-07-28): posting directly needed a
// hand-minted long-lived Page token in FACEBOOK_PAGE_ACCESS_TOKEN. That secret sat
// empty from 2026-06-20 to 2026-07-28 and every post silently skipped. Make holds
// the Facebook connection as OAuth and refreshes it itself, so there is no token
// to mint, none to leak, and none to expire. Do not "simplify" this back into a
// direct graph.facebook.com call.
//
// THREE INVARIANTS — see CLAUDE.md before changing any of them:
//   1. Vera must NEVER fail the workflow. Every path exits 0. A social hiccup must
//      not block a post that is already written, built and committed.
//   2. Vera runs AFTER the commit/push step, so the blog page is already on its way
//      to Vercel when the link goes out. Do not move it back before commit.
//   3. A 200 from the webhook is NOT proof of a Facebook post. Make answers
//      "Accepted" instantly unless the scenario ends in a Webhook Response module,
//      so Vera requires a post id in the reply. No id = failure, loudly.
//
// Anything Vera skips or fails is emitted as a GitHub Actions annotation. A plain
// console.log is what hid the empty-token bug for over a month of publishing.

// Resend is imported dynamically inside emailFallback(), not at the top level:
// a top-level import throws at module load, before any try/catch can run, so a
// missing dependency would take the whole step down. See invariant 1 above.
import { readFileSync, existsSync } from 'fs';

const AGENT_NAME     = 'Vera';
const BASE_URL       = 'https://www.doryangel.com';
const QUEUE_FILE     = '/tmp/social-queue.json';
const APPROVAL_EMAIL = 'dror75p@gmail.com';

// Make "DoryAngel Blog — Facebook Auto-Post" (hook 2871253). The scenario filters
// on the shared secret before it will post anything, so this public URL can't be
// used to make the Page publish arbitrary text.
const SOCIAL_WEBHOOK = 'https://hook.eu1.make.com/ura1w6nxwhdgbkg0ebbdu6fwiuq4zi38';

// Vercel redeploys ~1 min after the commit lands, so poll the post URL before
// handing Facebook a link that would 404 for whoever clicks it first.
const READY_TRIES    = 6;
const READY_DELAY_MS = 15_000;

const log  = m => console.log(`[${AGENT_NAME}] ${m}`);
const warn = m => console.log(`::warning title=${AGENT_NAME}::${m}`);
const fail = m => console.log(`::error title=${AGENT_NAME}::${m}`);

const escapeHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Make normally answers JSON, but an outage or a misconfigured scenario answers
// plain text — parsing that blind turns a readable failure into "Unexpected token".
async function readJson(res) {
  const text = await res.text();
  try {
    return { data: JSON.parse(text), raw: text };
  } catch {
    return { data: null, raw: text };
  }
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

async function postViaMake(secret, slug, caption) {
  const blogUrl = `${BASE_URL}/blog/${slug}/`;
  await waitForPage(blogUrl);

  const res = await fetch(SOCIAL_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ secret, slug, message: caption, link: blogUrl }),
  });

  const { data, raw } = await readJson(res);

  if (!res.ok) {
    throw new Error(`Make webhook returned HTTP ${res.status}: ${raw.slice(0, 200)}`);
  }

  // Invariant 3. "Accepted" is Make's default instant reply and proves nothing —
  // it means the scenario was queued, or that the secret filter silently dropped
  // it, or that the scenario has no Webhook Response module. Demand the post id.
  const postId = data?.postId ?? data?.id;
  if (!postId) {
    throw new Error(
      `Make accepted the request but returned no Facebook post id (got: ${raw.slice(0, 200) || 'empty response'}). ` +
      `Either the secret filter dropped it, the Facebook module errored, or the scenario is missing its Webhook Response module.`
    );
  }

  log(`Posted to Facebook — post ID: ${postId}`);
  log(`Blog URL: ${blogUrl}`);
}

// Only sent when the post was actually attempted and failed — the owner needs the
// caption in hand to post it manually. A missing secret is the annotation's job,
// not the inbox's.
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
  // Shared with the digest broadcast scenario on purpose — one secret, one place
  // for the owner to manage. The Make filter requires it before posting anything.
  const secret = process.env.DIGEST_WEBHOOK_SECRET;

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

  if (!secret) {
    warn(`DIGEST_WEBHOOK_SECRET is not set — NO Facebook post was made for "${slug}". The Make scenario drops unsigned requests. Add the secret in repo Settings → Secrets and variables → Actions.`);
    return;
  }

  try {
    await postViaMake(secret, slug, facebookPost);
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
