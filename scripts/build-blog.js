// build-blog.js — Generate /blog/[slug]/index.html for every post
// Each page is fully self-contained with SEO, Open Graph, JSON-LD, and CTA.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { marked } from 'marked';

const SITE_URL = 'https://doryangel.com';
const BOOKING_URL = 'https://cal.com/dory-angel-management-v5o0ke/30min';
const CONTACT_URL = 'https://doryangel.com/#contact';
const COMPANY_NAME = 'DoryAngel LLC';

const CATEGORY_LABEL = {
  'property-management':     'Property Management',
  'diy-property-management': 'DIY Property Management',
  'investments':             'Investments',
  'property-automation':     'Property Automation',
};

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function getRelatedPosts(currentPost, allPosts) {
  return allPosts
    .filter(p => p.category === currentPost.category && p.slug !== currentPost.slug)
    .slice(0, 3);
}

function renderPage(post, related) {
  const url = `${SITE_URL}/blog/${post.slug}/`;
  const categoryLabel = CATEGORY_LABEL[post.category] || post.category;
  const hashtagText = (post.hashtags || []).map(t => '#' + t).join(' ');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    image: post.heroImage,
    datePublished: post.publishedDate,
    author: { '@type': 'Organization', name: post.author || COMPANY_NAME },
    publisher: {
      '@type': 'Organization',
      name: COMPANY_NAME,
      url: SITE_URL,
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    description: post.excerpt,
    url,
  };

  const relatedHtml = related.length === 0 ? '' : `
    <section class="related-posts">
      <h2>Continue reading</h2>
      <div class="related-grid">
        ${related.map(r => `
          <a href="../${r.slug}/" class="related-card">
            <div class="related-image" style="background-image:url('${escape(r.heroImage)}')"></div>
            <div class="related-body">
              <div class="related-cat">${escape(CATEGORY_LABEL[r.category])}</div>
              <h3>${escape(r.title)}</h3>
              <div class="related-meta">${r.minutesToRead} min read</div>
            </div>
          </a>
        `).join('')}
      </div>
    </section>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escape(post.seoTitle)}</title>
<meta name="description" content="${escape(post.seoDescription)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta name="geo.region" content="US-NY">
<meta name="geo.placename" content="Bronx, New York City">
<meta name="geo.position" content="40.8177;-73.9278">
<meta name="ICBM" content="40.8177, -73.9278">

<meta property="og:type" content="article">
<meta property="og:title" content="${escape(post.title)}">
<meta property="og:description" content="${escape(post.excerpt)}">
<meta property="og:image" content="${escape(post.heroImage)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${COMPANY_NAME}">
<meta property="article:published_time" content="${post.publishedDate}">
<meta property="article:section" content="${escape(categoryLabel)}">
${(post.hashtags || []).map(t => `<meta property="article:tag" content="${escape(t)}">`).join('\n')}

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(post.title)}">
<meta name="twitter:description" content="${escape(post.excerpt)}">
<meta name="twitter:image" content="${escape(post.heroImage)}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">

<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --navy: #0F2847;
  --blue: #1E5AA8;
  --blue-light: #5B9FEA;
  --blue-dim: #EBF3FD;
  --grey: #8B9BAE;
  --grey-light: #F4F7FA;
  --grey-mid: #E2E8F0;
  --text: #1A2740;
  --text-muted: #556070;
}
html { scroll-behavior: smooth; }
body {
  font-family: 'DM Sans', sans-serif;
  color: var(--text); background: white; line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--blue); }

.post-nav {
  background: white; border-bottom: 1px solid var(--grey-mid);
  padding: 14px 24px;
  display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; z-index: 50;
  backdrop-filter: blur(10px); background: rgba(255,255,255,0.95);
}
.post-nav a.back { color: var(--navy); font-weight: 600; font-size: 14px; text-decoration: none; }
.post-nav a.cta {
  background: var(--blue); color: white; text-decoration: none;
  padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 13px;
  transition: background 0.2s;
}
.post-nav a.cta:hover { background: var(--navy); }

.hero-image-wrap {
  width: 100%; height: 400px;
  background-size: cover; background-position: center;
  position: relative;
}
.hero-image-wrap::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 50%, rgba(15,40,71,0.5) 100%);
}
@media (max-width: 700px) { .hero-image-wrap { height: 240px; } }

article {
  max-width: 720px; margin: 0 auto; padding: 48px 24px 64px;
}
.post-meta {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  font-size: 13px; color: var(--text-muted); margin-bottom: 16px;
}
.post-cat {
  background: var(--blue-dim); color: var(--blue);
  padding: 4px 12px; border-radius: 100px;
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1px;
}
.post-meta-divider { color: var(--grey-mid); }
h1.post-title {
  font-family: 'DM Serif Display', serif;
  font-size: clamp(28px, 4vw, 44px);
  color: var(--navy); line-height: 1.2;
  margin-bottom: 18px; font-weight: 400;
  text-wrap: pretty;
}
.post-excerpt {
  font-size: 19px; color: var(--text-muted);
  line-height: 1.6; margin-bottom: 36px;
  border-left: 3px solid var(--blue); padding-left: 16px;
}

.post-body { font-size: 17px; color: var(--text); line-height: 1.8; }
.post-body h1 { font-family: 'DM Serif Display', serif; font-size: 28px; color: var(--navy); margin: 36px 0 14px; font-weight: 400; }
.post-body h2 { font-size: 22px; color: var(--navy); margin: 32px 0 12px; font-weight: 700; }
.post-body h3 { font-size: 16px; color: var(--blue); margin: 24px 0 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.post-body p { margin-bottom: 18px; }
.post-body ul, .post-body ol { padding-left: 24px; margin-bottom: 18px; }
.post-body li { margin-bottom: 8px; }
.post-body a { text-decoration: underline; }
.post-body strong { color: var(--navy); }
.post-body em { color: var(--text-muted); }
.post-body hr { border: none; border-top: 1px solid var(--grey-mid); margin: 36px 0; }
.post-body table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 15px; }
.post-body th { background: var(--navy); color: white; padding: 12px 14px; text-align: left; font-weight: 600; }
.post-body td { border: 1px solid var(--grey-mid); padding: 12px 14px; }
.post-body tr:nth-child(even) td { background: var(--grey-light); }
.post-body blockquote { border-left: 4px solid var(--blue); padding: 4px 0 4px 18px; margin: 24px 0; color: var(--text-muted); font-style: italic; }

.cta-block {
  margin: 48px 0 0;
  background: var(--navy); color: white;
  border-radius: 14px; padding: 32px 28px;
  text-align: center;
}
.cta-block .city { font-family: 'DM Serif Display', serif; font-size: 22px; margin-bottom: 10px; }
.cta-block p { font-size: 15px; color: rgba(255,255,255,0.85); line-height: 1.6; margin-bottom: 24px; }
.cta-block .btn {
  background: white; color: var(--navy);
  padding: 14px 28px; border-radius: 8px;
  font-size: 15px; font-weight: 700; text-decoration: none;
  display: inline-flex; align-items: center; gap: 8px;
  transition: transform 0.15s, box-shadow 0.2s;
}
.cta-block .btn:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(0,0,0,0.25); }

.internal-links {
  margin-top: 40px; padding: 24px 28px;
  background: var(--blue-dim); border-radius: 12px;
  border-left: 4px solid var(--blue);
}
.internal-links p { font-size: 13px; font-weight: 700; color: var(--blue); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
.internal-links ul { list-style: none; padding: 0; margin: 0; }
.internal-links li { margin-bottom: 8px; }
.internal-links li a { color: var(--navy); font-size: 15px; font-weight: 600; text-decoration: none; }
.internal-links li a:hover { text-decoration: underline; color: var(--blue); }

.hashtag-row {
  margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--grey-mid);
  font-size: 13px; color: var(--text-muted);
}
.hashtag-row span { color: var(--blue); margin-right: 6px; }

.related-posts {
  background: var(--grey-light);
  padding: 56px 24px;
  margin-top: 64px;
}
.related-posts > * { max-width: 1080px; margin-inline: auto; }
.related-posts h2 {
  font-family: 'DM Serif Display', serif;
  font-size: 28px; color: var(--navy); margin-bottom: 28px; font-weight: 400;
}
.related-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
}
@media (max-width: 800px) { .related-grid { grid-template-columns: 1fr; } }
.related-card {
  background: white; border-radius: 12px; overflow: hidden;
  text-decoration: none; color: inherit;
  border: 1px solid var(--grey-mid);
  transition: transform 0.2s, box-shadow 0.2s;
}
.related-card:hover { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(15,40,71,0.12); }
.related-image { width: 100%; height: 160px; background-size: cover; background-position: center; }
.related-body { padding: 18px 18px 22px; }
.related-cat { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--blue); margin-bottom: 8px; }
.related-card h3 { font-family: 'DM Serif Display', serif; font-size: 17px; color: var(--navy); line-height: 1.35; font-weight: 400; margin-bottom: 10px; }
.related-meta { font-size: 12px; color: var(--text-muted); }

footer.post-footer {
  text-align: center; padding: 32px 24px;
  background: var(--navy); color: rgba(255,255,255,0.7);
  font-size: 13px;
}
footer.post-footer a { color: white; text-decoration: none; }
</style>
</head>
<body>

<nav class="post-nav">
  <a href="../../#blog" class="back">← All articles</a>
  <a href="${BOOKING_URL}" target="_blank" class="cta">Book Free Consultation</a>
</nav>

<div class="hero-image-wrap" style="background-image:url('${escape(post.heroImage)}')" role="img" aria-label="${escape(post.heroImageAlt)}"></div>

<article>
  <div class="post-meta">
    <span class="post-cat">${escape(categoryLabel)}</span>
    <span>${formatDate(post.publishedDate)}</span>
    <span class="post-meta-divider">·</span>
    <span>${post.minutesToRead} min read</span>
  </div>

  <h1 class="post-title">${escape(post.title)}</h1>
  <p class="post-excerpt">${escape(post.excerpt)}</p>

  <div class="post-body">
    ${marked.parse(post.content)}
  </div>

  <div class="cta-block">
    <div class="city">Managing rental property in NYC?</div>
    <p>DoryAngel handles everything for a flat <strong>$99/unit/month</strong> — no hidden fees, no percentage tricks. Bronx, Manhattan, Queens, Brooklyn.</p>
    <a class="btn" href="${CONTACT_URL}">
      Get a Free Consultation →
    </a>
  </div>

  <div class="internal-links">
    <p>Explore DoryAngel:</p>
    <ul>
      <li><a href="${SITE_URL}/#pricing">View flat-fee pricing plans — from $99/month →</a></li>
      <li><a href="${SITE_URL}/#services">Full list of property management services →</a></li>
      <li><a href="${SITE_URL}/#blog">More articles for NYC landlords →</a></li>
      <li><a href="${CONTACT_URL}">Request a free property audit →</a></li>
    </ul>
  </div>

  ${hashtagText ? `<div class="hashtag-row">${(post.hashtags || []).map(t => `<span>#${escape(t)}</span>`).join('')}</div>` : ''}
</article>

${relatedHtml}

<footer class="post-footer">
  <p>${COMPANY_NAME} · <a href="mailto:office@doryangel.com">office@doryangel.com</a> · (516) 847-4999</p>
  <p style="margin-top:6px;">557 Grand Concourse Ave #4123, Bronx NY 10451</p>
</footer>

</body>
</html>
`;
}

function buildSitemap(posts) {
  const urls = [
    `  <url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    ...posts.map(p =>
      `  <url><loc>${SITE_URL}/blog/${p.slug}/</loc><lastmod>${p.publishedDate}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`
    ),
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

const posts = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));

if (existsSync('./blog')) rmSync('./blog', { recursive: true, force: true });

let count = 0;
for (const post of posts) {
  const dir = `./blog/${post.slug}`;
  mkdirSync(dir, { recursive: true });
  const related = getRelatedPosts(post, posts);
  writeFileSync(`${dir}/index.html`, renderPage(post, related));
  count++;
}

writeFileSync('./sitemap.xml', buildSitemap(posts));
console.log(`Built ${count} blog post pages + sitemap.xml`);
