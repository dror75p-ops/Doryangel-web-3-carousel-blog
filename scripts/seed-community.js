// seed-community.js — Scan Reddit for landlord questions, score intent, draft replies, email Joy

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { readFileSync } from 'fs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
const resend = new Resend(process.env.RESEND_API_KEY);

const NOTIFICATION_EMAILS = ['dror75p@gmail.com', 'joyg@doryangel.com'];
const SITE_URL = 'https://dror75p-ops.github.io/Doryangel-web-3-carousel-blog';
const USER_AGENT = 'DoryAngel:seed-community:v1.0 by /u/doryangel_nyc';

const SUBREDDITS = ['realestateinvesting', 'landlord', 'NYCapartments', 'Bronx', 'nyc'];

const NYC_KEYWORDS = [
  'bronx', 'manhattan', 'brooklyn', 'queens', 'nyc', 'new york',
  'property manager', 'property management', 'hpd', 'landlord',
  'rent stabiliz', 'housing court', 'rental property',
];

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score:  { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['score', 'reason'],
  additionalProperties: false,
};

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply:           { type: 'string' },
    blog_post_slug:  { type: 'string' },
  },
  required: ['reply', 'blog_post_slug'],
  additionalProperties: false,
};

async function getRedditToken() {
  const credentials = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Reddit auth ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('No token in Reddit response');
  return data.access_token;
}

async function fetchRecentPosts(subreddit, token, since) {
  const res = await fetch(
    `https://oauth.reddit.com/r/${subreddit}/new?limit=25`,
    { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } }
  );
  if (!res.ok) {
    console.warn(`  r/${subreddit}: HTTP ${res.status} — skipping`);
    return [];
  }
  const data = await res.json();
  return (data?.data?.children ?? [])
    .map(c => c.data)
    .filter(p => p.created_utc > since);
}

function isNYCRelevant(post) {
  const text = `${post.title} ${post.selftext || ''}`.toLowerCase();
  return NYC_KEYWORDS.some(kw => text.includes(kw));
}

async function scorePost(post) {
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      output_config: { format: { type: 'json_schema', schema: SCORE_SCHEMA } },
      messages: [{
        role: 'user',
        content: `Score this Reddit post for DoryAngel (Bronx property management company, $99/unit/month).

Rate 1–10 for purchase intent + relevance:
1–3: Not relevant
4–6: Relevant topic but low intent
7–8: Seeking advice or solutions we can help with
9–10: Actively looking for a property manager

Subreddit: r/${post.subreddit}
Title: ${post.title}
Body: ${(post.selftext || '').slice(0, 400)}

JSON: {"score": 7, "reason": "one sentence"}`,
      }],
    });
    return JSON.parse(res.content.find(b => b.type === 'text')?.text ?? '{}');
  } catch (err) {
    console.warn(`  Score failed: ${err.message}`);
    return { score: 0, reason: 'error' };
  }
}

async function draftReply(post, blogPosts) {
  const postList = blogPosts.slice(0, 20).map(p => `${p.slug}: ${p.title}`).join('\n');
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768,
      output_config: { format: { type: 'json_schema', schema: REPLY_SCHEMA } },
      messages: [{
        role: 'user',
        content: `You are a Bronx property management expert from DoryAngel LLC (flat-fee $99/unit/month, serving NYC since 2010).

Write a helpful Reddit reply. Rules:
- Lead with real, specific advice — not a sales pitch
- Use first-person plural: "In our experience...", "We've seen..."
- Mention DoryAngel naturally at the end ONLY if it fits — never force it
- Pick the ONE most relevant blog post slug from the list below to cite
- 3–4 short paragraphs, conversational tone
- No AI clichés: no "delve", "testament", "moreover", "transformative", "crucial"

Post: "${post.title}"
${(post.selftext || '').slice(0, 500)}

Blog posts available:
${postList}

JSON: {"reply": "full reply text", "blog_post_slug": "chosen-slug"}`,
      }],
    });
    return JSON.parse(res.content.find(b => b.type === 'text')?.text ?? 'null');
  } catch (err) {
    console.warn(`  Draft failed: ${err.message}`);
    return null;
  }
}

