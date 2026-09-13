#!/usr/bin/env node
// Bridges an authenticated GitHub issue created by Dory into the existing
// queue-approved-post.js gate. This is NOT an Arlo/AI approval path.
// It accepts only an `issues: opened` event authored by the repository owner.

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const OWNER = 'dror75p-ops';
const EVENT = process.env.GITHUB_EVENT_PATH;
const fail = (m) => { console.error(`REFUSED: ${m}`); process.exit(2); };

if (process.env.GITHUB_EVENT_NAME !== 'issues') fail('only GitHub issue events may authorize approval');
if (process.env.GITHUB_ACTOR !== OWNER) fail(`actor must be ${OWNER}`);
if (!EVENT) fail('GITHUB_EVENT_PATH is missing');

let payload;
try { payload = JSON.parse(readFileSync(EVENT, 'utf8')); }
catch (e) { fail(`cannot read trusted GitHub event payload: ${e.message}`); }

if (payload.action !== 'opened') fail('only a newly opened issue may authorize approval');
if (payload.issue?.user?.login !== OWNER) fail(`issue author must be ${OWNER}`);

const title = String(payload.issue?.title || '').trim();
const body = String(payload.issue?.body || '').trim();
const m = title.match(/^Arlo approval: (ARLO-\d{4}-\d{2}-\d{2}-\d{2})$/);
if (!m) fail('issue title is not an exact Arlo approval request');
const id = m[1];
if (!body.startsWith(`APPROVE ${id}`)) fail('issue body does not explicitly approve the same recommendation ID');
if (/LEGAL REVIEWED/i.test(body)) fail('email gateway cannot attest legal review; legal recommendations require the manual legal-review path');

console.log(`Authenticated owner approval verified for ${id}. Running existing governance gate.`);

// queue-approved-post.js deliberately refuses generic CI. We clear only those
// two generic CI markers AFTER verifying the immutable GitHub event actor and
// issue author above. The queue script still performs all content governance.
const env = { ...process.env, GITHUB_ACTIONS: 'false', CI: 'false' };
execFileSync(process.execPath, [
  'scripts/queue-approved-post.js', '--id', id, '--approved-by', 'Dory (authenticated GitHub email gateway)'
], { stdio: 'inherit', env });
