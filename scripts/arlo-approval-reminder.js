// Sends a separate, decision-focused email only when Arlo generated a fresh
// 14-day recommendation set today. Approval buttons lead to a confirmation page
// and then require Dory's authenticated GitHub account. Arlo cannot self-approve.
//
// Reporting rule: keep the improvement engine rich, but make the owner's view
// compact. Evidence, ranking/CTR baseline, expected result and decision state are
// surfaced first; deeper analysis stays in Arlo's machine-readable records.

import { readFileSync, existsSync } from 'fs';
import { Resend } from 'resend';

const FILE = './project/seo/recommendations.json';
const TO = 'dror75p@gmail.com';
const BASE = 'https://www.doryangel.com/arlo-approve.html';
const resend = new Resend(process.env.RESEND_API_KEY);

function today() { return new Date().toISOString().split('T')[0]; }
function esc(s) { return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
function num(v, digits = 0) { return Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—'; }
function pct(v) { return Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(1)}%` : '—'; }

if (!existsSync(FILE)) { console.log('Arlo approval reminder: no recommendations file; nothing to send.'); process.exit(0); }
const report = JSON.parse(readFileSync(FILE, 'utf8'));
const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];
if (report.reportDate !== today()) { console.log(`Arlo approval reminder: latest cycle is ${report.reportDate || 'unknown'}, not today; no email.`); process.exit(0); }
if (!recommendations.length) { console.log('Arlo approval reminder: fresh cycle has no recommendations; no email.'); process.exit(0); }

function baselineLine(r) {
  const b = r.baseline;
  if (!b || typeof b !== 'object') return '';
  const parts = [];
  if (Number.isFinite(Number(b.position))) parts.push(`<strong>Rank ${num(b.position, 1)}</strong>`);
  if (Number.isFinite(Number(b.impressions))) parts.push(`${num(b.impressions)} impressions`);
  if (Number.isFinite(Number(b.clicks))) parts.push(`${num(b.clicks)} clicks`);
  if (Number.isFinite(Number(b.ctr))) parts.push(`CTR ${pct(b.ctr)}`);
  return parts.length ? `<div style="font-size:12px;color:#0F2847;background:#F4F7FA;border-radius:6px;padding:8px 10px;margin:8px 0;">${parts.join(' · ')}</div>` : '';
}

function confidenceLabel(r) {
  const c = Number(r.confidence);
  if (c >= 4) return 'High';
  if (c >= 3) return 'Medium';
  if (c > 0) return 'Low';
  return '—';
}

const rows = recommendations.map((r, i) => {
  const legalRequired = Boolean(r.legal_review_required);
  const legal = legalRequired
    ? '<span style="color:#B91C1C;font-weight:700;">Legal review required — email approval disabled</span>'
    : '<span style="color:#0D7B4E;font-weight:700;">Ready for owner decision</span>';
  const action = legalRequired
    ? '<div style="background:#FFF1F2;border-radius:6px;padding:10px;margin-top:10px;font-size:12px;color:#991B1B;">Complete the existing manual legal-review path before approval.</div>'
    : `<a href="${BASE}?id=${encodeURIComponent(r.id)}" style="display:inline-block;background:#0D7B4E;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:6px;margin-top:10px;">Review &amp; Approve</a>`;
  const priority = esc(r.priority || 'normal');
  const score = Number.isFinite(Number(r.score)) ? ` · score ${num(r.score, 1)}` : '';
  const metric = r.metric ? `<div style="font-size:12px;color:#738196;margin-top:5px;"><strong>Watch:</strong> ${esc(r.metric)} · Confidence: ${confidenceLabel(r)}</div>` : '';

  return `<div style="border:1px solid #D8E0E8;border-left:5px solid ${r.priority === 'high' ? '#0D7B4E' : '#1E5AA8'};border-radius:8px;padding:14px 16px;margin:12px 0;background:#fff;">
    <div style="font-size:11px;color:#738196;font-family:monospace;">${esc(r.id)} · ${priority} priority${score}</div>
    <div style="font-size:15px;font-weight:700;color:#0F2847;margin:5px 0 6px;">${i + 1}. ${esc(r.title)}</div>
    ${baselineLine(r)}
    <div style="font-size:13px;color:#4B596A;margin-bottom:5px;"><strong>Why now:</strong> ${esc(r.why)}</div>
    <div style="font-size:13px;color:#0F2847;margin-bottom:5px;"><strong>Expected:</strong> ${esc(r.expectedResult)}</div>
    ${metric}
    <div style="font-size:12px;margin-top:9px;">${legal}</div>
    ${action}
  </div>`;
}).join('');

const { data, error } = await resend.emails.send({
  from: 'Arlo by DoryAngel <onboarding@resend.dev>', to: TO,
  subject: `⚠️ ACTION REQUIRED — Arlo has ${recommendations.length} improvement decision${recommendations.length === 1 ? '' : 's'}`,
  html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1A2740;">
    <div style="background:#8A3B12;color:#fff;padding:20px 22px;border-radius:8px 8px 0 0;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.08em;">ARLO — CONTINUOUS IMPROVEMENT</div>
      <div style="font-size:20px;font-weight:700;margin-top:5px;">${recommendations.length} opportunities need your decision</div>
      <div style="font-size:12px;opacity:.8;margin-top:5px;">Evidence first · expected result · one clear action</div>
    </div>
    <div style="padding:18px 22px;border:1px solid #D8E0E8;border-top:0;border-radius:0 0 8px 8px;">
      <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:7px;padding:12px 14px;font-size:13px;color:#7C2D12;margin-bottom:16px;"><strong>Nothing is approved automatically.</strong> Arlo keeps the full analysis and experiment history; this email intentionally shows only the evidence needed for your decision.</div>
      <p style="font-size:13px;color:#4B596A;margin-bottom:8px;">Cycle: <strong>${esc(report.reportDate)}</strong> · ${recommendations.length} ranked recommendations · ${report.scoutSearchesUsed ?? 0}/${report.scoutSearchBudget ?? 0} external scout searches</p>
      ${rows}
      <div style="background:#EBF3FD;border:1px solid #8FBCEB;border-radius:7px;padding:12px 14px;margin-top:18px;font-size:12px;color:#1B4F8A;"><strong>Safety boundary:</strong> Arlo cannot activate approvals. Owner approval only unlocks the existing governance checks and PR process. No PR is merged automatically.</div>
    </div>
  </div>`,
});
if (error) { console.error(`Arlo approval reminder failed: ${error.message || JSON.stringify(error)}`); process.exit(1); }
console.log(`Arlo approval reminder sent: ${data?.id || 'ok'} (${recommendations.length} recommendations).`);
