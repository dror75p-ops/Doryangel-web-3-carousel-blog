# Issue #313 — Batch 1 preview (contract accuracy). NOT approved for production.

Screenshots (`before-*` = main at 79b4426, others = this branch), 390 and 1280 px.
Headless Chromium, third-party hosts blocked, so fonts and the Retell/UserWay overlays are not rendered.

## Changed
| Area | Before | After |
|---|---|---|
| Pricing cards | Starter $99 "single-unit owners", Professional $199, Portfolio custom | 1-9 units: request a quote. 10+ units: $99 per occupied unit/mo, one agreement |
| Terms line + FAQ | none | occupied-only billing, $100 renewal, brokerage/vendor costs disclosed; 6 native `<details>` Q&As |
| Rent | "Online rent collection", "owner disbursements" (page, FAQ, JSON-LD) | "Your Rent Goes Directly to You" band; tenants pay owners, Owner Statement |
| Office | "Headquarters: 557 Grand Concourse" | Bronx Office Meetings, 440 E 140th St, tap-to-call, by appointment; 557 labelled mailing |
| Hero | "See Pricing Plans" | "Schedule a Bronx Office Meeting" (tel:). H1, Free Rental Analysis CTA, LCP markup untouched |
| Hero card | "98% rent collection rate" | "Rent paid directly to owners / Monthly Owner Statement" |
| Calculator | `units*99` for 1-10 units | slider 1-50; <10 units needs the visitor's own quoted rate, no savings shown until entered; renewal fee and occupancy caveats |
| Schema | RealEstateAgent, $99 from, $99-$199 range | ProfessionalService, 10+ unit eligibility, no $199 |
| Blog | 92 pages: "flat $99/unit/month, no hidden fees" CTA | generator CTA corrected, pages rebuilt; Nave prompt carries the same facts |
| Claims | "Licensed & Insured", "Licensed Property Manager", $2-8k savings, 15-30% purchasing, $0 setup, no contracts | "Insured" only; unsubstantiated numbers removed |

## Guard
`npm run verify:site-facts` fails on the old claims (118 failures on main, 0 here).

## BLOCKED — owner / legal decisions, nothing guessed
1. Still unsubstantiated and left as-is: "158+ Units Managed" (about section), "100+ properties managed" (hero and trust rotator), 5.0/21 reviews counts.
2. "No setup fees / no contracts" removed where found; confirm what agreement v1.4 says before re-adding.
3. 440 E 140th is NOT in JSON-LD `address` until Google Business Profile matches (NAP consistency).
4. 21 blog post bodies still mention $99; need review. Posts are not edited here.
5. Outside this repo: Retell agent prompt (Hailey), Make email templates, GBP, and the Owner Portal micro-site may repeat the old claims.
6. Online-enrollment teaser is Batch 2 (not built). Promo applies to website sign-ups of any size per owner; the regular post-6-month price must be shown or referenced.
