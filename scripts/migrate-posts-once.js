// migrate-posts-once.js — One-time migration from old to new schema
// Old: { slug, title, date, category, author, excerpt, image, views, score, content }
// New: { slug, title, category, excerpt, publishedDate, minutesToRead, heroImage,
//        heroImageAlt, hashtags, featured, seoTitle, seoDescription, author, content }

import { readFileSync, writeFileSync } from 'fs';

// Map old categories → new 3-category system
const CATEGORY_MAP = {
  'Compliance':          'diy-property-management',
  'Investment':          'investments',
  'Tenant Relations':    'diy-property-management',
  'Property Management': 'property-management',
};

// Per-category default hashtags
const HASHTAGS = {
  'property-management':     ['propertymanagement', 'bronxlandlord', 'nyc', 'flatfee', 'doryangel'],
  'diy-property-management': ['diylandlord', 'bronxlandlord', 'nyc', 'rentalproperty', 'doryangel'],
  'investments':             ['realestateinvesting', 'bronx', 'nycrealestate', 'rentalincome', 'doryangel'],
};

function categoryAlt(category) {
  const map = {
    'property-management':     'Modern New York City property management office',
    'diy-property-management': 'New York landlord working in apartment building',
    'investments':             'Bronx skyline showing rental property investment opportunity',
  };
  return map[category] || 'New York City property scene';
}

function wordsToMinutes(content) {
  const words = content.trim().split(/\s+/).length;
  return Math.max(2, Math.round(words / 220));
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function generateSeoTitle(title) {
  const base = `${title} | DoryAngel`;
  return truncate(base, 60);
}

function generateSeoDescription(excerpt, category) {
  const suffix = ' DoryAngel — flat-fee property management in NYC.';
  const room = 155 - suffix.length;
  return truncate(excerpt, room) + suffix;
}

const PATH = './content/blog/posts-index.json';
const old = JSON.parse(readFileSync(PATH, 'utf8'));

const migrated = old.map((p, i) => {
  const newCategory = CATEGORY_MAP[p.category] || 'property-management';
  return {
    slug: p.slug,
    title: p.title,
    category: newCategory,
    excerpt: p.excerpt,
    publishedDate: p.date,
    minutesToRead: wordsToMinutes(p.content || ''),
    heroImage: p.image,
    heroImageAlt: categoryAlt(newCategory),
    hashtags: HASHTAGS[newCategory],
    featured: i === 0,
    seoTitle: generateSeoTitle(p.title),
    seoDescription: generateSeoDescription(p.excerpt, newCategory),
    author: p.author || 'DoryAngel Team',
    content: p.content,
  };
});

writeFileSync(PATH, JSON.stringify(migrated, null, 2));
console.log(`Migrated ${migrated.length} posts to new schema.`);
console.log(`Featured post: "${migrated[0].title}"`);
console.log(`Category breakdown:`);
const counts = {};
migrated.forEach(p => counts[p.category] = (counts[p.category] || 0) + 1);
Object.entries(counts).forEach(([cat, n]) => console.log(`  ${cat}: ${n}`));
