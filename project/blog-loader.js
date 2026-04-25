// blog-loader.js — Editorial / Newspaper layout (Option D)

(async function () {
  var container = document.getElementById('blog-carousel');
  if (!container) return;

  // Load posts from index JSON
  var posts = [];
  try {
    var res = await fetch('./content/blog/posts-index.json');
    if (!res.ok) throw new Error('failed');
    posts = await res.json();
  } catch (e) {
    container.innerHTML = '<p style="color:#8B9BAE;text-align:center;padding:40px 0;">Blog posts coming soon.</p>';
    return;
  }

  posts.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

  var ALL_CATS = ['All'];
  posts.forEach(function (p) { if (p.category && ALL_CATS.indexOf(p.category) === -1) ALL_CATS.push(p.category); });

  var activeCategory = 'All';

  // ── Article overlay ──────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id = 'blog-overlay';
  overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#ffffff;flex-direction:column;overflow-y:auto;';
  overlay.innerHTML =
    '<div id="blog-overlay-bar" style="position:sticky;top:0;background:#fff;border-bottom:2px solid #0D1E3A;padding:14px 24px;display:flex;align-items:center;gap:16px;z-index:1;">' +
      '<button id="blog-back-btn">&#8592; Back to Website</button>' +
      '<span class="blog-overlay-site-name">DoryAngel Property Insights</span>' +
    '</div>' +
    '<div id="blog-overlay-body"></div>';
  document.body.appendChild(overlay);

  document.getElementById('blog-back-btn').onclick = function () {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    var blogEl = document.getElementById('blog');
    if (blogEl) { window.scrollTo({ top: blogEl.offsetTop, behavior: 'smooth' }); }
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { overlay.style.display = 'none'; document.body.style.overflow = ''; }
  });

  function openPost(slug) {
    var post = null;
    for (var i = 0; i < posts.length; i++) { if (posts[i].slug === slug) { post = posts[i]; break; } }
    if (!post || !post.content) return;

    var body = document.getElementById('blog-overlay-body');
    body.innerHTML = '<article class="blog-article-body">' + marked.parse(post.content) + '</article>';
    overlay.style.display = 'flex';
    overlay.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }

  // ── Render ───────────────────────────────────────────────────────
  function render() {
    container.innerHTML = '';

    var filtered = activeCategory === 'All'
      ? posts
      : posts.filter(function (p) { return p.category === activeCategory; });

    var featured = filtered[0];
    var listPosts = filtered.slice(1);

    // Tabs
    var tabsEl = document.createElement('div');
    tabsEl.className = 'blog-tabs';
    ALL_CATS.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.className = 'blog-tab' + (cat === activeCategory ? ' active' : '');
      btn.textContent = cat;
      btn.onclick = function () { activeCategory = cat; render(); };
      tabsEl.appendChild(btn);
    });
    container.appendChild(tabsEl);

    if (!featured) {
      container.insertAdjacentHTML('beforeend', '<p style="color:#8B9BAE;text-align:center;padding:40px 0;">No articles in this category yet.</p>');
      return;
    }

    // Featured post
    var featEl = document.createElement('div');
    featEl.className = 'blog-featured';
    featEl.innerHTML =
      '<div class="blog-featured-top">' +
        '<div class="blog-featured-cat">' + featured.category + '</div>' +
        '<div class="blog-featured-title">' + featured.title + '</div>' +
        '<div class="blog-featured-excerpt">' + featured.excerpt + '</div>' +
      '</div>' +
      '<div class="blog-featured-foot">' +
        '<span class="blog-featured-byline">DoryAngel Team &middot; ' + fmtDate(featured.date) + '</span>' +
        '<button class="blog-featured-link" data-slug="' + featured.slug + '">Read full article &rarr;</button>' +
      '</div>';
    container.appendChild(featEl);
    featEl.querySelector('.blog-featured-top').onclick = function () { openPost(featured.slug); };
    featEl.querySelector('.blog-featured-link').onclick = function (e) { e.stopPropagation(); openPost(featured.slug); };

    // Numbered list
    if (listPosts.length > 0) {
      var listEl = document.createElement('div');
      listEl.className = 'blog-list';
      listPosts.forEach(function (post, idx) {
        var item = document.createElement('div');
        item.className = 'blog-list-item';
        item.innerHTML =
          '<div class="blog-list-num">0' + (idx + 1) + '</div>' +
          '<div class="blog-list-body">' +
            '<div class="blog-list-cat">' + post.category + '</div>' +
            '<div class="blog-list-title">' + post.title + '</div>' +
            '<div class="blog-list-meta">DoryAngel Team &middot; ' + fmtDate(post.date) + '</div>' +
          '</div>' +
          '<div class="blog-list-arrow">&rarr;</div>';
        item.onclick = function () { openPost(post.slug); };
        listEl.appendChild(item);
      });
      container.appendChild(listEl);
    }

    // Footer row
    var footEl = document.createElement('div');
    footEl.className = 'blog-footer-row';
    footEl.innerHTML =
      '<button class="blog-view-all" onclick="window.open(\'https://www.doryangel.com/blog-1\',\'_blank\')">View all ' + posts.length + ' articles &rarr;</button>' +
      '<span class="blog-post-cadence">New post every 3 days</span>';
    container.appendChild(footEl);
  }

  function fmtDate(d) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  render();
})();
