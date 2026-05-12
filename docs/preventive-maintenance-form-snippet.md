# Hardened form snippet — paste into the maintenance-tool repo

> Target file: `dror75p-ops/Doryangel-preventive-maintenance-schedule.automation/index.html`
> Replace the existing `handleSubmit()` function (around lines 2002-2015 on
> branch `main`) with the version below. Also add the honeypot input shown
> in step 1.

## Why

The current handler swallows every error and shows "Calendar Unlocked!"
even when the webhook is dead, the network is down, or Make.com returns
500. This change:

- Distinguishes real success (HTTP 2xx) from failure
- On failure, still unlocks the calendar (it's free anyway) but tells
  the user honestly and offers a one-click `mailto:` fallback so the
  lead reaches `office@doryangel.com` even if Make.com is unreachable
- Adds a hidden honeypot field (`hp_company`) to reduce bot spam, matching
  the pattern already used on the digest form
- Tightens the email regex from `.includes('@')` to a real address check
- Logs failures to `console.warn` so they show up in browser devtools

No new third-party dependency. No backend change. Self-contained.

## Step 1 — Add the honeypot field

Inside the existing `<div id="form-state">` block (just above the
"Get My Free Calendar Now" button), add this hidden input:

```html
<input type="text" id="hp_company" name="company" tabindex="-1"
       autocomplete="off"
       style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;
              opacity:0;overflow:hidden;" value="">
```

## Step 2 — Replace the `handleSubmit` block

Replace lines ~2002-2015 (the existing `function handleSubmit() { ... }`
block) with:

```js
// ── Form submit (hardened) ──
async function handleSubmit() {
  const fname    = document.getElementById('fname').value.trim();
  const femail   = document.getElementById('femail').value.trim();
  const faddress = document.getElementById('faddress').value.trim();

  // Honeypot: real users never fill this. Drop bots silently.
  const hp = document.getElementById('hp_company');
  if (hp && hp.value) { return; }

  if (!fname) { shakeFocus('fname'); return; }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(femail)) { shakeFocus('femail'); return; }

  const btn = document.getElementById('cta-btn');
  btn.disabled = true; btn.textContent = 'Unlocking…';

  const WEBHOOK = 'https://hook.eu1.make.com/tqmgkkgubkr409v3ygd4ohpmxpvx8iw2';
  let pipelineOk = false;
  try {
    const resp = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fname, femail, faddress })
    });
    pipelineOk = resp.ok;
    if (!resp.ok) {
      console.warn('Compliance signup: webhook returned', resp.status);
    }
  } catch (err) {
    console.warn('Compliance signup: network error', err);
    pipelineOk = false;
  }

  // The calendar is free; unlock it either way so the page still rewards
  // the user. Only the messaging changes based on whether the pipeline
  // actually accepted the lead.
  unlockAll();
  if (pipelineOk) {
    showSuccess();
    showToast();
  } else {
    showFallback(fname, femail, faddress);
  }
}

// Called when the webhook is unreachable. Tells the user the truth and
// gives them a single-click escape hatch so DoryAngel never loses a lead.
function showFallback(fname, femail, faddress) {
  const fs = document.getElementById('form-state');
  const ss = document.getElementById('success-state');
  const mailto = buildFallbackMailto(fname, femail, faddress);
  ss.innerHTML =
    '<div style="margin-bottom:12px">' +
      '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
        '<circle cx="24" cy="24" r="24" fill="#FFF4DA"/>' +
        '<path d="M24 14v14M24 32v2" stroke="#D97706" stroke-width="3" ' +
              'stroke-linecap="round"/>' +
      '</svg>' +
    '</div>' +
    '<h3 style="margin:0 0 8px;color:#0D1E3A">Calendar Unlocked Below</h3>' +
    '<p style="margin:0 0 14px;color:#3D5270;font-size:14px;line-height:1.6">' +
      'We saved your spot. If you do not receive your welcome email within ' +
      '5 minutes, tap below and we will add you manually within the hour.' +
    '</p>' +
    '<a href="' + mailto + '" ' +
       'style="display:inline-block;background:#3E8FD4;color:#fff;' +
       'text-decoration:none;padding:11px 22px;border-radius:8px;' +
       'font-weight:700;font-size:14px;">' +
      'Send confirmation email' +
    '</a>';
  fs.style.display = 'none';
  ss.style.display = 'block';
  hideStickyBar();
}

function buildFallbackMailto(fname, femail, faddress) {
  const subject = encodeURIComponent('Compliance Calendar — please add me');
  const body = encodeURIComponent(
    'Hi DoryAngel team,\n\n' +
    'Please add me to the NYC Compliance Calendar.\n\n' +
    'Name: '  + fname  + '\n' +
    'Email: ' + femail + '\n' +
    (faddress ? ('Property: ' + faddress + '\n') : '') +
    '\nThanks!'
  );
  return 'mailto:office@doryangel.com?subject=' + subject + '&body=' + body;
}
```

## How to verify after deploying

1. Open the live page in a normal browser tab.
2. Submit the form with your own email.
3. Within ~1 minute you should receive the welcome HTML email and a
   new row should appear in the Compliance Calendar spreadsheet.
4. Open browser devtools → Network → submit again with the webhook URL
   blocked in devtools. You should now see the **fallback state** with
   the "Send confirmation email" button, NOT the green-check success
   state. Console should show one `console.warn` line.
5. Submit again with a junk email like `aaa` — should be rejected
   client-side by the new regex with a red-shake focus on the email
   field.
