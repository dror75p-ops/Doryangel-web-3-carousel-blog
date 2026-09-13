// Sends a separate, decision-focused email only when Arlo generated a fresh
// 14-day recommendation set today. Approval buttons lead to a confirmation page
// and then require Dory's authenticated GitHub account. Arlo cannot self-approve.

import { readFileSync, existsSync } from 'fs';
import { Resend } from 'resend';

const FILE = './project/seo/recommendations.json';
const TO = 'dror75p@gmail.com';
const BASE = 'https://www.doryangel.com/arlo-approve.html';
const resend = new Resend(process.env.RESEND_API_KEY);

function today() { return new Date().toISOString().split('T')[0]; }
function esc(s) { return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

if (!existsSync(FILE)) { console.log('Arlo approval reminder: no recommendations file; nothing to send.'); process.exit(0); }
const report = JSON.parse(readFileSync(FILE, 'utf8'));
const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];
if (report.reportDate !== today()) { console.log(`Arlo approval reminder: latest cycle is ${report.reportDate || 'unknown'}, not today; no email.`); process.exit(0); }
if (!recommendations.length) { console.log('Arlo approval reminder: fresh cycle has no recommendations; no email.'); process.exit(0); }

const rows = recommendations.map((r, i) => {
  const legalRequired = Boolean(r.legal_review_required);
  const legal = legalRequired
    ? '<span style="color:#B91C1C;font-weight:700;">LEGAL REVIEW REQUIRED — email approval disabled</span>'
    : '<span style="color:#0D7B4E;font-weight:700;">Eligible for owner email approval</span>';
  const action = legalRequired
    ? '<div style="background:#FFF1F2;border-radius:6px;padding:10px;margin-top:10px;font-size:12px;color:#991B1B;">This recommendation cannot be approved from email. Complete the existing manual legal-review path first.</div>'
    : `<a href="${BASE}?id=${encodeURIComponent(r.id)}" style="display:inline-block;background:#0D7B4E;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:6px;margin-top:10px;">Review &amp; Approve ${esc(r.id)}</a>`;
  return `<div style="border:1px solid #D8E0E8;border-left:5px solid ${r.priority === 'high' ? '#0D7B4E' : '#1E5AA8'};border-radius:8px;padding:14px 16px;margin:12px 0;background:#fff;"><div style="font-size:11px;color:#738196;font-family:monospace;">${esc(r.id)} · ${esc(r.priority || 'normal')} priority</div><div style="font-size:15px;font-weight:700;color:#0F2847;margin:5px 0 8px;">${i + 1}. ${esc(r.title)}</div><div style="font-size:13px;color:#4B596A;margin-bottom:5px;"><strong>Why:</strong> ${esc(r.why)}</div><div style="font-size:13px;color:#4B596A;margin-bottom:5px;"><strong>Expected:</strong> ${esc(r.expectedResult)}</div><div style="font-size:12px;margin-top:8px;">${legal}</div>${action}</div>`;
}).join('');

const { data, error } = await resend.emails.send({
  from: 'Arlo by DoryAngel <onboarding@resend.dev>', to: TO,
  subject: `⚠️ ACTION REQUIRED — Arlo has ${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'} waiting for Dory`,
  html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1A2740;"><div style="background:#8A3B12;color:#fff;padding:20px 22px;border-radius:8px 8px 0 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;">ACTION REQUIRED — DORY DECISION</div><div style="font-size:20px;font-weight:700;margin-top:5px;">Arlo found ${recommendations.length} website improvement opportunities</div></div><div style="padding:18px 22px;border:1px solid #D8E0E8;border-top:0;border-radius:0 0 8px 8px;"><div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:7px;padding:12px 14px;font-size:13px;color:#7C2D12;margin-bottom:16px;"><strong>Nothing is approved automatically.</strong> For eligible recommendations, the button opens a confirmation page and then GitHub. You must be signed in as DoryAngel's authorized owner and explicitly submit the approval.</div><p style="font-size:13px;color:#4B596A;">Cycle date: <strong>${esc(report.reportDate)}</strong>.</p>${rows}<div style="background:#EBF3FD;border:1px solid #8FBCEB;border-radius:7px;padding:12px 14px;margin-top:18px;font-size:12px;color:#1B4F8A;"><strong>Safety boundary:</strong> Arlo cannot activate these approvals. The authenticated owner action only unlocks the existing governance checks and PR process. No PR is merged automatically.</div></div></div>`,
});
if (error) { console.error(`Arlo approval reminder failed: ${error.message || JSON.stringify(error)}`); process.exit(1); }
console.log(`Arlo approval reminder sent: ${data?.id || 'ok'} (${recommendations.length} recommendations).`);
