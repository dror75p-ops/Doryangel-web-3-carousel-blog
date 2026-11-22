# DA-WEB-AI-DISCOVERY-001 — AI Search Readiness (2026-11-15)

Status: DRAFT / no production deployment.

## Verified in repository
- robots.txt permits all user agents and advertises https://www.doryangel.com/sitemap.xml. OAI-SearchBot is not explicitly blocked here.
- sitemap.xml exists and includes homepage, blog, FAQ and service/tool pages.
- index.html includes canonical, index/follow, LocalBusiness and Service JSON-LD.
- **P0 inconsistency:** index.html JSON-LD and og/twitter descriptions say "$99 for first 6 months then $125" and "$150 for smaller properties". Current public homepage says $99/occupied unit/month for 10+ units (no automatic 6-month increase); 1–9 units quote on request. Separate *coming soon* online enrollment preview proposes $99 for 6 months, then $150 only with written agreement.
- Structured data describes headquarters street as "557 Grand Concourse" without #4123 while visible homepage says "557 Grand Concourse #4123".
- Avoid representing the upcoming online preview as an active standard offer.
- Existing site says DoryAngel is **not** a licensed brokerage; do not change schema to RealEstateAgent without licensing review.

## Implementation sequence
1. Align all homepage metadata, JSON-LD Service, LocalBusiness description, and Offer price descriptions with current approved on-page terms; do not change visible prices. Correct suite only after verifying official business address.
2. Validate JSON-LD syntax and consistency with rendered text. Avoid unsupported review rich-result promises.
3. Confirm public HTTP 200 responses and crawl access for https://www.doryangel.com/robots.txt and /sitemap.xml, including OAI-SearchBot and Bingbot; check WAF/CDN rules and logs. GitHub files alone do not establish production behavior.
4. Verify Search Console and Bing Webmaster Tools site ownership and sitemap submission. No credentials in code.
5. Add attribution for chatgpt.com referral and form conversions in existing analytics; avoid double counting.
6. Publish only after owner approval, then test production HTTP status, structured data, sitemap URLs and lead form.

## Acceptance
- No pricing mismatch between rendered site, OpenGraph/Twitter metadata and JSON-LD.
- No new claims without verification.
- Search crawlers allowed at edge; indexed status checked in search consoles.
- Evidence logged for production deployment and one live lead test.
