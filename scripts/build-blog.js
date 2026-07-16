// build-blog.js — Generate /blog/[slug]/index.html for every post
// Each page is fully self-contained with SEO, Open Graph, JSON-LD, and CTA.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { marked } from 'marked';

const SITE_URL = 'https://www.doryangel.com';
const BOOKING_URL = 'https://cal.com/dory-angel-management-v5o0ke/30min';
const CONTACT_URL = 'https://www.doryangel.com/#contact';
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

function extractFAQs(markdown) {
  const lines = markdown.split('\n');
  const faqs = [];
  let currentQ = null;
  let currentALines = [];

  const flush = () => {
    if (currentQ && currentALines.length > 0) {
      const answer = currentALines
        .join(' ')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .trim()
        .slice(0, 500);
      if (answer) faqs.push({ q: currentQ, a: answer });
    }
    currentQ = null;
    currentALines = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      flush();
      const heading = headingMatch[1].trim();
      if (heading.endsWith('?')) currentQ = heading;
    } else if (currentQ) {
      const stripped = line.trim();
      if (stripped.startsWith('- ') || stripped.startsWith('* ')) {
        currentALines.push(stripped.slice(2));
      } else if (stripped && !stripped.startsWith('#')) {
        currentALines.push(stripped);
      }
    }
  }
  flush();
  return faqs;
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
  const faqs = extractFAQs(post.content);
  const faqLd = faqs.length >= 2 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  } : null;

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

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/#blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
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
<script type="application/ld+json">
${JSON.stringify(breadcrumbLd, null, 2)}
</script>
${faqLd ? `<script type="application/ld+json">
${JSON.stringify(faqLd, null, 2)}
</script>` : ''}

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
  <a href="../" class="back">← All articles</a>
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
      <li><a href="${SITE_URL}/blog/">More articles for NYC landlords →</a></li>
      <li><a href="${SITE_URL}/faq/">Bronx landlord FAQ: costs, compliance &amp; more →</a></li>
      <li><a href="${CONTACT_URL}">Request a free property audit →</a></li>
    </ul>
  </div>

  ${hashtagText ? `<div class="hashtag-row">${(post.hashtags || []).map(t => `<span>#${escape(t)}</span>`).join('')}</div>` : ''}

  <p class="legal-note" style="font-size:12px;color:#888;margin-top:32px;line-height:1.5;">This article is for informational purposes only and does not constitute legal, financial, or professional advice. Consult a qualified attorney or advisor for guidance specific to your situation.</p>
</article>

${relatedHtml}

<footer class="post-footer">
  <p>${COMPANY_NAME} · <a href="mailto:office@doryangel.com">office@doryangel.com</a> · (516) 847-4999</p>
  <p style="margin-top:6px;">557 Grand Concourse Ave #4123, Bronx NY 10451</p>
</footer>

<script defer src="/_vercel/insights/script.js"></script>
<script defer src="/_vercel/speed-insights/script.js"></script>

<!-- Consent-gated GA4 + Clarity (shared loader) -->
<script src="/analytics.js"></script>

</body>
</html>
`;
}

const CATEGORY_ORDER = ['property-management', 'diy-property-management', 'investments', 'property-automation'];

function labelForCategory(cat) {
  return CATEGORY_LABEL[cat] || String(cat).replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

// Order categories by the canonical list first, then any others as they appear.
function orderedCategories(sortedPosts) {
  const seen = new Set();
  const cats = [];
  for (const c of CATEGORY_ORDER) {
    if (sortedPosts.some(p => p.category === c)) { cats.push(c); seen.add(c); }
  }
  for (const p of sortedPosts) {
    if (!seen.has(p.category)) { cats.push(p.category); seen.add(p.category); }
  }
  return cats;
}

// Static, fully-crawlable blog index. Gives every post a plain-HTML internal
// link (the JS carousel on the homepage is invisible to non-rendering crawlers),
// which is the fix for "Crawled - currently not indexed" on the post URLs.
function renderHub(posts) {
  const url = `${SITE_URL}/blog/`;
  const sorted = [...posts].sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate));
  const total = sorted.length;
  const cats = orderedCategories(sorted);

  const sectionsHtml = cats.map(cat => {
    const items = sorted.filter(p => p.category === cat);
    return `
    <section class="hub-cat">
      <h2 class="hub-cat-title">${escape(labelForCategory(cat))} <span class="hub-cat-count">${items.length}</span></h2>
      <ul class="hub-list">
        ${items.map(p => `
        <li class="hub-item">
          <a class="hub-link" href="/blog/${p.slug}/">
            <span class="hub-item-title">${escape(p.title)}</span>
            <span class="hub-item-meta">${formatDate(p.publishedDate)} &middot; ${p.minutesToRead || 5} min read</span>
          </a>
          <p class="hub-item-excerpt">${escape(p.excerpt)}</p>
        </li>`).join('')}
      </ul>
    </section>`;
  }).join('');

  const collectionLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'DoryAngel Blog — Bronx & NYC Property Management Guides',
    url,
    description: `Guides for Bronx and NYC landlords on property management, tenant screening, NYC law, investments and automation. ${total} articles from DoryAngel.`,
    isPartOf: { '@type': 'WebSite', name: COMPANY_NAME, url: SITE_URL },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: sorted.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/blog/${p.slug}/`,
        name: p.title,
      })),
    },
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: url },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DoryAngel Blog | Bronx &amp; NYC Property Management Guides</title>
<meta name="description" content="Practical guides for Bronx &amp; NYC landlords: flat-fee property management, tenant screening, NYC law, investments and automation. ${total} articles from the DoryAngel team.">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta name="geo.region" content="US-NY">
<meta name="geo.placename" content="Bronx, New York City">

