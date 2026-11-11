#!/usr/bin/env node
// Sends the owner a short receipt after the Arlo owner-approval workflow runs:
// "approval received" with the PR link, or "approval NOT accepted" with the
// reason. Run by .github/workflows/arlo-owner-approval.yml only.
//
// It is a report, not a control: it reads the approval step's log, sends one
// email, and never touches the repository. A send failure is a warning, never a
// failed run, because the approval itself already happened (or did not).
//
// Env: OUTCOME=success|failure, ISSUE_TITLE, ISSUE_URL, APPROVAL_LOG (path),
//      RESEND_API_KEY.

import { readFileSync, existsSync } from 'fs';
import { buildReceipt, idFromTitle } from './lib/approval-receipt.js';

const TO = 'dror75p@gmail.com';

const outcome = process.env.OUTCOME === 'success' ? 'success' : 'failure';
const logPath = process.env.APPROVAL_LOG || '/tmp/arlo-approval.log';
const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
const { subject, html } = buildReceipt({
  outcome,
  id: idFromTitle(process.env.ISSUE_TITLE),
  issueUrl: process.env.ISSUE_URL,
  log,
});

if (!process.env.RESEND_API_KEY) {
  console.log(`::warning::No RESEND_API_KEY — receipt not sent (${subject}).`);
  process.exit(0);
}

try {
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: 'Arlo by DoryAngel <onboarding@resend.dev>', to: TO, subject, html,
  });
  if (error || !data?.id) {
    console.log(`::warning::Approval receipt not sent: ${error?.message || 'no message id returned'}`);
  } else {
    console.log(`Approval receipt sent (${outcome}): ${data.id}`);
  }
} catch (e) {
  console.log(`::warning::Approval receipt not sent: ${e.message}`);
}
