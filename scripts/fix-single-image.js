// fix-single-image.js — Refresh the hero image for one post by slug
// Usage: SLUG=<slug> node scripts/fix-single-image.js
// Defaults to the most recent post (posts[0]) if SLUG is not set.

import { readFileSync, writeFileSync } from 'fs';
import { searchUnsplashPhotos, pickImageQuery } from './lib/post-utils.js';

const SLUG = process.env.SLUG || null;

const IMAGE_QUERIES = {
  'property-management': [
    'business professional reviewing documents bright office',
    'office worker computer modern bright',
    'manhattan skyscraper daylight blue sky',
    'modern nyc office building',
  ],
  // Kept in step with generate-post.js's list for this category — it had drifted
  // and was missing the roof/boiler queries, so re-rolling a roof post's image
  // here could never produce a roof photo.
  'diy-property-management': [
    'handyman repairing apartment bright',
    'maintenance worker tools toolbox',
    'professional plumber working bright',
    'building boiler room heating system',
    'roof inspection worker building rooftop',
    'radiator heating apartment window',
    'nyc apartment building exterior bright',
  ],
  'investments': [
    'manhattan skyline daylight bright',
    'businesswoman laptop modern office bright',
    'nyc skyscrapers blue sky',
    'bronx residential building daylight',
  ],
  'property-automation': [
    'smart door lock apartment building entrance',
    'security camera apartment building exterior',
    'smart thermostat device white wall home',
    'building keypad entry security door residential',
  ],
  'broker-partnerships': [
    'real estate broker professional handshake office',
    'realtor reviewing documents bright office',
    'business partners meeting modern office nyc',
    'real estate agent client consultation bright',
  ],
};

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1600&q=80';

async function fetchImage(category, title = '') {
  const queries = IMAGE_QUERIES[category] || IMAGE_QUERIES['property-management'];
  const query = pickImageQuery(queries, title);
  console.log(`Searching Unsplash: "${query}"`);

  const results = await searchUnsplashPhotos(query);
  const photo = results[Math.floor(Math.random() * Math.min(results.length, 10))];
  return `${photo.urls.raw}&w=1600&q=80&fit=crop`;
}

const indexPath = './content/blog/posts-index.json';
const posts = JSON.parse(readFileSync(indexPath, 'utf8'));

const idx = SLUG ? posts.findIndex(p => p.slug === SLUG) : 0;
if (idx === -1) { console.error(`Slug not found: ${SLUG}`); process.exit(1); }

const post = posts[idx];
console.log(`Refreshing image for: "${post.title}" (${post.category})`);
console.log(`Current image: ${post.heroImage?.slice(0, 60)}...`);

try {
  const newImage = await fetchImage(post.category, post.title);
  post.heroImage = newImage;
  posts[idx] = post;
  writeFileSync(indexPath, JSON.stringify(posts, null, 2));
  console.log(`Updated: ${newImage.slice(0, 60)}...`);
} catch (err) {
  console.error(`Failed: ${err.message} — keeping existing image`);
  process.exit(1);
}