<meta property="og:type" content="website">
<meta property="og:title" content="DoryAngel Blog | Bronx &amp; NYC Property Management Guides">
<meta property="og:description" content="Practical guides for Bronx &amp; NYC landlords: property management, tenant screening, NYC law, investments and automation.">
<meta property="og:image" content="${SITE_URL}/assets/logo.jpg">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${COMPANY_NAME}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="DoryAngel Blog | Bronx &amp; NYC Property Management Guides">
<meta name="twitter:description" content="Practical guides for Bronx &amp; NYC landlords: property management, tenant screening, NYC law, investments and automation.">
<meta name="twitter:image" content="${SITE_URL}/assets/logo.jpg">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">

<script type="application/ld+json">
${JSON.stringify(collectionLd, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(breadcrumbLd, null, 2)}
</script>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --navy: #0F2847; --blue: #1E5AA8; --blue-light: #5B9FEA; --blue-dim: #EBF3FD;
  --grey: #8B9BAE; --grey-light: #F4F7FA; --grey-mid: #E2E8F0;
  --text: #1A2740; --text-muted: #556070;
}
html { scroll-behavior: smooth; }
body { font-family: 'DM Sans', sans-serif; color: var(--text); background: white; line-height: 1.65; -webkit-font-smoothing: antialiased; }
a { color: var(--blue); }

.post-nav {
  border-bottom: 1px solid var(--grey-mid); padding: 14px 24px;
  display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; z-index: 50;
  backdrop-filter: blur(10px); background: rgba(255,255,255,0.95);
}
.post-nav a.back { color: var(--navy); font-weight: 600; font-size: 14px; text-decoration: none; }
.post-nav a.cta { background: var(--blue); color: white; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 13px; transition: background 0.2s; }
.post-nav a.cta:hover { background: var(--navy); }

.hub-head { background: var(--navy); color: white; padding: 56px 24px; text-align: center; }
.hub-head .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--blue-light); margin-bottom: 14px; }
.hub-head h1 { font-family: 'DM Serif Display', serif; font-size: clamp(30px, 5vw, 48px); font-weight: 400; line-height: 1.15; margin-bottom: 16px; }
.hub-head p { font-size: 17px; color: rgba(255,255,255,0.82); max-width: 620px; margin: 0 auto; }