function buildEmail(post, score, draft, blogPost) {
  const threadUrl = `https://reddit.com${post.permalink}`;
  const blogUrl   = blogPost ? `${SITE_URL}/blog/${blogPost.slug}/` : SITE_URL;
  const blogTitle = blogPost?.title ?? 'DoryAngel Blog';
  const replyText = `${draft.reply}\n\n📖 More on this: ${blogUrl}`;

  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A2740;">
  <div style="background:#0F2847;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;font-size:18px;margin:0;">🏠 Reddit Opportunity — Action Needed</h1>
    <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0;">r/${post.subreddit} · Intent score: ${score.score}/10</p>
  </div>
  <div style="padding:20px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">

    <div style="background:#FFF8E7;border:1px solid #F5D78E;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:12px;color:#8B6F1A;font-weight:700;text-transform:uppercase;">Original post</p>
      <p style="margin:8px 0 6px;font-size:15px;font-weight:700;color:#1A2740;">${post.title}</p>
      <p style="margin:0 0 10px;font-size:13px;color:#556070;line-height:1.5;">${(post.selftext || '(link post)').slice(0, 200)}${(post.selftext?.length ?? 0) > 200 ? '...' : ''}</p>
      <a href="${threadUrl}" style="font-size:13px;color:#1E5AA8;font-weight:700;">Open thread on Reddit →</a>
    </div>

    <div style="background:#EBF3FD;border:1px solid #5B9FEA;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#1B4F8A;font-weight:700;">🎯 Why reply: ${score.reason}</p>
    </div>

    <div style="background:#E7F3FF;border:1px solid #8FBCEB;border-radius:8px;padding:12px 16px;margin-bottom:10px;">
      <p style="margin:0;font-size:13px;color:#1B4F8A;font-weight:700;">📋 STEP 1 — Long-press box below → "Select all" → "Copy"</p>
    </div>

    <div style="background:#F4F7FA;border:2px solid #1E5AA8;border-radius:8px;padding:18px;margin-bottom:16px;">
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px;color:#1A2740;line-height:1.7;margin:0;word-wrap:break-word;">${replyText}</pre>
    </div>

    <div style="background:#E8F8E8;border:1px solid #8FCB8F;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#1B6B1B;font-weight:700;">✅ STEP 2 — Click "Open thread on Reddit" above → scroll to bottom → click "Add a comment" → paste → Post</p>
    </div>

    <div style="background:#F4F7FA;border-radius:8px;padding:12px 16px;">
      <p style="margin:0 0 4px;font-size:11px;color:#8B9BAE;font-weight:700;text-transform:uppercase;">Blog post cited in reply</p>
      <a href="${blogUrl}" style="font-size:14px;color:#1E5AA8;font-weight:600;">${blogTitle} →</a>
    </div>

    <p style="font-size:11px;color:#8B9BAE;text-align:center;margin:24px 0 0;">
      DoryAngel community seeding · Runs every 6 hours
    </p>
  </div>
</div>`;
}

async function main() {
  console.log('Community seed scan starting...');
  const since = Math.floor(Date.now() / 1000) - 6 * 60 * 60;
  const blogPosts = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));

  const token = await getRedditToken();
  console.log('Reddit auth OK');

  let qualified = 0;

  for (const subreddit of SUBREDDITS) {
    const posts = await fetchRecentPosts(subreddit, token, since);
    const relevant = posts.filter(isNYCRelevant);
    console.log(`r/${subreddit}: ${posts.length} recent, ${relevant.length} NYC-relevant`);

    for (const post of relevant) {
      const { score, reason } = await scorePost(post);
      console.log(`  [${score}/10] ${post.title.slice(0, 70)}`);
      if (score < 7) continue;

      const draft = await draftReply(post, blogPosts);
      if (!draft) continue;

      const blogPost = blogPosts.find(p => p.slug === draft.blog_post_slug);
      const html = buildEmail(post, { score, reason }, draft, blogPost);

      for (const email of NOTIFICATION_EMAILS) {
        await resend.emails.send({
          from: 'DoryAngel Community <onboarding@resend.dev>',
          to: email,
          subject: `🏠 Reddit [${score}/10]: "${post.title.slice(0, 55)}"`,
          html,
        });
      }

      console.log(`  ✓ Emailed: ${post.title.slice(0, 60)}`);
      qualified++;
      await new Promise(r => setTimeout(r, 1500));
    }

    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`Done — ${qualified} opportunities emailed.`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
