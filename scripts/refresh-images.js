// refresh-images.js — One-shot script to update all existing posts' cover images

import { readFileSync, writeFileSync } from 'fs';

const IMAGE_QUERIES = {
  'Compliance':           ['business professional reviewing documents bright office', 'office worker computer modern bright', 'manhattan skyscraper daylight blue sky'],
  'Investment':           ['manhattan skyline daylight bright', 'businesswoman laptop modern office bright', 'nyc skyscrapers blue sky'],
  'Tenant Relations':     ['handyman repairing apartment bright', 'maintenance worker tools toolbox', 'professional plumber working bright'],
  'Property Management':  ['handyman fixing apartment bright', 'office team working laptops bright', 'modern office workers computers daylight'],
};

async function fetchImage(category, seedIndex) {
  const queries = IMAGE_QUERIES[category] || IMAGE_QUERIES['Property Management'];
  const query = queries[seedIndex % queries.length];
  console.log(`  Searching: "${query}"`);

  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=15&content_filter=high`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }
  });
  if (!res.ok) {
    console.log(`  ✗ API error ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    console.log(`  ✗ No results`);
    return null;
  }
  const photo = data.results[seedIndex % Math.min(data.results.length, 8)];
  return `${photo.urls.raw}&w=1200&q=80&fit=crop`;
}

const path = './content/blog/posts-index.json';
const posts = JSON.parse(readFileSync(path, 'utf8'));

console.log(`Refreshing images for ${posts.length} posts\n`);
for (let i = 0; i < posts.length; i++) {
  const post = posts[i];
  console.log(`[${i+1}/${posts.length}] ${post.category} — ${post.title.slice(0,60)}`);
  const newImage = await fetchImage(post.category, i);
  if (newImage) {
    post.image = newImage;
    console.log(`  ✓ updated`);
  }
  await new Promise(r => setTimeout(r, 800));
}

writeFileSync(path, JSON.stringify(posts, null, 2));
console.log('\n✅ Done — posts-index.json updated.');
