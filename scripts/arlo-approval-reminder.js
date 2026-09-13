// Sends a separate, decision-focused email only when Arlo generated a fresh
// 14-day recommendation set today. It never approves, queues, writes content,
// or calls queue-approved-post.js. The human approval boundary stays intact.

import { readFileSync, existsSync } from 'fs';
import { Resend } from 'resend';

const FILE = './project/seo/recommendations.json';
const TO = 'dror75p@gmail.com';
const resend = new Resend(process.env.RESEND_API_KEY);

function today() { return new Date().toISOString().split('T')[0]; }
function esc(s) {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

if (!existsSync(FILE)) {
  console.log('Arlo approval reminder: no recommendations file; nothing to send.');
  process.exit(0);
}

const report = JSON.parse(readFileSync(FILE, 'utf8'));
const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];

// Daily workflow runs every morning, but this message belongs only to a fresh
// 14-day cycle. Old recommendations must not generate a daily nag email.
if (report.reportDate !== today()) {
  console.log(`Arlo approval reminder: latest cycle is ${report.reportDate || 'unknown'}, not today; no email.`);
  process.exit(0);
}

if (!recommendations.length) {
  console.log('Arlo approval reminder: fresh cycle has no recommendations; no email.');
  process.exit(0);
}

const rows = recommendations.map((r, i) => {
  const legal = r.legal_review_required
    ? '<span style="color:#B91C1C;font-weight:700;">LEGAL REVIEW REQUIRED</span>'
    : '<span style="color:#0D7B4E;font-weight:700;">No legal review flagged</span>';
  return `
  <div style="border:1px solid #D8E0E8;border-left:5px solid ${r.priority === 'high' ? '#0D7B4E' : '#1E5AA8'};border-radius:8px;padding:14px 16px;margin:12px 0;background:#fff;">
    <div style="font-size:11px;color:#738196;font-family:monospace;">${esc(r.id)} · ${esc(r.priority || 'normal')} priority</div>
    <div style="font-size:15px;font-weight:700;color:#0F2847;margin:5px 0 8px;">${i + 1}. ${esc(r.title)}</div>
    <div style="font-size:13px;color:#4B596A;margin-bottom:5px;"><strong>Why:</strong> ${esc(r.why)}</div>
    <div style="font-size:13px;color:#4B596A;margin-bottom:5px;"><strong>Expected:</strong> ${esc(r.expectedResult)}</div>
    <div style="font-size:12px;margin-top:8px;">${legal}</div>
    <div style="background:#F4F7FA;border-radius:5px;padding:9px 10px;margin-top:10px;font-size:12px;color:#0F2847;">
      To approve, tell Claude/ChatGPT: <strong>Approve ${esc(r.id)}</strong>
    </div>
  </div>`;
}).join('');

const { data, error } = await resend.emails.send({
  from: 'Arlo by DoryAngel <onboarding@resend.dev>',
  to: TO,
  subject: `⚠️ ACTION REQUIRED — Arlo has ${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'} waiting for Dory`,
  html: `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1A2740;">
    <div style="background:#8A3B12;color:#fff;padding:20px 22px;border-radius:8px 8px 0 0;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.08em;">ACTION REQUIRED — DORY DECISION</div>
      <div style="font-size:20px;font-weight:700;margin-top:5px;">Arlo found ${recommendations.length} website improvement opportunities</div>
    </div>
    <div style="padding:18px 22px;border:1px solid #D8E0E8;border-top:0;border-radius:0 0 8px 8px;">
      <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:7px;padding:12px 14px;font-size:13px;color:#7C2D12;margin-bottom:16px;">
        <strong>Nothing will be implemented automatically.</strong> Review the recommendations below and decide APPROVE, HOLD, or REJECT. You do not need to run a Node command yourself.
      </div>
      <p style="font-size:13px;color:#4B596A;">Cycle date: <strong>${esc(report.reportDate)}</strong>. Reply in your normal Claude/ChatGPT conversation with the recommendation ID and your decision.</p>
      ${rows}
      <div style="background:#EBF3FD;border:1px solid #8FBCEB;border-radius:7px;padding:12px 14px;margin-top:18px;font-size:12px;color:#1B4F8A;">
        <strong>Safety boundary:</strong> this email contains no approval button, webhook, or automatic publishing action. Approval remains a separate explicit human action. Approved work is still validated and goes through the existing PR process.
      </div>
    </div>
  </div>`,
});

if (error) {
  console.error(`Arlo approval reminder failed: ${error.message || JSON.stringify(error)}`);
  process.exit(1);
}
console.log(`Arlo approval reminder sent: ${data?.id || 'ok'} (${recommendations.length} recommendations).`);
