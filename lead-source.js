/*
 * DoryAngel lead-source tagging.
 * Remembers which channel a visitor first came from, and stamps it on every
 * Web3Forms lead form as hidden fields, so the lead email says where the owner
 * found us. No cookies, no third parties: one localStorage key, 90 days.
 *
 * Channel, in order of trust:
 *   1. ?src= (or ?utm_source=) on the landing URL — e.g. Vera's Facebook links
 *      carry ?src=facebook. Use the same tag on any new channel (gbp, referral…).
 *   2. The referring site (google, bing, facebook, chatgpt…).
 *   3. "direct" when there is neither.
 * A tagged or referred visit replaces an earlier "direct"; otherwise the first
 * touch is kept, so a Facebook visitor who browses to the homepage and submits
 * there is still counted as Facebook.
 *
 * Fields added to the form (all show in the Web3Forms email):
 *   lead_channel       facebook / google / direct / …
 *   lead_landing_page  the first page they saw on the site
 *   lead_form_page     the page the form was sent from
 *
 * Loaded directly by index.html and broker-partner.html, and injected by
 * analytics.js on every other page (blog posts included), so blog visits are
 * remembered without regenerating the blog pages.
 */
(function () {
  if (window.__daLeadSourceLoaded) return;
  window.__daLeadSourceLoaded = true;

  var KEY = 'doryangel-lead-source';
  var MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

  function bare(host) { return String(host || '').toLowerCase().replace(/^www\./, ''); }

  function classify(host) {
    host = bare(host);
    if (/(^|\.)google\./.test(host)) return 'google';
    if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host)) return 'facebook';
    if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
    if (/(^|\.)bing\.com$/.test(host)) return 'bing';
    if (/(^|\.)yahoo\.com$/.test(host)) return 'yahoo';
    if (/(^|\.)duckduckgo\.com$/.test(host)) return 'duckduckgo';
    if (/(^|\.)(chatgpt\.com|openai\.com)$/.test(host)) return 'chatgpt';
    if (/(^|\.)perplexity\.ai$/.test(host)) return 'perplexity';
    if (/(^|\.)(linkedin\.com|lnkd\.in)$/.test(host)) return 'linkedin';
    if (/(^|\.)yelp\.com$/.test(host)) return 'yelp';
    return host.slice(0, 60);
  }

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
  }

  // What this page view says about the visitor's source, or null for an
  // internal click (which says nothing new).
  function thisVisit() {
    var tag = '';
    try {
      var p = new URLSearchParams(location.search);
      tag = (p.get('src') || p.get('utm_source') || '').trim().toLowerCase();
    } catch (e) {}
    if (tag) return { channel: tag.replace(/[^a-z0-9_.-]/g, '').slice(0, 40) || 'tagged', tagged: true };

    var refHost = '';
    try { refHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    if (refHost && bare(refHost) === bare(location.hostname)) return null;
    if (refHost) return { channel: classify(refHost), tagged: false };
    return { channel: 'direct', tagged: false };
  }

  var now = Date.now();
  var stored = read();
  if (stored && (!stored.t || now - stored.t > MAX_AGE_MS)) stored = null;

  var visit = thisVisit();
  if (visit && (!stored || visit.tagged || (stored.channel === 'direct' && visit.channel !== 'direct'))) {
    stored = { channel: visit.channel, landing: location.pathname, t: now };
    write(stored);
  }

  function current() {
    var s = stored || { channel: (visit && visit.channel) || 'direct', landing: location.pathname };
    return { lead_channel: s.channel, lead_landing_page: s.landing, lead_form_page: location.pathname };
  }
  // For forms that build their own JSON body instead of using FormData.
  window.daLeadSource = current;

  function stamp(form) {
    if (!form || !form.querySelector || !form.querySelector('input[name="access_key"]')) return;
    var vals = current();
    Object.keys(vals).forEach(function (name) {
      var el = form.querySelector('input[name="' + name + '"]');
      if (!el) {
        el = document.createElement('input');
        el.type = 'hidden';
        el.name = name;
        form.appendChild(el);
      }
      el.value = vals[name];
    });
  }

  function stampAll() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) stamp(forms[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stampAll);
  else stampAll();
  // Capture phase runs before each form's own submit handler builds its FormData.
  document.addEventListener('submit', function (e) { stamp(e.target); }, true);
})();
