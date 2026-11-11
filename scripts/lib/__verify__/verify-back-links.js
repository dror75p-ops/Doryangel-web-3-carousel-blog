// scripts/lib/__verify__/verify-back-links.js
//
// Proves Nave's back-links (scripts/lib/back-links.js): every new post gets 1-2
// inbound links from related older posts, always on the single "Related
// reading" line at the end of the intro (never under a question heading, where
// it would leak into FAQ structured data), and Arlo does not read the added
// link as an edit. Offline, no secrets.
//   node scripts/lib/__verify__/verify-back-links.js

import { readFileSync } from 'fs';
import {
  MARKER, MAX_LINKS_PER_LINE, BACK_LINKS_PER_NEW_POST,
  relatedLinkCount, stripRelatedReading, addRelatedLink, pickBackLinkSources, addBackLinks, linkedSlugs,
} from '../back-links.js';

let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}

const markerLines = c => String(c).split('\n').filter(l => l.startsWith(MARKER)).length;
const markerBeforeFirstHeading = c => {
  const lines = String(c).split('\n');
  const m = lines.findIndex(l => l.startsWith(MARKER));
  const h = lines.findIndex(l => /^#{2,3}\s/.test(l));
  return m >= 0 && (h < 0 || m < h);
};

// ── Synthetic posts ──
const body = (intro, related = '') =>
  `${intro}\n\n${related ? related + '\n\n' : ''}## Why does the boiler fail?\n\nBecause of sediment.\n\n## What does it cost?\n\n$400.`;
const link = (t, s) => `[${t}](/blog/${s}/)`;
const P = (slug, title, hashtags, content, publishedDate = '2026-10-01') =>
  ({ slug, title, excerpt: '', hashtags, content, publishedDate });

const newPost = P('boiler-flush-cost-fall', 'What a Fall Boiler Flush Actually Costs Your Building',
  ['boiler', 'heating', 'maintenance'], body('New post.'), '2026-11-11');

const fresh = () => [
  P('no-line', 'Boiler heating failures in winter', ['boiler', 'heating'], body('Intro A.')),
  P('one-link', 'Heating season boiler checklist', ['boiler', 'heating'],
    body('Intro B.', `${MARKER} ${link('Other', 'other-post')}`), '2026-09-01'),
  P('full-line', 'Boiler heating maintenance guide', ['boiler', 'heating', 'maintenance'],
    body('Intro C.', `${MARKER} ${link('A', 'a')} · ${link('B', 'b')} · ${link('C', 'c')}`)),
  P('already-links', 'Boiler heating repair costs', ['boiler', 'heating', 'maintenance'],
    body(`Intro D with ${link('the flush', 'boiler-flush-cost-fall')}.`)),
  P('dup', 'Boiler heating dup', ['boiler', 'heating', 'maintenance'], body('Dup 1.')),
  P('dup', 'Boiler heating dup', ['boiler', 'heating', 'maintenance'], body('Dup 2.')),
  P('off-topic', 'Tenant screening without getting sued', ['screening', 'tenants'], body('Intro E.')),
];

// ── Picking sources ──
{
  const posts = fresh();
  const picked = pickBackLinkSources(posts, newPost).map(p => p.slug);
  check(`picks at most ${BACK_LINKS_PER_NEW_POST} sources`, picked.length === BACK_LINKS_PER_NEW_POST);
  check('skips a post whose line is full', !picked.includes('full-line'));
  check('skips a post that already links to the new post', !picked.includes('already-links'));
  check('skips a slug that appears twice in the index', !picked.includes('dup'));
  check('skips an off-topic post', !picked.includes('off-topic'));
  check('picks the two relevant posts with room', picked.includes('no-line') && picked.includes('one-link'));
  check('on equal relevance, the post with fewer links on its line comes first', picked[0] === 'no-line');
  check('never picks the new post itself', !pickBackLinkSources([...posts, newPost], newPost).some(p => p.slug === newPost.slug));
  check('nothing relevant gives no sources', pickBackLinkSources([posts[6]], newPost).length === 0);
}

// ── Writing the link ──
{
  const posts = fresh();
  const before = new Map(posts.map(p => [p, p.content]));
  const sources = addBackLinks(posts, newPost);
  check('addBackLinks returns the changed posts', sources.length === 2);
  for (const s of sources) {
    check(`${s.slug}: now links to the new post`, linkedSlugs(s.content).has(newPost.slug));
    check(`${s.slug}: still exactly one Related-reading line`, markerLines(s.content) === 1);
    check(`${s.slug}: the line sits before the first heading (no FAQ leak)`, markerBeforeFirstHeading(s.content));
    check(`${s.slug}: Arlo's fingerprint body is unchanged`,
      stripRelatedReading(s.content) === stripRelatedReading(before.get(s)));
    check(`${s.slug}: the question sections are untouched`,
      s.content.slice(s.content.indexOf('## ')) === before.get(s).slice(before.get(s).indexOf('## ')));
  }
  const appended = posts.find(p => p.slug === 'one-link');
  check('an existing line is extended, not duplicated', relatedLinkCount(appended.content) === 2
    && appended.content.includes(`${link('Other', 'other-post')} · ${link(newPost.title, newPost.slug)}`));
  const created = posts.find(p => p.slug === 'no-line');
  check('a missing line is created at the end of the intro',
    created.content.startsWith(`Intro A.\n\n${MARKER} ${link(newPost.title, newPost.slug)}\n\n## `));
  for (const p of posts.filter(p => !sources.includes(p))) {
    check(`${p.slug}#${p.content.slice(0, 7)}: not touched`, p.content === before.get(p));
  }
  const again = pickBackLinkSources(posts, newPost).map(p => p.slug);
  check('a second run does not pick the posts it already linked', !again.includes('no-line') && !again.includes('one-link'));
}

// ── Edge cases ──
check('a "]" in the title cannot break the link',
  addRelatedLink('Intro.\n\n## Q?', { title: 'Costs [2026] guide', slug: 'x' }).includes('[Costs 2026 guide](/blog/x/)'));
check('a body with no heading gets the line at the end',
  addRelatedLink('Only text.', { title: 'T', slug: 't' }) === `Only text.\n\n${MARKER} [T](/blog/t/)\n`);
check('stripRelatedReading leaves a body without the line as it was',
  stripRelatedReading('A.\n\n## Q?\n\nB.') === 'A.\n\n## Q?\n\nB.');
check(`the line cap is ${MAX_LINKS_PER_LINE}`, MAX_LINKS_PER_LINE === 3);

// ── On the real blog: replay each of the last 10 posts as if it were new ──
{
  const all = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));
  const recent = [...all].sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate)).slice(0, 10);
  let linked = 0;
  for (const target of recent) {
    const posts = structuredClone(all.filter(p => p !== all.find(q => q.slug === target.slug)));
    // Take out any link that already points at the target, so this replays the day it was published.
    for (const p of posts) p.content = String(p.content).replace(new RegExp(`\\s·\\s\\[[^\\]]*\\]\\(/blog/${target.slug}/\\)`, 'g'), '');
    const before = new Map(posts.map(p => [p.slug, p.content]));
    const sources = addBackLinks(posts, target);
    if (sources.length) linked++;
    for (const s of sources) {
      check(`real ${s.slug}: one line, before the first heading, ≤${MAX_LINKS_PER_LINE} links`,
        markerLines(s.content) === 1 && markerBeforeFirstHeading(s.content) && relatedLinkCount(s.content) <= MAX_LINKS_PER_LINE);
      check(`real ${s.slug}: Arlo sees no edit`, stripRelatedReading(s.content) === stripRelatedReading(before.get(s.slug)));
    }
  }
  check(`at least 8 of the last 10 real posts would get a back-link (got ${linked})`, linked >= 8);
  console.log(`Real blog replay: ${linked}/10 recent posts would get back-links.`);
}