main.hub { max-width: 860px; margin: 0 auto; padding: 48px 24px 24px; }
.hub-cat { margin-bottom: 48px; }
.hub-cat-title { font-family: 'DM Serif Display', serif; font-weight: 400; font-size: 26px; color: var(--navy); padding-bottom: 12px; border-bottom: 2px solid var(--blue-dim); margin-bottom: 20px; display: flex; align-items: baseline; gap: 10px; }
.hub-cat-count { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 700; color: var(--blue); background: var(--blue-dim); border-radius: 100px; padding: 2px 10px; }
.hub-list { list-style: none; }
.hub-item { padding: 18px 0; border-bottom: 1px solid var(--grey-mid); }
.hub-item:last-child { border-bottom: none; }
.hub-link { display: flex; flex-direction: column; gap: 4px; text-decoration: none; }
.hub-item-title { font-size: 19px; font-weight: 700; color: var(--navy); line-height: 1.35; }
.hub-link:hover .hub-item-title { color: var(--blue); text-decoration: underline; }
.hub-item-meta { font-size: 12px; color: var(--text-muted); }
.hub-item-excerpt { font-size: 15px; color: var(--text-muted); line-height: 1.6; margin-top: 6px; }

.hub-cta { background: var(--blue-dim); border-radius: 14px; padding: 32px 28px; text-align: center; margin: 8px auto 64px; max-width: 860px; }
.hub-cta .t { font-family: 'DM Serif Display', serif; font-size: 22px; color: var(--navy); margin-bottom: 10px; }
.hub-cta p { font-size: 15px; color: var(--text-muted); margin-bottom: 20px; }
.hub-cta a.btn { background: var(--blue); color: white; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; display: inline-block; }
.hub-cta a.btn:hover { background: var(--navy); }

footer.post-footer { text-align: center; padding: 32px 24px; background: var(--navy); color: rgba(255,255,255,0.7); font-size: 13px; }
footer.post-footer a { color: white; text-decoration: none; }
</style>
</head>
<body>

<nav class="post-nav">
  <a href="/" class="back">&larr; DoryAngel home</a>
  <a href="${BOOKING_URL}" target="_blank" class="cta">Book Free Consultation</a>
</nav>

<header class="hub-head">
  <div class="eyebrow">Property Insights</div>
  <h1>The DoryAngel Blog</h1>
  <p>Practical, no-fluff guides for Bronx &amp; NYC landlords — property management, tenant screening, NYC law, investments and automation. ${total} articles and counting.</p>
</header>

<main class="hub">
${sectionsHtml}
</main>

<div class="hub-cta">
  <div class="t">Managing rental property in NYC?</div>
  <p>DoryAngel handles everything for a flat <strong>$99/unit/month</strong> — no hidden fees, no percentage tricks.</p>
  <a class="btn" href="${CONTACT_URL}">Get a Free Consultation &rarr;</a>
</div>

<footer class="post-footer">
  <p>${COMPANY_NAME} &middot; <a href="mailto:office@doryangel.com">office@doryangel.com</a> &middot; (516) 847-4999</p>
  <p style="margin-top:6px;">557 Grand Concourse Ave #4123, Bronx NY 10451</p>
</footer>

<script defer src="/_vercel/insights/script.js"></script>
<script defer src="/_vercel/speed-insights/script.js"></script>
<script src="/analytics.js"></script>

</body>
</html>
`;
}

function buildSitemap(posts) {
  const newestPost = posts.reduce((a, b) =>
    new Date(a.publishedDate) > new Date(b.publishedDate) ? a : b
  );
  const urls = [
    `  <url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${SITE_URL}/blog/</loc><lastmod>${newestPost.publishedDate}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    `  <url><loc>${SITE_URL}/broker-partner.html</loc><lastmod>2026-05-23</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`,
    `  <url><loc>${SITE_URL}/flat-fee-vs-commission/</loc><lastmod>2026-07-08</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`,
    `  <url><loc>${SITE_URL}/tax-checklist/</loc><lastmod>2026-06-26</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`,
    `  <url><loc>${SITE_URL}/faq/</loc><lastmod>2026-07-15</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`,
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

writeFileSync('./blog/index.html', renderHub(posts));
writeFileSync('./sitemap.xml', buildSitemap(posts));
console.log(`Built ${count} blog post pages + /blog/ hub + sitemap.xml`);
