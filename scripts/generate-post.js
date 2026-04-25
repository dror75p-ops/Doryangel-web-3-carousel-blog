// generate-post.js — Auto-generates a DoryAngel blog post and emails it for approval

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { readFileSync, writeFileSync } from 'fs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

async function generatePost(topic) {
  const today = formatDate(new Date());

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are a content writer for DoryAngel Asset Management, a NYC property management company based at 557 Grand Concourse, Bronx, NY. They offer flat-fee property management starting at $99/month and have served Bronx and NYC owners since 2010.

Write a blog post about: "${topic}"

Requirements:
- Target audience: Bronx and NYC property owners looking to hire a property manager
- Tone: Expert, trustworthy, practical — like advice from a knowledgeable friend
- Length: 600-800 words
- End with a soft call-to-action to book a free consultation at: https://cal.com/dory-angel-management-v5o0ke/30min
- Include the office contact: 557 Grand Concourse, Bronx, NY · (516) 847-4999 · office@doryangel.com

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "title": "the full article title",
  "category": "one of: Compliance, Investment, Tenant Relations, Property Management",
  "excerpt": "2-sentence summary for the blog index (max 160 chars)",
  "content": "full markdown content of the article"
}`
    }]
  });

  const raw = message.content[0].text.trim();
  const post = JSON.parse(raw);

  return {
    slug: generateSlug(post.title),
    title: post.title,
    date: today,
    category: post.category,
    author: 'DoryAngel Team',
    excerpt: post.excerpt,
    image: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&q=80',
    views: 0,
    score: 0,
    content: post.content,
  };
}

async function sendApprovalEmail(post) {
  // Plain-text preview for easy reading on mobile
  const preview = post.content.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').slice(0, 600);

  await resend.emails.send({
    from: 'DoryAngel Blog <onboarding@resend.dev>',
    to: APPROVAL_EMAIL,
    subject: `📝 New blog draft ready: "${post.title}"`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A2740;">
        <div style="background:#0D1E3A;padding:24px;border-radius:8px 8px 0 0;">
          <h1 style="color:white;font-size:20px;margin:0;">DoryAngel Blog — New Draft Ready</h1>
        </div>
        <div style="padding:24px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">

          <p style="color:#556070;margin:0 0 20px;">A new blog post has been automatically generated. Review it below and reply to this email with any changes, or simply approve it to publish live.</p>

          <div style="background:#F4F7FA;border-radius:6px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 6px;font-size:12px;color:#8B9BAE;text-transform:uppercase;letter-spacing:1px;">Category</p>
            <p style="margin:0;font-weight:700;color:#3A7BDD;">${post.category}</p>
          </div>

          <h2 style="font-size:22px;color:#0D1E3A;margin:0 0 12px;">${post.title}</h2>
          <p style="color:#556070;font-style:italic;margin:0 0 24px;">${post.excerpt}</p>

          <div style="background:#F4F7FA;border-left:4px solid #3A7BDD;padding:16px;border-radius:0 6px 6px 0;margin-bottom:24px;">
            <p style="margin:0;font-size:14px;color:#556070;line-height:1.7;">${preview}...</p>
          </div>

          <div style="white-space:pre-wrap;font-size:13px;color:#556070;line-height:1.8;background:#fff;border:1px solid #E2E8F0;border-radius:6px;padding:16px;margin-bottom:24px;max-height:400px;overflow-y:auto;">
${post.content}
          </div>

          <div style="background:#EBF3FD;border-radius:8px;padding:20px;text-align:center;">
            <p style="margin:0 0 8px;font-size:14px;color:#0D1E3A;font-weight:700;">Want changes?</p>
            <p style="margin:0;font-size:13px;color:#556070;">Simply reply to this email with your notes and the post will be revised before publishing.</p>
          </div>

          <p style="margin:24px 0 0;font-size:12px;color:#8B9BAE;text-align:center;">
            This draft was auto-generated by your DoryAngel blog automation.<br>
            Scheduled: every 3 days · Next post: in 3 days
          </p>
        </div>
      </div>
    `,
  });
}

async function main() {
  // Load existing posts
  const indexPath = './content/blog/posts-index.json';
  const posts = JSON.parse(readFileSync(indexPath, 'utf8'));

  // Pick topic based on how many posts exist
  const topic = pickTopic(posts.length);
  console.log(`Generating post about: "${topic}"`);

  // Generate the post
  const post = await generatePost(topic);
  console.log(`Generated: "${post.title}"`);

  // Add to the top of the posts array
  posts.unshift(post);
  writeFileSync(indexPath, JSON.stringify(posts, null, 2));
  console.log('Added to posts-index.json');

  // Send approval email
  await sendApprovalEmail(post);
  console.log(`Approval email sent to ${APPROVAL_EMAIL}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
