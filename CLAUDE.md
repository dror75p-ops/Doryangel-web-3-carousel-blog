# DoryAngel Website — Project Memory

## Latest version
**Dori Angel Web.3 — Carousel Blog**

- GitHub repo: https://github.com/dror75p-ops/Doryangel-web-3-carousel-blog
- Live URL: https://dror75p-ops.github.io/Doryangel-web-3-carousel-blog/
- Owner GitHub account: dror75p-ops

## What's in this repo
- `index.html` — Full DoryAngel Property Management NYC website (self-contained, all CSS inline)
- `blog-loader.js` — Editorial/Newspaper blog layout (Option D): category filter tabs, featured article, numbered list, article overlay reader
- `content/blog/posts-index.json` — 5 blog posts (Compliance, Investment, Tenant Relations, Property Management)

## Design system
- Fonts: DM Serif Display (headings) + DM Sans (body) via Google Fonts
- Colors: Navy `#0D1E3A`, Blue `#3A7BDD`, Blue-light `#5B9FEA`, Blue-dim `#EBF3FD`
- Markdown parser: marked.js (CDN)

## Blog setup
- Posts live in `content/blog/posts-index.json`
- New post every 3 days
- To add a post: append a new object to the JSON array with fields: `slug`, `title`, `date`, `category`, `author`, `excerpt`, `image`, `content` (markdown)
- Categories so far: Compliance, Investment, Tenant Relations, Property Management

## Key design decisions
- Blog section uses Option D (Editorial/Newspaper layout) — chosen by user from 4 options
- Property Owners audience card links to `#pricing` (not `#contact`)
- Blog posts render in a full-screen overlay with a "Back to Website" button

## Previous versions
- Doeryangelweb.2 — design prototype (in `project/` folder of this repo)
- dror75p-ops/Doryangel-website — original main website repo
- dror75p-ops/Doryangel.web.google.studio.v3 — earlier version
