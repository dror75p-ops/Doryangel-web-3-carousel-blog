// scripts/lib/approval-receipt.js
//
// Builds the short "approval received" / "approval NOT accepted" email that the
// owner-approval workflow sends after it runs. Pure, so it is tested offline by
// scripts/lib/__verify__/verify-report-hygiene.js.
//
// ⚠️ WHY THIS EXISTS. Measured in the 2026-11 Arlo study: approving took four
// steps (email button, confirmation page, GitHub form, the green Create button),
// and nothing told the owner it had worked. A click that stopped at the GitHub
// form looked exactly like an approval. Now every attempt that reaches the
// workflow ends in an email, and the rule the owner is told is simple: no
// "approval received" email means nothing was approved.
//
// ⚠️ The receipt is a REPORT, never a control. It carries no approve link, no
// reply-to-approve and no button; the only links are the issue the owner opened
// and, on success, the pull request (which still needs a manual merge).

const ID_RE = /\bARLO-\d{4}-\d{2}-\d{2}-\d{2}\b/;

function esc(s) {
  return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

/** Pulls the outcome out of the approval step's combined stdout+stderr. */
export function parseApprovalLog(log) {
  const text = String(log || '');
  const pr = text.match(/Pull request opened \(NOT merged\):\s*(https:\/\/github\.com\/[^\s]+)/);
  const branchOnly = text.match(/Branch pushed\. Open the PR here:\s*(https:\/\/github\.com\/[^\s]+)/);
  const refusals = [...text.matchAll(/REFUSED:\s*([^\n]+)/g)].map(m => m[1].trim()).filter(Boolean);
  return {
    prUrl: pr ? pr[1] : null,
    compareUrl: !pr && branchOnly ? branchOnly[1] : null,
    refusal: refusals.length ? refusals[refusals.length - 1].slice(0, 300) : null,
  };
}

/** The recommendation ID from the issue title ("Arlo approval: ARLO-…"). */
export function idFromTitle(title) {
  const m = String(title || '').match(ID_RE);
  return m ? m[0] : null;
}

/**
 * @param outcome 'success' | 'failure'
 * @returns { subject, html }
 */
export function buildReceipt({ outcome, id, issueUrl, log }) {
  const { prUrl, compareUrl, refusal } = parseApprovalLog(log);
  const rid = id || 'the recommendation';
  const ok = outcome === 'success';
  const link = (href, label) => `<a href="${esc(href)}" style="color:#1E5AA8;">${esc(label)}</a>`;

  const subject = ok
    ? `✅ Arlo: approval received for ${rid}`
    : `❌ Arlo: approval NOT accepted for ${rid}`;

  const body = ok
    ? `<p style="margin:0 0 10px;">Your approval of <strong>${esc(rid)}</strong> was received and passed the checks.</p>
       <p style="margin:0 0 10px;">${prUrl
         ? `A pull request is open: ${link(prUrl, prUrl)}. Nothing changes on the site until you merge it.`
         : compareUrl
           ? `The change was prepared on a branch, but the pull request could not be opened automatically. Open it here: ${link(compareUrl, compareUrl)}.`
           : 'The change was prepared. Nothing changes on the site until its pull request is merged.'}</p>`
    : `<p style="margin:0 0 10px;">Your approval of <strong>${esc(rid)}</strong> was <strong>not</strong> accepted, so nothing was queued.</p>
       <p style="margin:0 0 10px;">Reason: ${esc(refusal || 'the approval step failed before giving a reason; see the issue for the run log.')}</p>
       <p style="margin:0 0 10px;">Ask Claude to look at it. Do not approve again from the email until the reason is fixed.</p>`;

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A2740;font-size:14px;line-height:1.5;">
    <div style="background:${ok ? '#0D7B4E' : '#B91C1C'};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700;">${ok ? 'Approval received' : 'Approval not accepted'}</div>
    <div style="padding:16px 18px;border:1px solid #D8E0E8;border-top:0;border-radius:0 0 8px 8px;">
      ${body}
      ${issueUrl ? `<p style="margin:0;font-size:12px;color:#738196;">Your approval request: ${link(issueUrl, issueUrl)}</p>` : ''}
    </div>
  </div>`;

  return { subject, html };
}
