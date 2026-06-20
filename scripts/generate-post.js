// generate-post.js — Auto-generates a DoryAngel blog post and emails it for approval

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { readFileSync, writeFileSync } from 'fs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });
const resend = new Resend(process.env.RESEND_API_KEY);
const AGENT_NAME = 'Nave';
const APPROVAL_EMAIL = 'dror75p@gmail.com';

// Fallback topics used if AI topic selection fails
const FALLBACK_TOPICS = [
  { title: '5 Free Tools Every DIY Landlord in the Bronx Needs', category: 'diy-property-management' },
  { title: 'The Top 3 Mistakes Bronx Landlords Make Managing Their Own Properties', category: 'property-management' },
  { title: 'What to Look for in a Bronx Property Management Company', category: 'property-management' },
  { title: 'Is Buying a Rental Property in the Bronx Still a Good Investment?', category: 'investments' },
  { title: 'Why Bronx Landlords Are Switching to Flat-Fee Property Management', category: 'property-management' },
  { title: 'How Much Does Property Management Cost in the Bronx?', category: 'property-management' },
  { title: 'Should Bronx Landlords Self-Manage or Hire a Property Manager?', category: 'diy-property-management' },
  { title: "How to Handle a Tenant Who Doesn't Pay Rent in the Bronx", category: 'diy-property-management' },
  { title: 'What Bronx Landlords Need to Know About HPD Lead Paint Rules', category: 'property-management' },
  { title: '4 Signs Your Bronx Rental Property Needs Professional Management', category: 'property-management' },
  { title: 'How Bronx Landlords Can Cut Vacancy Time in Half', category: 'diy-property-management' },
  { title: 'The Bronx Landlord Guide to NYC Housing Court in 2026', category: 'diy-property-management' },
  { title: '3 Bronx Neighborhoods With the Best Rental ROI in 2026', category: 'investments' },
  { title: 'How to Screen Tenants the Right Way in the Bronx', category: 'property-management' },
  { title: '5 Smart Sensors Every Bronx Landlord Should Install in 2026', category: 'property-automation' },
  { title: 'How AI Security Cameras Are Reducing Vacancy Crimes in NYC Rental Buildings', category: 'property-automation' },
  { title: 'Can a Bronx Landlord Automate Rent Collection with Smart Tech?', category: 'property-automation' },
  { title: '3 IoT Devices That Pay for Themselves in Your Bronx Rental Property', category: 'property-automation' },
  { title: 'How Bronx Landlords Are Using Smart Locks to Cut Vacancy Turnaround Time', category: 'property-automation' },
  { title: 'How Do Bronx Real Estate Brokers Earn Referral Income After the Deal Closes?', category: 'broker-partnerships' },
  { title: 'What Should a Bronx Broker Tell a Client Who Wants to Self-Manage a 6-Unit Building?', category: 'broker-partnerships' },
  { title: '5 Signs Your Bronx Investor Client Needs a Property Manager — Not Just a New Agent', category: 'broker-partnerships' },
  { title: 'Can a Bronx Broker Grow a Referral Business Without Adding to Their Workload?', category: 'broker-partnerships' },
  { title: 'How Does the DoryAngel Broker Referral Program Work in NYC?', category: 'broker-partnerships' },
];

function getSeason(month) {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
}

