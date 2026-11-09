# DoryAngel NYC Compliance Check — Operations & Handoff

**Production URL:** https://doryangel-compliance-check.dror75p.chatgpt.site  
**Sites project ID:** `appgprj_6aa1173100d88191a33c26c4a718c794`  
**Current release at handoff:** Version 19 (published 2026-11-09)

This document is the shared source of truth for Codex, Claude, and future developers working on the DoryAngel NYC Compliance Check. It intentionally contains no credentials or API tokens.

## Product purpose

A NYC owner or property professional enters an address. The application resolves the building first, then produces a best-effort public-data report showing open HPD, DOB, DOB NOW, ECB/OATH, FDNY and sanitation-related items, monetary balances, plain-English next steps, and official-source context.

The report is informational, not legal advice or an official agency determination.

## Ownership and source

The compliance application is currently hosted and versioned through ChatGPT Sites, under the Sites project ID above. The main DoryAngel marketing website is maintained in this GitHub repository. Do not assume that editing the marketing repository automatically changes the compliance application.

When Claude or another assistant continues work:
1. Open this file first.
2. Identify the exact Sites project by the opaque project ID above.
3. Retrieve the latest saved/deployed Site version before changing code.
4. Preserve the production audience and URL unless Dori explicitly asks otherwise.
5. Never create a second Site for the same product.

If the assistant cannot access the existing Sites project, it must stop and tell Dori that it needs access to that exact project. Do not rebuild from memory or publish a duplicate.

## Non-negotiable data flow

1. Validate and normalize the NYC address.
2. Resolve building identifiers before searching violations:
   - BBL: PLUTO, with NYC Planning GeoSearch and Building Footprints fallback.
   - BIN: HPD where available; absence of HPD history is not an error.
3. Display resolved address, BIN, BBL and checked time so a bad match is visible.
4. Query agencies by BIN/BBL or the exact fields required by the dataset.
5. Never treat a failed request as clean:
   - Empty successful response = no open records.
   - Timeout/error = “Not checked — please try again.”
6. Deduplicate overlapping ECB/OATH tickets before totals.
7. Keep source names and official links visible.
8. Cache scan responses for no more than 60 minutes.
9. Retry temporary NYC Open Data failures (429/5xx) with bounded backoff.

## Current source groups

- HPD Violations: `wvxf-dwi5`
- DOB Violations (legacy): `3h2n-5cm9`
- DOB NOW: `855j-jady`
- ECB: `6bgk-3dad`
- OATH Hearings: `jz4z-kudi`
- FDNY Active Violation Orders: `bi53-yph3`
- PLUTO address/BBL lookup: `64uk-42ks`
- Building Footprints fallback: `5zhs-2jue`

Dataset schemas and statuses change. Reconfirm official metadata before changing filters.

## Security and privacy rules

- Never place Socrata, email, captcha, storage, or payment secrets in browser code, GitHub files, URLs, logs, or reports.
- Server-side secrets only.
- Keep both visitor-based and IP-based rate limits.
- Validate inputs server-side; never accept arbitrary user SoQL.
- Keep bot honeypot/duplicate-submit protection and captcha readiness.
- Keep production security headers: CSP, frame denial, content-type protection, referrer policy and permissions policy.
- Collect only lead data the user knowingly submits.
- Do not send reports, leads, or messages to third parties without the user’s explicit action.
- Do not automate NYC certification, payment, filing, or legal representation.
- Do not expose real customer addresses or live violations in a public sample report. The homepage sample must remain visibly fictional.

## UX rules

- Simple, reassuring English.
- Group work by trade when useful (plumbing, electrical, extermination, compliance, etc.), but preserve each official violation number and source.
- Show issue date, hearing/due information when available, present status, balance, and uncertainty.
- Contractor links must be real tappable anchors and should use the property location. Do not claim a contractor is “best” without a transparent source and current verification.
- Email/PDF/print/download actions must be tested on mobile.
- All buttons and links must remain keyboard accessible, have visible focus states, and meet readable mobile sizing.
- DoryAngel has operated since 2010.

## Release procedure

1. Pull/retrieve the latest Sites version.
2. Make the smallest scoped change.
3. Run production build and relevant tests.
4. Review for secrets and real customer data.
5. Save a new Sites version from the exact pushed commit.
6. Deploy only the saved version.
7. Test the production URL, not only a local preview.
8. Record the new version number and meaningful changes in this document or a release note.

## Required production smoke tests

Test these as regression fixtures. Counts are time-sensitive and may legitimately change; identity resolution and source behavior must remain correct.

- 2306 Morris Avenue, Bronx — expected BIN `2013882`, BBL `2031720006`.
- 707 East 189 Street, Bronx — expected BIN `2012606`, BBL `2030910097`; ECB may appear under the corner address.
- 2170 Creston Avenue, Bronx — expected BIN `2013756`; confirms legacy DOB lookup.

For every fixture verify:
- Correct resolved address/BIN/BBL.
- A failed agency is labeled unavailable, never clean.
- Money totals equal deduplicated ticket balances.
- Mobile layout has no overlap or clipped controls.
- Vendor, print, PDF, email and DoryAngel CTA links are tappable.
- No secret appears in HTML, client bundles, URLs, or logs.

## Current release notes

Version 19:
- Replaced the public sample with clearly fictional data.
- Added robust BBL normalization and lookup fallbacks.
- Reduced report cache to 60 minutes.
- Added IP-independent rate limiting alongside visitor throttling.
- Added production security headers.
- Added bounded retries for NYC Open Data 429/5xx responses.
- Preserved honest failure states when a city source is unavailable.

## How to ask Codex for help

In a new ChatGPT/Codex conversation, provide:
- This GitHub file URL.
- The production URL.
- The exact Sites project ID.
- The requested change and whether publishing is authorized.

Suggested prompt:

> Continue the DoryAngel NYC Compliance Check using the handoff document in `docs/COMPLIANCE_CHECK_HANDOFF.md`. Retrieve the latest version of Sites project `appgprj_6aa1173100d88191a33c26c4a718c794`, preserve the existing production URL and audience, make the requested scoped change, test the production behavior, and update the release notes. Never expose secrets or publish a duplicate Site.

## Escalation

If Claude finds a data mismatch, broken production action, missing permission, or uncertain legal workflow, it should document the exact address, dataset, request outcome, timestamp, and Site version, then ask Codex to inspect that evidence. Do not guess and do not silently mark an unavailable source as clean.
