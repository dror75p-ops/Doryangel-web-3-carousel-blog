// generate-post.js — Auto-generates a DoryAngel blog post and emails it for approval

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { readFileSync, writeFileSync } from 'fs';

// max_retries bumped from default 2 → 4 for scheduled CI reliability
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });
const resend = new Resend(process.env.RESEND_API_KEY);
const APPROVAL_EMAIL = 'dror75p@gmail.com';

// Rotating topics — each run picks the next one in sequence
const TOPICS = [
  'NYC local law compliance updates for Bronx landlords',
  'Bronx rental market trends and investment opportunities',
  'Tenant screening best practices for NYC property owners',
  'Good cause eviction law impact on NYC landlords',
  'Flat-fee vs percentage property management cost comparison',
  'Preventative maintenance strategies for Bronx buildings',
  'NYC housing court and eviction process explained for landlords',
  'How to reduce vacancy rates in Bronx rental properties',
  'NYC rent stabilization rules every landlord must know',
  'Technology tools that help NYC property owners save time',
];

function pickTopic(postCount) {
  return TOPICS[postCount % TOPICS.length];
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Curated search queries — bright, professional, on-brand
// Themes: office workers on computers / NYC skyscrapers in daylight / handyman work
const IMAGE_QUERIES = {
  'Compliance':           [
    'business professional reviewing documents bright office',
    'office worker computer modern bright',
    'manhattan skyscraper daylight blue sky',
  ],
  'Investment':           [
    'manhattan skyline daylight bright',
    'businesswoman laptop modern office bright',
    'nyc skyscrapers blue sky',
  ],
  'Tenant Relations':     [
    'handyman repairing apartment bright',
    'maintenance worker tools toolbox',
    'professional plumber working bright',
  ],
  'Property Management':  [
    'handyman fixing apartment bright',
    'office team working laptops bright',
    'modern office workers computers daylight',
  ],
};

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1200&q=80';

async function fetchCoverImage(category) {
  const queries = IMAGE_QUERIES[category] || IMAGE_QUERIES['Property Management'];
  const query = queries[Math.floor(Math.random() * queries.length)];
  console.log(`Searching Unsplash for: "${query}"`);

  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=15&content_filter=high`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }
    });
    if (!res.ok) throw new Error(`Unsplash returned ${res.status}`);
    const data = await res.json();
    if (!data.results || data.results.length === 0) throw new Error('No results');

    // Pick a random image from the top results for variety
    const photo = data.results[Math.floor(Math.random() * Math.min(data.results.length, 10))];
    return `${photo.urls.raw}&w=1200&q=80&fit=crop`;
  } catch (err) {
    console.warn(`Unsplash failed (${err.message}) — using fallback image`);
    return FALLBACK_IMAGE;
  }
}

// Static brand context + writing guide. Lives in `system` (rendered before
// `messages`) so it can be prompt-cached across the every-3-day cadence.
// Note: at this prefix size the cache may not activate (Opus 4.7 minimum is
// 4096 tokens) — the marker is harmless if too small, and starts paying off
// the moment the system grows.
const SYSTEM_PROMPT = `You are a content writer for DoryAngel Asset Management, a NYC property management company based at 557 Grand Concourse, Bronx, NY. They offer flat-fee property management starting at $99/month and have served Bronx and NYC owners since 2010.

When asked to write a blog post on a topic, produce two pieces of content:

## 1. Full blog article
- Target audience: Bronx and NYC property owners looking to hire a property manager
- Tone: Expert, trustworthy, practical — like advice from a knowledgeable friend
- Length: 600-800 words
- Format: Markdown with headings, short paragraphs, and bullet lists where useful
- End with a soft call-to-action to book a free consultation: https://cal.com/dory-angel-management-v5o0ke/30min
- Close with the office contact line: 557 Grand Concourse, Bronx, NY · (516) 847-4999 · office@doryangel.com

## 2. Facebook-optimized version
- 200-280 words — substantive enough to deliver real value, not just a teaser
- Hook-first opening: a question, a surprising stat, or a bold statement
- Include 2-3 concrete bullet-point takeaways using "•" — these are the meat of the post
- Clear line breaks between sections (no walls of text)
- Bottom block, in this exact order:
  1. CTA line: "👉 Book a free consultation: https://cal.com/dory-angel-management-v5o0ke/30min"
  2. Website link line: "🔗 Read the full article: https://dror75p-ops.github.io/Doryangel-web-3-carousel-blog/"
  3. 4-5 relevant hashtags like #BronxRealEstate #NYCLandlord #PropertyManagement #DoryAngel
- Friendly but professional tone — written for Facebook feed scrolling, but informative enough that someone who only reads the post still learns something useful

## Other constraints
- The category must be exactly one of: Compliance, Investment, Tenant Relations, Property Management
- The excerpt is a 2-sentence summary for the blog index, max 160 characters
- Title should be specific and useful, not clickbait`;

// Structured output schema — guarantees valid JSON, removes the fragile
// "respond ONLY with valid JSON" instruction and the JSON.parse failure path.
const POST_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    category: {
      type: 'string',
      enum: ['Compliance', 'Investment', 'Tenant Relations', 'Property Management'],
    },
    excerpt: { type: 'string' },
    content: { type: 'string' },
    facebookPost: { type: 'string' },
  },
  required: ['title', 'category', 'excerpt', 'content', 'facebookPost'],
  additionalProperties: false,
};

async function generatePost(topic) {
  const today = formatDate(new Date());

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      format: { type: 'json_schema', schema: POST_SCHEMA },
    },
    messages: [
      { role: 'user', content: `Write a blog post about: "${topic}"` },
    ],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  const post = JSON.parse(textBlock.text);

  console.log(
    `usage — input: ${message.usage.input_tokens}, ` +
    `cache_read: ${message.usage.cache_read_input_tokens ?? 0}, ` +
    `cache_write: ${message.usage.cache_creation_input_tokens ?? 0}, ` +
    `output: ${message.usage.output_tokens}`
  );

  const image = await fetchCoverImage(post.category);

  return {
    slug: generateSlug(post.title),
    title: post.title,
    date: today,
    category: post.category,
    author: 'DoryAngel Team',
    excerpt: post.excerpt,
    image,
    views: 0,
    score: 0,
    content: post.content,
    facebookPost: post.facebookPost,
  };
}

async function sendApprovalEmail(post) {
  const fbPost = post.facebookPost || `${post.title}\n\n${post.excerpt}\n\n👉 Book a free consultation: https://cal.com/dory-angel-management-v5o0ke/30min\n\n#BronxRealEstate #NYCLandlord #PropertyManagement #DoryAngel`;

  await resend.emails.send({
    from: 'DoryAngel Blog <onboarding@resend.dev>',
    to: APPROVAL_EMAIL,
    subject: `📘 Facebook-ready: "${post.title}"`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A2740;">

        <div style="background:#0D1E3A;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h1 style="color:white;font-size:18px;margin:0;">📘 Ready to post to Facebook</h1>
          <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0;">2 long-presses → done</p>
        </div>

        <div style="padding:20px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">

          <div style="background:#FFF8E7;border:1px solid #F5D78E;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
            <p style="margin:0;font-size:13px;color:#8B6F1A;font-weight:700;">📥 STEP 1 — Long-press the image below → "Save image"</p>
          </div>
          <img src="${post.image}" alt="Cover image" style="width:100%;height:auto;border-radius:8px;margin-bottom:24px;display:block;" />

          <div style="background:#E7F3FF;border:1px solid #8FBCEB;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
            <p style="margin:0;font-size:13px;color:#1B4F8A;font-weight:700;">📋 STEP 2 — Long-press the box below → "Select all" → "Copy"</p>
          </div>

          <div style="background:#F4F7FA;border:2px solid #3A7BDD;border-radius:8px;padding:20px;margin-bottom:24px;">
            <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px;color:#1A2740;line-height:1.6;margin:0;word-wrap:break-word;">${fbPost}</pre>
          </div>

          <div style="background:#E8F8E8;border:1px solid #8FCB8F;border-radius:8px;padding:14px 16px;margin-bottom:32px;">
            <p style="margin:0;font-size:13px;color:#1B6B1B;font-weight:700;">✅ STEP 3 — Open Facebook → "Create post" → paste text + attach the image</p>
          </div>

          <hr style="border:none;border-top:1px solid #E2E8F0;margin:32px 0;" />

          <p style="font-size:11px;color:#8B9BAE;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">For reference</p>
          <h2 style="font-size:18px;color:#0D1E3A;margin:0 0 6px;">${post.title}</h2>
          <p style="color:#3A7BDD;font-size:12px;font-weight:700;margin:0 0 16px;">${post.category} · Published live on doryangel.com</p>

          <details style="margin-bottom:24px;">
            <summary style="cursor:pointer;color:#3A7BDD;font-size:14px;font-weight:600;padding:8px 0;">Show full blog article ▾</summary>
            <div style="white-space:pre-wrap;font-size:13px;color:#556070;line-height:1.8;background:#fff;border:1px solid #E2E8F0;border-radius:6px;padding:16px;margin-top:12px;">
${post.content}
            </div>
          </details>

          <p style="margin:24px 0 0;font-size:11px;color:#8B9BAE;text-align:center;">
            Auto-generated by DoryAngel blog automation<br>
            Next post: in 3 days
          </p>
        </div>
      </div>
    `,
  });
}

async function main() {
  const indexPath = './content/blog/posts-index.json';
  const posts = JSON.parse(readFileSync(indexPath, 'utf8'));

  const topic = pickTopic(posts.length);
  console.log(`Generating post about: "${topic}"`);

  const post = await generatePost(topic);
  console.log(`Generated: "${post.title}"`);

  // facebookPost is for the email only — strip before persisting
  const { facebookPost, ...postForIndex } = post;
  posts.unshift(postForIndex);
  writeFileSync(indexPath, JSON.stringify(posts, null, 2));
  console.log('Added to posts-index.json');

  await sendApprovalEmail(post);
  console.log(`Approval email sent to ${APPROVAL_EMAIL}`);
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