async function pickTopicWithAI(existingPosts) {
  const today = formatDate(new Date());
  const season = getSeason(new Date().getMonth() + 1);
  const recentTitles = existingPosts.slice(0, 10).map(p => `- ${p.title}`).join('\n') || 'None yet';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Today is ${today} (${season}). Suggest one blog post topic for Bronx landlords.

Recent posts to avoid repeating:
${recentTitles}

Rules:
- Title MUST reference the Bronx specifically — no other NYC borough or city
- Title must be a question OR start with a number — but VARY the opening word. Do NOT start with "Are", "Is", "Can", or "How" if more than one of the last 5 titles already uses that word
- Address a real landlord pain point; use seasonal relevance where fitting
- Category must be exactly one of: property-management, diy-property-management, investments, property-automation, broker-partnerships
- IMPORTANT: strongly prefer "investments", "property-automation", or "broker-partnerships" — these are underrepresented. Use "property-management" or "diy-property-management" only if no suitable angle exists in the preferred categories for this season
- "broker-partnerships" posts target NYC real estate brokers/agents as referral partners — topics should cover referral income, how to advise landlord clients, or how the DoryAngel partner program works

Reply ONLY with valid JSON: {"title": "...", "category": "..."}`,
      }],
    });

    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.title && parsed.category) return parsed;
    }
  } catch (err) {
    console.warn(`AI topic selection failed (${err.message}) — using fallback`);
  }

  return FALLBACK_TOPICS[existingPosts.length % FALLBACK_TOPICS.length];
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function formatDate(date) { return date.toISOString().split('T')[0]; }

function wordsToMinutes(content) {
  const words = content.trim().split(/\s+/).length;
  return Math.max(2, Math.round(words / 220));
}

const HASHTAGS_BY_CATEGORY = {
  'property-management':     ['propertymanagement', 'bronxlandlord', 'nyc', 'flatfee', 'doryangel'],
  'diy-property-management': ['diylandlord', 'bronxlandlord', 'nyc', 'rentalproperty', 'doryangel'],
  'investments':             ['realestateinvesting', 'bronx', 'nycrealestate', 'rentalincome', 'doryangel'],
  'property-automation':     ['smartproperty', 'proptech', 'bronxlandlord', 'IoT', 'doryangel'],
  'broker-partnerships':     ['bronxrealestate', 'nycbroker', 'propertymanagement', 'referralincome', 'doryangel'],
};

const IMAGE_QUERIES = {
  'property-management': [
    'business professional reviewing documents bright office',
    'office worker computer modern bright',
    'manhattan skyscraper daylight blue sky',
    'modern nyc office building',
  ],
  'diy-property-management': [
    'handyman repairing apartment bright',
    'maintenance worker tools toolbox',
    'professional plumber working bright',
    'nyc apartment building exterior bright',
  ],
  'investments': [
    'manhattan skyline daylight bright',
    'businesswoman laptop modern office bright',
    'nyc skyscrapers blue sky',
    'bronx residential building daylight',
  ],
  'property-automation': [
    'smart home technology modern apartment',
    'security camera building surveillance',
    'IoT smart sensor home device',
    'property technology digital dashboard screen',
  ],
  'broker-partnerships': [
    'real estate broker professional handshake office',
    'realtor reviewing documents bright office',
    'business partners meeting modern office nyc',
    'real estate agent client consultation bright',
  ],
};

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1600&q=80';

async function fetchCoverImage(category) {
  const queries = IMAGE_QUERIES[category] || IMAGE_QUERIES['property-management'];
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

    const photo = data.results[Math.floor(Math.random() * Math.min(data.results.length, 10))];
    return `${photo.urls.raw}&w=1600&q=80&fit=crop`;
  } catch (err) {
    console.warn(`Unsplash failed (${err.message}) — using fallback image`);
    return FALLBACK_IMAGE;
  }
}

const SYSTEM_PROMPT = `You are a content writer for DoryAngel LLC, a NYC property management company at 557 Grand Concourse Ave #4123, Bronx NY 10451. They offer flat-fee property management at $99/unit/month and have served Bronx and NYC owners since 2010.

CRITICAL RULES — what works for our audience (validated by real traffic data):

1. Title formula: must be either a question OR start with a number ("5 Free Tools...", "Top 3 Mistakes..."). Always reference the Bronx specifically — no other borough or city.

2. Pain-point excerpts: 1-2 sentences focused on a real landlord pain point — money lost, tenant trouble, compliance fines. NOT abstract or marketing-speak.

3. Word count: 800-1,200 words for the body content. Below 500 = zero traffic. We need depth.

4. NYC-specific examples: include at least one specific dollar figure or NYC-specific reference (a law name, neighborhood, court process, etc.) per article. Generic content gets ignored.

5. Tone: Expert, trustworthy, practical — like advice from a knowledgeable friend who knows NYC inside out.

6. Structure: Use markdown headings (h2, h3), short paragraphs (2-3 sentences), bullet lists where useful. Make it scannable.

7. Do NOT include the CTA in the content — the CTA is auto-appended to every post by our system.

8. Tool mentions (use judgment — only when it fits naturally, not in every post): DoryAngel offers landlords a Compliance Calendar (47 HPD, DOB &amp; FDNY tasks with exact penalty amounts and seasonal checklists, delivered monthly — free at doryangel.com/tools), a Weekly Digest (Monday summary of the 5 most urgent items: overdue rent, open HPD violations, expiring leases, maintenance tickets, compliance deadlines), an Owner Dashboard (real-time view of rent collection, maintenance, HPD violations, occupancy, and monthly expenses), and a Maintenance Tracker. When the post's problem is one these tools directly solve, add one brief sentence — e.g. "DoryAngel clients get this flagged automatically in their weekly digest" or "the owner dashboard tracks this in real time" or "DoryAngel's free Compliance Calendar covers this deadline every month." Do not force it if the connection isn't genuine.

9. Broker Partner Program mentions (for broker-partnerships category posts only): DoryAngel runs a Broker Partner Program (currently in beta) where NYC brokers earn $50/unit/month in recurring passive income — approximately 30% of the total management fee — for every unit they place with DoryAngel. The broker's existing commission is untouched. The only ongoing commitment is a 30-minute quarterly call. Brokers can request beta access at doryangel.com/broker-partner. When writing broker-partnerships posts, always reference this specific program with the real numbers ($50/unit/month, beta program terms apply) rather than vague "referral income" language.

When asked to write a post, also produce:
- An SEO title in field "seoTitleShort": max 48 chars, do NOT add " | DoryAngel" — the system appends it
- An SEO description (max 155 chars, includes a hook + value prop)
- A descriptive alt text for the hero image (used for accessibility + SEO)
- A Facebook-optimized version (200-280 words, hook-first, 2-3 bullet takeaways, then a closing section in this EXACT format — copy the labels, emojis, and line breaks exactly:

📅 Compliance Calendar (free) → https://dror75p-ops.github.io/Doryangel-preventive-maintenance-schedule.automation/
📬 DoryAngel Digest (free) → https://dror75p-ops.github.io/Doryangel-preventive-maintenance-schedule.automation/digest/
🔍 AI Property Inspector (free) → https://dror75p-ops.github.io/Transcribe_meeting/
📊 Property P&L Dashboard ($29) → https://beta.doryangel.com/tools/pl-dashboard/
🤝 Broker Partner Program ($50/unit/mo) → https://beta.doryangel.com/broker-partner.html

Then the hashtags on the final line. If the post topic naturally connects to one of these tools, bold the relevant tool line by wrapping it in ★ symbols (e.g. ★📅 Compliance Calendar...★) so it stands out. For broker-partnerships posts, move the Broker Partner Program line to the TOP of the list.

Categories must be exactly one of: property-management, diy-property-management, investments, property-automation, broker-partnerships.

For broker-partnerships posts: the audience is NYC real estate brokers and agents, not landlords. Write peer-to-peer — broker talking to broker. Focus on referral income, protecting client relationships, and how DoryAngel works as an expert backstop. Lead with the broker's pain point (income stops at closing, clients call them about management problems, fear of losing relationships). Do NOT include any landlord-specific compliance content as the primary angle.`;

const POST_SCHEMA = {
  type: 'object',
  properties: {
    title:            { type: 'string' },
    excerpt:          { type: 'string' },
    content:          { type: 'string' },
    seoTitleShort:    { type: 'string' },
    seoDescription:   { type: 'string' },
    heroImageAlt:     { type: 'string' },
    facebookPost:     { type: 'string' },
  },
  required: ['title', 'excerpt', 'content', 'seoTitleShort', 'seoDescription', 'heroImageAlt', 'facebookPost'],
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
    messages: [{
      role: 'user',
      content: `Write a blog post on this topic: "${topic.title}"
Target category: ${topic.category}
Year context: 2026

Remember: 800-1,200 words, NYC-specific examples, pain-point focused, scannable structure, no CTA in the content.`,
    }],
  });

  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response');
  let post;
  try {
    post = JSON.parse(textBlock.text);
  } catch (e) {
    throw new Error(`Claude returned invalid JSON: ${textBlock.text.slice(0, 200)}`);
  }

  console.log(
    `usage — input: ${message.usage.input_tokens}, ` +
    `cache_read: ${message.usage.cache_read_input_tokens ?? 0}, ` +
    `cache_write: ${message.usage.cache_creation_input_tokens ?? 0}, ` +
    `output: ${message.usage.output_tokens}`
  );

  const heroImage = await fetchCoverImage(topic.category);

  const SUFFIX = ' | DoryAngel';
  const MAX = 60;
  const stripped = post.seoTitleShort.replace(/\s*\|\s*DoryAngel\s*$/i, '').trim();
  const room = MAX - SUFFIX.length;
  const trimmed = stripped.length <= room
    ? stripped
    : stripped.slice(0, room).replace(/\s+\S*$/, '').trim();
  const seoTitle = trimmed + SUFFIX;

  return {
    slug: generateSlug(post.title),
    title: post.title,
    category: topic.category,
    excerpt: post.excerpt,
    publishedDate: today,
    minutesToRead: wordsToMinutes(post.content),
    heroImage,
    heroImageAlt: post.heroImageAlt,
    hashtags: HASHTAGS_BY_CATEGORY[topic.category],
    featured: false,
    seoTitle,
    seoDescription: post.seoDescription.slice(0, 155),
    author: 'DoryAngel Team',
    content: post.content,
    facebookPost: post.facebookPost,
  };
}

