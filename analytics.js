/*
 * DoryAngel shared analytics + cookie-consent loader.
 * Self-contained: injects the consent banner, then loads GA4 (G-0W61NYHM78)
 * and Microsoft Clarity only after the visitor accepts.
 *
 * Uses the same localStorage key as index.html ('doryangel-cookie-consent'),
 * so a decision made on any page carries across the whole site.
 *
 * The homepage (index.html) has its own inline copy of this logic; this file
 * covers every other page (blog posts, tax-checklist, flat-fee calculator).
 * Do not include this on index.html — it would double the banner.
 */
(function () {
  var GA_ID = 'G-0W61NYHM78';
  var CLARITY_ID = 'x7y1bk4fhc';
  var STORAGE_KEY = 'doryangel-cookie-consent';

  function loadGA() {
    if (window.__gaLoaded) return;
    window.__gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
  }

  function grantConsent() {
    window.gtag('consent', 'update', {
      ad_storage: 'granted', ad_user_data: 'granted',
      ad_personalization: 'granted', analytics_storage: 'granted'
    });
  }

  function loadClarity() {
    if (window.__clarityLoaded) return;
    window.__clarityLoaded = true;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }

  function injectBannerStyles() {
    if (document.getElementById('da-cookie-style')) return;
    var css =
      '#cookie-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:9998;' +
      'background:#0D1E3A;color:#fff;border-radius:12px;padding:18px 22px;' +
      'box-shadow:0 10px 40px rgba(13,30,58,0.25);display:none;align-items:center;' +
      'gap:16px;flex-wrap:wrap;font-family:\'DM Sans\',sans-serif;max-width:720px;' +
      'margin:0 auto;transform:translateY(20px);opacity:0;' +
      'transition:transform .4s cubic-bezier(.16,1,.3,1),opacity .4s;}' +
      '#cookie-banner.visible{display:flex;transform:translateY(0);opacity:1;}' +
      '#cookie-banner-text{flex:1;min-width:200px;font-size:13px;line-height:1.55;' +
      'color:rgba(255,255,255,0.85);}' +
      '#cookie-banner-text strong{color:#fff;font-weight:600;}' +
      '#cookie-banner-actions{display:flex;gap:10px;flex-shrink:0;}' +
      '.cookie-btn{font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;' +
      'padding:10px 18px;border-radius:8px;cursor:pointer;border:none;' +
      'transition:background .2s,transform .1s;min-height:40px;}' +
      '.cookie-btn-accept{background:#3A7BDD;color:#fff;}' +
      '.cookie-btn-accept:hover{background:#5B9FEA;transform:translateY(-1px);}' +
      '.cookie-btn-reject{background:transparent;color:rgba(255,255,255,0.85);' +
      'border:1px solid rgba(255,255,255,0.25);}' +
      '.cookie-btn-reject:hover{background:rgba(255,255,255,0.08);color:#fff;}' +
      '@media(max-width:600px){#cookie-banner{padding:14px 16px;gap:10px;}' +
      '#cookie-banner-text{font-size:12px;}' +
      '.cookie-btn{font-size:12px;padding:9px 14px;flex:1;}}';
    var style = document.createElement('style');
    style.id = 'da-cookie-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectBanner() {
    if (document.getElementById('cookie-banner')) return;
    injectBannerStyles();
    var banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<div id="cookie-banner-text"><strong>We value your privacy.</strong> ' +
      'We use cookies to understand how visitors interact with our site so we can ' +
      'improve it. No personal data is sold or shared.</div>' +
      '<div id="cookie-banner-actions">' +
      '<button class="cookie-btn cookie-btn-reject" id="cookie-reject">Reject</button>' +
      '<button class="cookie-btn cookie-btn-accept" id="cookie-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(banner);
    return banner;
  }

  function init() {
    var consent = null;
    try { consent = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var startGranted = consent === 'accepted';

    // Consent Mode v2 (advanced): GA loads on every page but defaults storage to
    // "denied" — no cookies, only cookieless pings — so undecided visitors (the
    // majority) are still measured GDPR-safely. Clarity stays gated behind Accept.
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
      analytics_storage: startGranted ? 'granted' : 'denied'
    });
    loadGA();

    if (consent === 'accepted') {
      loadClarity();
      return;
    }
    if (consent === 'rejected') {
      window.gtag('consent', 'update', { analytics_storage: 'denied' });
      return;
    }

    var banner = injectBanner();
    if (!banner) return;
    setTimeout(function () { banner.classList.add('visible'); }, 1200);

    document.getElementById('cookie-accept').onclick = function () {
      try { localStorage.setItem(STORAGE_KEY, 'accepted'); } catch (e) {}
      banner.classList.remove('visible');
      grantConsent();
      loadClarity();
    };
    document.getElementById('cookie-reject').onclick = function () {
      try { localStorage.setItem(STORAGE_KEY, 'rejected'); } catch (e) {}
      banner.classList.remove('visible');
      window.gtag('consent', 'update', { analytics_storage: 'denied' });
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
