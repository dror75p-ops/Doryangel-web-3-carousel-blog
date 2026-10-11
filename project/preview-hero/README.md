# Hero options (preview only, not deployed: `project/` is in .vercelignore)

Unchanged in all three: H1, the rotating slogans and underline, the Free Rental Analysis CTA, the rating badge, the stats row, the LCP markup. Regenerate with `python3 project/preview-hero/build.py` (reads the live `index.html`). View at `/project/preview-hero/hero-{a,b,c}.html` on a local server.

| | Mobile | Desktop (>=1024px) |
|---|---|---|
| **A: Focus** | Primary CTA full width and larger; the meeting CTA becomes a quiet underlined link; 3-point trust strip under it | Unchanged layout + trust strip under the CTAs |
| **B: Office card** | Trust strip | Right side: a vector "Meet us in person" card (440 E 140th St, by appointment, tap-to-call, HQ line). No photos, no map |
| **C: Proof panel** | Real owner-portal screenshot appears under the CTAs (loaded lazily) + trust strip | Real portal screenshot stays; the floating "Rent paid directly" card is replaced by a 3-point trust panel |

No invented photos of staff or the office anywhere. Measured: no horizontal overflow at 320/390/1280, H1 height identical to the live page.
C adds an image on mobile (lazy, ~26KB); verify LCP before choosing it.
