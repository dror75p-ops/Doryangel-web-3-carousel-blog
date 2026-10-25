# Monthly status review, 2026-09-11 to 2026-10-08

Source: `project/seo/daily-series.json` (true per-day data, two non-overlapping 28-day windows), `rank-history.json`, `git log`, `content/blog/posts-index.json`. Not available from the sandbox: GA4, lead sheets, Clarity, the live site. Nothing below says anything about leads.

## Search (Search Console, window ends 2026-10-08)

| | Aug 14 - Sep 10 | Sep 11 - Oct 8 | Change |
|---|---|---|---|
| Clicks | 77 | 107 | +39% |
| Impressions | 4,831 | 4,863 | flat |
| Avg position (impression-weighted) | 13.5 | 9.6 | better |
| www host | 40 clicks, pos 15.3 | 47 clicks, pos 10.5 | better |
| apex host (`doryangel.com`) | 43 clicks, pos 6.2 | 60 clicks, pos 5.6 | flat position |
| beta host | 0 clicks | 0 clicks | ~90 impressions, residue |

Weekly (7-day) clicks: 46, 70, 44, 52, 48. There is no clear trend inside the month, so most of the 39% lift is the step between the two windows, not steady growth.

Watch terms (as of the 10-11 snapshot vs 09-12): `bronx property management` 19.1 to 13.2, `property management bronx ny` 10.7 to 5.3, `property management bronx` 4.1 to 2.8. Still absent: `bronx property manager`, `property management company bronx`, `nyc property management` (zero impressions).

## Publishing

15 posts in the month, one every 2 days, no missed run. Arlo's snapshot ran every day. 14 of 15 posts are `diy-property-management` (Maintenance & Repairs). 10 of 15 titles start "Bronx vs. <city>:", 6 of them "Bronx vs. Mount Vernon: Which Landlords Actually".

## Patterns worth knowing

1. **Traffic did not grow with content volume, but this is not proof the posts failed.** 15 new posts, site impressions flat at ~4.8k. Of the 37 top pages pulled, exactly one new post appears (09-21, winter tenant retention: 119 impressions, 1 click, position 9.0). The data only covers top pages, so a post missing from the list is "below the cut", not "zero". Most posts are under four weeks old, which is short for Google. The rise in average position (13.5 to 9.6) cannot be credited to the posts or denied to them: it comes from a site-wide average dominated by the homepage, and the posts, host consolidation and season overlap. Since 2026-10-11 Arlo's snapshot carries a `recentPosts` field (per-post clicks, impressions, position for posts from the last 60 days), so this can be answered per post from the next snapshot on.
2. **The apex host still earns 56% of clicks.** The homepage at `http://doryangel.com/` has 1,444 impressions at position 5.6 and 4.2% CTR, which looks like local-pack. This is the same signature as the 2026-08 notes and why Arlo's blended-position recommendations (PR #308, ARLO-2026-10-11-02) keep being a false premise.
3. **Monday spike.** Mondays average 243 impressions and 33 clicks per Monday window vs 130-185 and 6-19 on other days (4 Mondays, so treat as a hint). Suggests the audience is owners checking on their properties at the start of the week.
4. **Template and category collapse is back.** The 09-27 guard (`sharedTitleOpening`) fixed duplicate slugs, but 10-05 and 10-09 are again "Bronx vs. <city>" titles, and 14/15 posts are one category. The guard fails open after 2 retries, and the forced-maintenance plan (`category-plan.json`, remaining 0) is finished, so the picker is choosing maintenance by itself (fall season). Owner direction on 2026-10-11 prefers night-time building problems anyway; the title opener is the part to fix.
5. **Search interest is concentrated in "property management Bronx" head terms and the homepage.** Commercial-intent queries: 94 queries, 985 impressions, 19 clicks. Everything else: 200 queries, 629 impressions, 4 clicks. Blog posts mostly serve the second group.
6. **Arlo's loop worked but had two defects, both fixed on 2026-10-11:** an unrelated commit marked ARLO-2026-09-13-01 "implemented" while the post was untouched (PR #319), and legal-topic recommendations kept surfacing despite owner preference (PR #320). ARLO-2026-09-13-01 now sits at `queued` until Arlo sees the real change; its measurement window will start then.
7. **Site contract was corrected on 2026-10-11** (pricing, rent flow, addresses, hero). No traffic effect can show yet. Expect homepage conversion, not rankings, to move; GA4 and Make sheets are where to look.

## Open risks

- Live site not verified after the 10-11 deploys (sandbox cannot reach production).
- 21 blog bodies still mention $99 and are unreviewed.
- Issues 321 and 322 (approvals for ARLO-2026-10-11-03 and -04) are waiting for Arlo's approval gateway; not confirmed it accepts issues opened through the session account.
- Nave's first run on the new prompt is the 10-11 auto-publish (~19:00 UTC). Check the post for old pricing claims.
- Governance verifier has one known failing check (`fuzzy match catches a reworded version of a published title`), also failing on main.
- Decision still owed: near-duplicate fall roof/gutter posts (09-03 vs 09-27).
