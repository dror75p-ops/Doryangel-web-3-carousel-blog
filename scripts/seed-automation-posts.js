// seed-automation-posts.js — One-time script to seed 2 Property Automation articles.
// Does NOT send emails or fire webhooks. Run once, then delete.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });

const TOPICS = [
  {
    title: '5 Smart Sensors Every Bronx Landlord Should Install in 2026',
    category: 'property-automation',
  },
  {
    title: 'How AI Security Cameras Are Reducing Vacancy Crimes in NYC Rental Buildings',
    category: 'property-automation',
  },
];

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1600&q=80';

const IMAGE_QUERIES = [
  'smart home technology modern apartment',
  'security camera building surveillance',
  'IoT smart sensor home device',
  'property technology digital dashboard screen',
];

const HASHTAGS = ['smartproperty', 'proptech', 'bronxlandlord', 'IoT', 'doryangel'];

const SYSTEM_PROMPT = `You are a content writer for DoryAngel LLC, a NYC property management company at 557 Grand Concourse Ave #4123, Bronx NY 10451. They offer flat-fee property management at $99/unit/month and have served Bronx and NYC owners since 2010.

CRITICAL RULES:
1. Title formula: must be either a question OR start with a number. Always reference the Bronx or NYC specifically.
2. Pain-point excerpts: 1-2 sentences focused on a real landlord pain point.
3. Word count: 800-1,200 words. Below 500 = zero traffic.
4. NYC-specific examples: include at least one specific dollar figure or NYC law/regulation reference.
5. Tone: Expert, trustworthy, practical — like advice from a knowledgeable friend who knows NYC inside out.
6. Structure: Use markdown headings (h2, h3), short paragraphs (2-3 sentences), bullet lists where useful.
7. Do NOT include a CTA in the content — it is auto-appended.
8. This is a Property Automation article: focus on smart home tech, IoT sensors, CCTV, AI tools, smart locks, leak detectors, remote monitoring — specifically as they apply to NYC/Bronx rental properties.

When asked to write a post, also produce:
- An SEO title (max 48 chars before " | DoryAngel" is appended)
- An SEO description (max 155 chars)
- A descriptive alt text for the hero image`;

const POST_SCHEMA = {
  type: 'object',
  properties: {
    title:          { type: 'string' },
    excerpt:        { type: 'string' },
    content:        { type: 'string' },
    seoTitleShort:  { type: 'string' },
    seoDescription: { type: 'string' },
    heroImageAlt:   { type: 'string' },
  },
  required: ['title', 'excerpt', 'content', 'seoTitleShort', 'seoDescription', 'heroImageAlt'],
  additionalProperties: false,
};

function generateSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
}
function formatDate(d) { return d.toISOString().split('T')[0]; }
function wordsToMinutes(content) { return Math.max(2, Math.round(content.trim().split(/\s+/).length / 220)); }

async function fetchImage() {
  const query = IMAGE_QUERIES[Math.floor(Math.random() * IMAGE_QUERIES.length)];
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=15&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } });
    if (!res.ok) throw new Error(`Unsplash ${res.status}`);
    const data = await res.json();
    if (!data.results?.length) throw new Error('No results');
    const photo = data.results[Math.floor(Math.random() * Math.min(data.results.length, 10))];
    return `${photo.urls.raw}&w=1600&q=80&fit=crop`;
  } catch (e) {
    console.warn(`Unsplash failed (${e.message}) — using fallback`);
    return FALLBACK_IMAGE;
  }
}

async function generatePost(topic) {
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: POST_SCHEMA } },
    messages: [{ role: 'user', content: `Write a blog post on this topic: "${topic.title}"\nCategory: ${topic.category}\nYear context: 2026\n\nRemember: 800-1,200 words, NYC-specific, pain-point focused, scannable, no CTA.` }],
  });

  const text = msg.content.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('No text block');
  const post = JSON.parse(text);
  console.log(`  tokens — in:${msg.usage.input_tokens} cache_read:${msg.usage.cache_read_input_tokens ?? 0} out:${msg.usage.output_tokens}`);

  const heroImage = await fetchImage();
  return {
    slug: generateSlug(post.title),
    title: post.title,
    category: topic.category,
    excerpt: post.excerpt,
    publishedDate: formatDate(new Date()),
    minutesToRead: wordsToMinutes(post.content),
    heroImage,
    heroImageAlt: post.heroImageAlt,
    hashtags: HASHTAGS,
    featured: false,
    seoTitle: (post.seoTitleShort + ' | DoryAngel').slice(0, 60),
    seoDescription: post.seoDescription.slice(0, 155),
    author: 'DoryAngel Team',
    content: post.content,
  };
}

async function main() {
  const indexPath = './content/blog/posts-index.json';
  const posts = JSON.parse(readFileSync(indexPath, 'utf8'));

  for (const topic of TOPICS) {
    console.log(`\nGenerating: "${topic.title}"`);
    const post = await generatePost(topic);
    console.log(`  → slug: ${post.slug} | ${post.minutesToRead} min read`);
    posts.unshift(post);
  }

  writeFileSync(indexPath, JSON.stringify(posts, null, 2));
  console.log(`\nDone. ${TOPICS.length} posts added to posts-index.json`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
