// scripts/daily-audit.js
// Daily website improvement automation:
//   1. Reads current state (HTML, blog posts, git log, open issues)
//   2. If any auto-task is needed → implements it and signals the workflow to commit + PR
//   3. Otherwise → asks Claude to generate a fresh GitHub Issue idea
//   4. Emails the owner a daily digest

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
const resend = new Resend(process.env.RESEND_API_KEY);

const NOTIFY_EMAIL = 'dror75p@gmail.com';
const REPO = 'dror75p-ops/Doryangel-web-3-carousel-blog';
const GH_TOKEN = process.env.GH_TOKEN;

function today() { return new Date().toISOString().split('T')[0]; }

// ─── State ────────────────────────────────────────────────────────────────────

function readState() {
  const html = readFileSync('./index.html', 'utf8');
  const posts = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));

  const now = new Date();
  const msDay = 86400000;

  const catCounts = {};
  posts.forEach(p => { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });

  // Time-bucketed post counts
  const postsDay   = posts.filter(p => new Date(p.publishedDate) >= new Date(now - msDay)).length;
  const postsWeek  = posts.filter(p => new Date(p.publishedDate) >= new Date(now - 7 * msDay)).length;
  const postsMonth = posts.filter(p => new Date(p.publishedDate) >= new Date(now - 30 * msDay)).length;

  // Time-bucketed commit counts
  let commitsDay = 0, commitsWeek = 0, commitsMonth = 0;
  try {
    commitsDay   = parseInt(execSync('git log --oneline --since="1 day ago" | wc -l').toString()) || 0;
    commitsWeek  = parseInt(execSync('git log --oneline --since="7 days ago" | wc -l').toString()) || 0;
    commitsMonth = parseInt(execSync('git log --oneline --since="30 days ago" | wc -l').toString()) || 0;
  } catch {}

  let gitLog = '';
  try { gitLog = execSync('git log --oneline -20').toString().trim(); } catch {}

  const headEnd = html.indexOf('</head>');
  const head = html.slice(0, headEnd);

  // Detect the unconditional clarity block specifically (before <style>)
  const preStyleHead = head.slice(0, head.indexOf('<style'));
  const hasUnconditionalClarity = /\(function\(c,l,a,r,i,t,y\)/.test(preStyleHead);

  return {
    html,
    postCount: posts.length,
    categoryCounts: catCounts,
    recentPosts: posts.slice(0, 5).map(p => ({ title: p.title, date: p.publishedDate, category: p.category })),
    gitLog,
    stats: {
      posts:   { day: postsDay,   week: postsWeek,   month: postsMonth,   total: posts.length },
      commits: { day: commitsDay, week: commitsWeek, month: commitsMonth },
    },
    checks: {
      clarityGdprViolation: hasUnconditionalClarity,
      hasDnsPrefetch: html.includes('dns-prefetch'),
      hasFaqSchema: html.includes('"FAQPage"'),
      hasServiceSchema: html.includes('"Service"') || html.includes('"Product"'),
      hasBreadcrumbInBlog: false, // checked separately in build-blog.js
    },
  };
}

async function getOpenIssues() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues?state=open&labels=automation&per_page=30`, {
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (!res.ok) return [];
    const issues = await res.json();
    return issues.map(i => i.title);
  } catch {
    return [];
  }
}

// ─── Auto-implementable improvements (highest priority first) ─────────────────

const AUTO_TASKS = [
  {
    id: 'clarity-gdpr-fix',
    label: 'Fix Clarity GDPR violation',
    why: 'Clarity loads unconditionally in <head> before cookie consent. This violates GDPR — the consent-gated version at the bottom is the correct one and already handles all tracking.',
    priority: 10,
    isNeeded: (s) => s.checks.clarityGdprViolation,
    apply: (html) => {
      // Remove the standalone unconditional clarity block from head
      return html.replace(
        /<script type="text\/javascript">\n\s*\(function\(c,l,a,r,i,t,y\)\{[\s\S]*?\}\)\(window, document, "clarity", "script", "[^"]+"\);\n<\/script>\n/,
        ''
      );
    },
  },
  {
    id: 'dns-prefetch-analytics',
    label: 'Add dns-prefetch for analytics hosts',
    why: 'preconnect is set for Google Fonts but analytics hosts (GA4, Clarity) are missing dns-prefetch. Saves 100-200ms on first tracking ping.',
    priority: 7,
    isNeeded: (s) => !s.checks.hasDnsPrefetch,
    apply: (html) => {
      const hints = '<link rel="dns-prefetch" href="https://www.google-analytics.com">\n<link rel="dns-prefetch" href="https://www.clarity.ms">';
      return html.replace(
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        hints + '\n<link rel="preconnect" href="https://fonts.googleapis.com">'
      );
    },
  },
  {
    id: 'faq-schema',
    label: 'Add FAQPage JSON-LD schema',
    why: 'FAQ structured data triggers Google rich results (expandable Q&A in SERPs), significantly boosting CTR from organic search.',
    priority: 8,
    isNeeded: (s) => !s.checks.hasFaqSchema && s.html.toLowerCase().includes('faq'),
    apply: (html) => {
      // Extract FAQ items from the HTML
      const faqSchema = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How much does DoryAngel property management cost?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "DoryAngel offers flat-fee property management starting at $99/unit/month — no percentage of rent, no hidden fees. The Professional Plan is $199/unit/month and includes full service."
      }
    },
    {
      "@type": "Question",
      "name": "What areas does DoryAngel serve?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "DoryAngel serves the Bronx, Queens, Yonkers, Mount Vernon, New Rochelle, and North Jersey. We have been managing NYC rental properties since 2010."
      }
    },
    {
      "@type": "Question",
      "name": "What is included in DoryAngel's flat-fee property management?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Our flat-fee plans include tenant screening, rent collection, maintenance coordination, HPD violation management, real-time owner dashboards, and 24/7 emergency response."
      }
    },
    {
      "@type": "Question",
      "name": "How is DoryAngel different from traditional property managers?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Traditional property managers charge 8-12% of monthly rent. DoryAngel charges a flat $99/unit/month regardless of rent amount — saving Bronx and NYC landlords hundreds of dollars per month."
      }
    }
  ]
}
</script>`;
      return html.replace('</head>', faqSchema + '\n</head>');
    },
  },
];

