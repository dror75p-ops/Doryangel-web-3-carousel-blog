# Builds three hero PREVIEW variants from the live index.html. Review only: not deployed
# (project/ is in .vercelignore). H1, rotating slogans, CTAs wording and LCP markup are untouched.
import re,sys
src=open('index.html',encoding='utf-8').read()
CHECK='<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clip-rule="evenodd"/></svg>'
PIN='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'
trust=f'''    <ul class="hero-trust" aria-label="Why owners choose DoryAngel">
      <li>{CHECK}<span>Bronx office meetings by appointment</span></li>
      <li>{CHECK}<span>Rent paid directly to owners</span></li>
      <li>{CHECK}<span>No management fee on vacant units</span></li>
    </ul>
'''
base='''<base href="/">
<style id="hero-variant">
.hero-trust{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:8px;justify-items:center}
.hero-trust li{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--navy)}
.hero-trust svg{color:var(--blue);flex-shrink:0}
@media(min-width:1024px){.hero-trust{justify-items:start}}
'''
A=base+'''
/* A: one dominant CTA on mobile, secondary demoted to a quiet link */
@media(max-width:1023px){
 .hero-actions{flex-direction:column;align-items:stretch;gap:6px}
 .hero-actions .btn-primary{width:100%;justify-content:center;min-height:56px;font-size:17px}
 .hero-actions .btn-secondary{background:transparent;border:0;box-shadow:none;text-decoration:underline;text-underline-offset:4px;min-height:44px;justify-content:center;color:var(--blue)}
}
</style>'''
B=base+'''
/* B: desktop right side becomes a verifiable office card (no photos); mobile gets the trust strip */
.hero-visual .hero-card-stack,.hero-shot-note{display:none}
.hero-office{display:none}
@media(min-width:1024px){
 .hero-office{display:block;width:100%;max-width:420px;background:#fff;border:1px solid var(--grey-mid);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:28px}
 .hero-office-tag{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--blue)}
 .hero-office h2{font-family:'DM Serif Display',serif;font-size:26px;color:var(--navy);margin:8px 0 14px}
 .hero-office .row{display:flex;gap:12px;align-items:flex-start;margin:0 0 12px;color:var(--navy);font-weight:600;line-height:1.4}
 .hero-office .row svg{color:var(--blue);flex-shrink:0;margin-top:2px}
 .hero-office .sub{display:block;font-weight:400;font-size:13px;color:var(--text-muted)}
 .hero-office a.call{display:flex;justify-content:center;align-items:center;min-height:48px;background:var(--blue);color:#fff;font-weight:700;border-radius:10px;text-decoration:none;margin-top:16px}
 .hero-office .hq{margin:14px 0 0;font-size:12px;color:var(--text-muted)}
}
</style>'''
C=base+'''
/* C: real portal screenshot stays; trust points replace the floating card; screenshot also shown on mobile */
.hero-visual .hero-card-bg{display:none}
.hero-trust-card{display:none}
.hero-mshot{display:block;margin:22px auto 0;max-width:420px;border:1px solid var(--grey-mid);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-lg);aspect-ratio:676/470}
.hero-mshot img{display:block;width:100%;height:auto}
@media(min-width:1024px){
 .hero-mshot{display:none}
 .hero-trust{display:none}
 .hero-trust-card{display:grid;box-sizing:border-box;gap:10px;width:100%;margin-top:18px;background:var(--blue-dim);border:1px solid rgba(58,123,221,.2);border-radius:var(--radius);padding:18px 20px;list-style:none}
 .hero-trust-card li{display:flex;gap:8px;align-items:center;font-weight:600;color:var(--navy);font-size:14px}
 .hero-trust-card svg{color:var(--blue);flex-shrink:0}
}
</style>'''
office=f'''    <div class="hero-office">
      <div class="hero-office-tag">Bronx Office Meetings</div>
      <h2>Meet us in person</h2>
      <div class="row">{PIN}<div>440 E 140th St, Bronx, NY 10454<span class="sub">Face-to-face meetings by appointment only</span></div></div>
      <a class="call" href="tel:+15168474999">Call (516) 847-4999 to schedule</a>
      <p class="hq">Headquarters: 557 Grand Concourse #4123, Bronx, NY 10451</p>
    </div>
'''
trustcard='    <ul class="hero-trust-card" aria-label="Why owners choose DoryAngel">'+''.join(f'<li>{CHECK}<span>{t}</span></li>' for t in ['Bronx office meetings by appointment','Rent paid directly to owners','No management fee on vacant units'])+'</ul>\n'
mshot='''    <div class="hero-mshot"><picture><source srcset="./assets/portal-live-dashboard.webp" type="image/webp"><img src="./assets/portal-live-dashboard.jpg" width="676" height="592" alt="DoryAngel owner portal dashboard (sample data)" loading="lazy"></picture></div>
'''
def build(name,style,fn):
    s=src
    assert s.count('\n<body>')==1
    s=s.replace('\n<body>','\n'+style+'\n<body>',1)
    s=fn(s)
    open(f'project/preview-hero/hero-{name}.html','w',encoding='utf-8').write(s)
def after_actions(s,markup):
    m=re.search(r'(<div class="hero-actions">.*?</div>\n)',s,re.S); assert m
    return s.replace(m.group(1),m.group(1)+markup,1)
build('a',A,lambda s:after_actions(s,trust))
def fb(s):
    s=after_actions(s,trust.replace('class="hero-trust"','class="hero-trust" id="b-trust"'))
    s=s.replace('<div class="hero-card-stack">',office+'<div class="hero-card-stack">',1)
    return s
build('b',B+'<style>@media(min-width:1024px){#b-trust{display:none}}</style>',fb)
def fc(s):
    s=after_actions(s,trust+mshot)
    s=s.replace('<div class="hero-shot-note">',trustcard+'<div class="hero-shot-note">',1)
    return s
build('c',C,fc)
print('built')