async function sendApprovalEmail(post) {
  const fbPost = post.facebookPost;

  await resend.emails.send({
    from: 'DoryAngel Blog <onboarding@resend.dev>',
    to: APPROVAL_EMAIL,
    subject: `📘 Facebook-ready: "${post.title}"`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A2740;">
        <div style="background:#0F2847;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h1 style="color:white;font-size:18px;margin:0;">📘 Ready to post to Facebook</h1>
          <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0;">2 long-presses → done</p>
        </div>
        <div style="padding:20px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">

          <div style="background:#FFF8E7;border:1px solid #F5D78E;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
            <p style="margin:0;font-size:13px;color:#8B6F1A;font-weight:700;">📥 STEP 1 — Long-press the image below → "Save image"</p>
          </div>
          <img src="${post.heroImage}" alt="${post.heroImageAlt}" style="width:100%;height:auto;border-radius:8px;margin-bottom:24px;display:block;" />

          <div style="background:#E7F3FF;border:1px solid #8FBCEB;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
            <p style="margin:0;font-size:13px;color:#1B4F8A;font-weight:700;">📋 STEP 2 — Long-press the box below → "Select all" → "Copy"</p>
          </div>

          <div style="background:#F4F7FA;border:2px solid #1E5AA8;border-radius:8px;padding:20px;margin-bottom:24px;">
            <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px;color:#1A2740;line-height:1.6;margin:0;word-wrap:break-word;">${fbPost}</pre>
          </div>

          <div style="background:#E8F8E8;border:1px solid #8FCB8F;border-radius:8px;padding:14px 16px;margin-bottom:32px;">
            <p style="margin:0;font-size:13px;color:#1B6B1B;font-weight:700;">✅ STEP 3 — Open Facebook → "Create post" → paste text + attach the image</p>
          </div>

          <hr style="border:none;border-top:1px solid #E2E8F0;margin:32px 0;" />

          <p style="font-size:11px;color:#8B9BAE;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">For reference</p>
          <h2 style="font-size:18px;color:#0F2847;margin:0 0 6px;">${post.title}</h2>
          <p style="color:#1E5AA8;font-size:12px;font-weight:700;margin:0 0 16px;">${post.category} · ${post.minutesToRead} min read · Live on doryangel.com</p>

          <details style="margin-bottom:24px;">
            <summary style="cursor:pointer;color:#1E5AA8;font-size:14px;font-weight:600;padding:8px 0;">Show full blog article ▾</summary>
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

  // Guard: skip if a post was already published today (prevents double-runs on schedule)
  // Bypass with FORCE_PUBLISH=true for manual test runs
  const today = formatDate(new Date());
  if (posts[0]?.publishedDate === today && process.env.FORCE_PUBLISH !== 'true') {
    console.log(`Post already published today (${today}) — skipping to avoid duplicate.`);
    console.log('To override, set FORCE_PUBLISH=true');
    process.exit(0);
  }

  const topic = await pickTopicWithAI(posts);
  console.log(`Generating post about: "${topic.title}" (${topic.category})`);

  const post = await generatePost(topic);
  console.log(`Generated: "${post.title}"`);

  // facebookPost is for the email only — strip before persisting
  const { facebookPost, ...postForIndex } = post;
  posts.unshift(postForIndex);
  writeFileSync(indexPath, JSON.stringify(posts, null, 2));
  console.log('Added to posts-index.json');

  await sendApprovalEmail(post);
  console.log(`Approval email sent to ${APPROVAL_EMAIL}`);

  // Hand off to Vera (social-post.js) via a temp file — keeps Nave's scope clean
  const { writeFileSync: wf } = await import('fs');
  wf('/tmp/social-queue.json', JSON.stringify({ slug: postForIndex.slug, facebookPost }));
  console.log('Social queue written for Vera → /tmp/social-queue.json');

  await notifyDigestSubscribers(postForIndex);
}

async function notifyDigestSubscribers(post) {
  const DIGEST_WEBHOOK = 'https://hook.eu1.make.com/wxmjj64ih7wvw4di4dyop4cwy8e75qj8';
  try {
    const res = await fetch(DIGEST_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: post.category,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        publishedDate: post.publishedDate,
      }),
    });
    if (res.ok) console.log('Digest webhook triggered — subscribers will be notified');
    else console.warn(`Digest webhook returned ${res.status}`);
  } catch (err) {
    console.warn(`Digest webhook failed (${err.message}) — subscribers not notified`);
  }
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
