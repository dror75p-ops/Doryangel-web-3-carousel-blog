// social-post.js — Vera: DoryAngel's social distribution agent
// Reads the handoff file left by Nave and posts to the DoryAngel Facebook Page.

import { readFileSync, existsSync } from 'fs';

const AGENT_NAME  = 'Vera';
const BASE_URL    = 'https://beta.doryangel.com';
const QUEUE_FILE  = '/tmp/social-queue.json';

async function postToFacebook(slug, caption) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token  = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !token) {
    console.log(`[${AGENT_NAME}] FACEBOOK_PAGE_ID or FACEBOOK_PAGE_ACCESS_TOKEN not set — skipping`);
    return;
  }

  const blogUrl = `${BASE_URL}/blog/${slug}/`;

  const body = new URLSearchParams({
    message:      caption,
    link:         blogUrl,
    access_token: token,
  });

  const res  = await fetch(`https://graph.facebook.com/v22.0/${pageId}/feed`, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  console.log(`[${AGENT_NAME}] Posted to Facebook — post ID: ${data.id}`);
  console.log(`[${AGENT_NAME}] Blog URL: ${blogUrl}`);
}

async function main() {
  if (!existsSync(QUEUE_FILE)) {
    console.log(`[${AGENT_NAME}] No social queue file found — nothing to post (Nave may have skipped)`);
    process.exit(0);
  }

  const { slug, facebookPost } = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
  console.log(`[${AGENT_NAME}] Picked up post: ${slug}`);

  try {
    await postToFacebook(slug, facebookPost);
  } catch (err) {
    console.warn(`[${AGENT_NAME}] Facebook post failed: ${err.message}`);
    console.warn(`[${AGENT_NAME}] Blog is live and email was sent — only social post was skipped`);
    process.exit(0); // non-fatal: don't fail the workflow
  }
}

main();