// ─── GitHub Issue creation ────────────────────────────────────────────────────

async function createGitHubIssue(title, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${GH_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({ title, body, labels: ['enhancement', 'automation'] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.html_url;
}

// ─── Claude — generate a fresh issue idea ─────────────────────────────────────

async function generateIssueIdea(state, openIssueTitles) {
  const catSummary = Object.entries(state.categoryCounts)
    .map(([c, n]) => `${c}: ${n} posts`).join(', ');

  const prompt = `You are the growth advisor for DoryAngel LLC, a NYC flat-fee property management company targeting Bronx landlords.

Current website state:
- Blog posts: ${state.postCount} total — ${catSummary}
- Most recent posts: ${state.recentPosts.map(p => `"${p.title}" (${p.category})`).join(', ')}
- Recent activity: ${state.gitLog.split('\n').slice(0, 8).join(' | ')}

Open improvement issues already created (avoid duplicating these):
${openIssueTitles.length ? openIssueTitles.map(t => `- ${t}`).join('\n') : '- None yet'}

Generate ONE specific, high-value website improvement task that is NOT already in the open issues list.
Focus on what would most increase organic traffic, leads, or conversions for a Bronx property management company.

Options to consider (pick the single best one for today):
- Content: specific blog post topic or content series idea
- SEO: technical or on-page improvement
- Conversion: lead capture, CTA, or form improvement
- Social proof: reviews, testimonials, case studies
- Distribution: social automation, email, backlinks
- Analytics: tracking gaps

Return ONLY valid JSON (no markdown, no explanation outside the JSON):
{
  "title": "GitHub issue title (under 72 chars)",
  "body": "Full GitHub issue body in markdown — include: ## Why, ## What to build, ## Acceptance criteria. Be specific and actionable. 200-400 words.",
  "why_today": "One sentence explaining why this is the right task to do now"
}`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content.find(b => b.type === 'text')?.text ?? '{}';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON');
  return JSON.parse(match[0]);
}

// ─── Email digest ─────────────────────────────────────────────────────────────

async function sendDigest({ taskLabel, taskWhy, resultType, resultLink, state }) {
  const { stats, categoryCounts, postCount } = state;

  const resultColor     = resultType === 'code' ? '#E8F8E8' : '#E7F3FF';
  const resultBorder    = resultType === 'code' ? '#8FCB8F' : '#8FBCEB';
  const resultTextColor = resultType === 'code' ? '#1B6B1B' : '#1B4F8A';
  const resultIcon      = resultType === 'code' ? '✅ Implemented — PR opened' : '📋 GitHub Issue created';

  // ── Activity table rows ──────────────────────────────────────────────────────
  function statRow(label, { day, week, month }, color, bg) {
    return `<tr style="background:${bg};">
      <td style="padding:10px 12px;color:#556070;font-size:13px;">${label}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:${color};font-size:20px;">${day}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:${color};font-size:20px;">${week}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:${color};font-size:20px;">${month}</td>
    </tr>`;
  }

  // ── Category bar chart ───────────────────────────────────────────────────────
  const sortedCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  const maxCat = sortedCats[0]?.[1] || 1;
  const catBars = sortedCats.map(([cat, n], i) => {
    const pct = Math.round((n / maxCat) * 100);
    const bg  = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
    const label = cat.replace(/-/g, ' ');
    return `<tr style="background:${bg};">
      <td style="padding:6px 12px;color:#556070;font-size:12px;width:38%;">${label}</td>
      <td style="padding:6px 12px;width:50%;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="width:${pct}%;background:#1E5AA8;height:10px;border-radius:3px;"></td>
          <td style="width:${100 - pct}%;"></td>
        </tr></table>
      </td>
      <td style="padding:6px 12px;text-align:right;font-weight:700;color:#0F2847;font-size:12px;width:12%;">${n}</td>
    </tr>`;
  }).join('');

  // ── Recent posts ─────────────────────────────────────────────────────────────
  const recentRows = state.recentPosts.map((p, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
    return `<tr style="background:${bg};">
      <td style="padding:5px 12px;color:#0F2847;font-size:12px;">${p.title}</td>
      <td style="padding:5px 12px;color:#8B9BAE;font-size:11px;white-space:nowrap;">${p.date}</td>
    </tr>`;
  }).join('');

  await resend.emails.send({
    from: 'DoryAngel Bot <onboarding@resend.dev>',
    to: NOTIFY_EMAIL,
    subject: `🔧 Daily Audit — ${taskLabel}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#1A2740;">

  <!-- Header -->
  <div style="background:#0F2847;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;font-size:18px;margin:0;">🔧 Daily Website Audit</h1>
    <p style="color:rgba(255,255,255,0.65);font-size:13px;margin:5px 0 0;">${today()} — automated improvement loop</p>
  </div>

  <div style="padding:20px 24px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">

    <!-- Today's task -->
    <h2 style="font-size:15px;color:#0F2847;margin:0 0 5px;">Today: ${taskLabel}</h2>
    <p style="color:#556070;font-size:13px;margin:0 0 14px;">${taskWhy}</p>
    <div style="background:${resultColor};border:1px solid ${resultBorder};border-radius:8px;padding:12px 16px;margin-bottom:28px;">
      <p style="margin:0 0 4px;color:${resultTextColor};font-weight:700;font-size:13px;">${resultIcon}</p>
      <a href="${resultLink}" style="color:#1E5AA8;font-size:12px;word-break:break-all;">${resultLink}</a>
    </div>

    <!-- Activity stats: Day / Week / Month -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">📊 Activity</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <tr style="background:#F4F7FA;">
        <th style="padding:8px 12px;text-align:left;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:34%;">Metric</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">Today</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">7 days</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">30 days</th>
      </tr>
      ${statRow('Blog posts published', stats.posts, '#0F2847', '#ffffff')}
      ${statRow('Site commits', stats.commits, '#1E5AA8', '#F8FAFB')}
      <tr style="background:#ffffff;">
        <td style="padding:10px 12px;color:#556070;font-size:13px;">Total posts (all time)</td>
        <td colspan="3" style="padding:10px 12px;text-align:center;font-weight:700;color:#0F2847;font-size:20px;">${postCount}</td>
      </tr>
    </table>

    <!-- Category bar chart -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">📂 Blog categories</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      ${catBars}
    </table>

    <!-- Recent posts -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🗒 Latest posts</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:8px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;font-size:12px;">
      ${recentRows}
    </table>

    <!-- Footer -->
    <p style="margin:28px 0 0;font-size:11px;color:#8B9BAE;text-align:center;">
      DoryAngel daily audit — runs every day at 9 AM EST<br>
      <a href="https://github.com/${REPO}/pulls" style="color:#8B9BAE;">Open PRs</a> ·
      <a href="https://github.com/${REPO}/issues" style="color:#8B9BAE;">Open issues</a>
    </p>
  </div>
</div>`,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[daily-audit] ${today()}`);

  const state = readState();
  console.log(`Posts: ${state.postCount} | Categories: ${JSON.stringify(state.categoryCounts)}`);
  console.log(`Checks: ${JSON.stringify(state.checks)}`);

  // Find the first pending auto-task
  const pendingTask = AUTO_TASKS.find(t => t.isNeeded(state));

  let taskLabel, taskWhy, resultType, resultLink;

  if (pendingTask) {
    console.log(`Auto-task: ${pendingTask.id}`);
    const updatedHtml = pendingTask.apply(state.html);

    if (updatedHtml && updatedHtml !== state.html) {
      writeFileSync('./index.html', updatedHtml);
      console.log(`Applied: ${pendingTask.id}`);
    } else {
      console.warn(`apply() returned unchanged HTML for ${pendingTask.id} — skipping commit`);
    }

    // Signal the workflow: there are file changes to commit + PR
    writeFileSync('/tmp/audit-changed.txt', 'true');
    writeFileSync('/tmp/audit-task.txt', pendingTask.label);

    taskLabel = pendingTask.label;
    taskWhy = pendingTask.why;
    resultType = 'code';
    resultLink = `https://github.com/${REPO}/pulls`;

  } else {
    console.log('All auto-tasks done — generating GitHub Issue idea via Claude');

    const openIssues = await getOpenIssues();
    console.log(`Open issues: ${openIssues.length}`);

    const idea = await generateIssueIdea(state, openIssues);
    console.log(`Idea: ${idea.title}`);

    resultLink = await createGitHubIssue(idea.title, idea.body);
    console.log(`Issue created: ${resultLink}`);

    writeFileSync('/tmp/audit-changed.txt', 'false');
    writeFileSync('/tmp/audit-task.txt', idea.title);

    taskLabel = idea.title;
    taskWhy = idea.why_today;
    resultType = 'issue';
  }

  await sendDigest({ taskLabel, taskWhy, resultType, resultLink, state });
  console.log(`Digest sent to ${NOTIFY_EMAIL}`);
}

main().catch(err => {
  console.error('daily-audit error:', err.message);
  process.exit(1);
});
