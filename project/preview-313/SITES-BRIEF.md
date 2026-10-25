# ChatGPT Sites brief (concept references only)

Goal: explore alternative visuals for selected sections without rebuilding the site. Sites output is a **reference**, never pasted in as-is.

## Replaceable blocks (self-contained, copy comes from the facts in CLAUDE.md)
| Block | Where | Notes |
|---|---|---|
| Hero | `.hero` in `index.html` | Keep H1 text, rotating third line, the Free Rental Analysis CTA, tel: meeting CTA, rating badge. LCP element must stay text, no `.reveal` on the H1, slogans one line at 320px, sticky call button at `bottom:111px`. |
| Pricing | `#pricing` | Two cards (1-9 quote, 10+ $99 per occupied unit), terms line, details FAQ. The 10+ threshold must sit on the same line as $99. |
| Direct-rent band | `.rent-direct` | Text must say rent goes directly to the owner and that DoryAngel does not hold funds. |
| Office / contact panel | `.contact-detail` rows | Headquarters (557) and Bronx Office Meetings (440, by appointment) stay two matching rows. |
| Enrollment preview | `#enroll-preview` | Must read "Coming soon. No payment or agreement is processed here yet." Differentiated from pricing cards. No countdown, no scarcity. |

## Not replaceable
Forms, Turnstile, consent checkboxes, Web3Forms/Make wiring, JSON-LD, the calculator logic, the generated blog.

## Acceptance rules for any design
- Static HTML/CSS only; no external scripts, trackers, fonts beyond the existing Google Fonts, or heavy images.
- No stock photos presented as DoryAngel's office or team. Use owned or licensed images only.
- Navy/blue palette and DM Serif Display / DM Sans stay.
- Checks at 320 / 390 / 768 / 1280: no horizontal scroll, 44px tap targets, visible focus, AA contrast.
- Run `npm run verify:site-facts` after any change; it must stay green.
- UserWay and Retell overlays must not collide with the new layout.
