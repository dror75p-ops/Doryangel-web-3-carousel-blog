# DoryAngel Blog Post Rules

Single source of truth for `content/blog/posts-index.json` entries. All rules below are validated by traffic data (posts below 500 words get zero traffic; generic AI-sounding pieces lose readers) and SEO constraints.

## The 11 rules

1. **NYC anchor in title.** Title MUST mention "Bronx" (preferred) or another NYC reference such as "NYC", "New York City", "Manhattan", "Queens", "Brooklyn", "Staten Island", "Harlem", "Mott Haven", "Hunts Point", "Fordham", "Highbridge", "Soundview", "Wakefield", "Throgs Neck", or "Edenwald". Bronx is strongly preferred per the audience.

2. **Title format.** Title is EITHER a question (contains `?` anywhere) OR begins with a digit (e.g. "5 Smart Sensors...", "7 Drainage Steps..."). Both forms drive higher click-through than declarative titles per traffic data.

3. **Word count 800–1,200.** Count words in `content` (markdown body). Below 800 = traffic killer. Above 1,200 = drop-off. Below 500 = zero traffic, never publish.

4. **NYC specificity.** Body MUST contain at least one of: a dollar figure (`$\d`), a NYC law / code reference (e.g. "Local Law 11", "HPD", "Housing Maintenance Code", "DOB", "FISP", "Local Law 31", "Local Law 198"), or a specific NYC neighborhood name.

5. **Pain-point excerpt.** `excerpt` is 1–2 sentences and references a concrete pain (money lost, fine, tenant trouble, time wasted). No generic "learn about" framing.

6. **`seoTitle` ≤60 chars AND ends with ` | DoryAngel`.** Exactly one ` | DoryAngel` suffix — never duplicated.

7. **`seoDescription` ≤155 chars.**

8. **`heroImageAlt` non-empty.** Required for a11y/SEO.

9. **Exactly one `featured: true`.** Across all posts in `posts-index.json`, only one entry may have `featured: true`.

10. **`category` is one of 4 enums:** `property-management`, `diy-property-management`, `investments`, `property-automation`.

11. **No CTA inside `content`.** `scripts/build-blog.js` auto-appends the sticky CTA + "Continue reading" block. Body must not include "Book a call", "Schedule a consultation", "Call DoryAngel", or similar.

## Other required fields

- `slug` — kebab-case, unique
- `publishedDate` — ISO `YYYY-MM-DD`
- `minutesToRead` — integer, typically 4–6
- `heroImage` — Unsplash URL
- `hashtags` — array of strings
- `author` — typically `"DoryAngel Team"`

## Source of these rules

`/home/user/Doryangel-web-3-carousel-blog/CLAUDE.md` (sections: "Post schema (current)" and "Content rules").