// ── Wiring ──
const gen = readFileSync('./scripts/generate-post.js', 'utf8');
const audit = readFileSync('./scripts/daily-audit.js', 'utf8');
const wf = readFileSync('./.github/workflows/blog-autopublish.yml', 'utf8');
check('Nave imports addBackLinks', /import \{ addBackLinks \} from '\.\/lib\/back-links\.js'/.test(gen));
check('Nave adds back-links before the index write',
  gen.indexOf('addBackLinks(posts, postForIndex)') > 0 && gen.indexOf('addBackLinks(posts, postForIndex)') < gen.indexOf('posts.unshift(postForIndex)'));
check('a back-link failure never blocks the publish', /try \{\s*const sources = addBackLinks/.test(gen));
check('a dry run adds no back-links', gen.indexOf("process.env.DRY_RUN === 'true'") < gen.indexOf('addBackLinks(posts, postForIndex)'));
check("Arlo's fingerprint ignores the Related-reading line", /stripRelatedReading\(p\.content\)/.test(audit)
  && /import \{ stripRelatedReading \} from '\.\/lib\/back-links\.js'/.test(audit));
check('the publish workflow commits the index the links are written to', /git add[^\n]*content\/blog\/posts-index\.json/.test(wf));
check('the publish workflow commits the rebuilt pages', /git add[^\n]*\bblog\//.test(wf));

console.log(`verify-back-links: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
