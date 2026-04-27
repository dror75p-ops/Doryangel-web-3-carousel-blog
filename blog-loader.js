// blog-loader.js — Editorial layout for the blog index section
// Each card links to /blog/[slug]/ for SEO; no overlay reader.

(async function () {
  var container = document.getElementById('blog-carousel');
  if (!container) return;

  var posts = [];
  try {
    var res = await fetch('./content/blog/posts-index.json');
    if (!res.ok) throw new Error('failed');
    posts = await res.json();
  } catch (e) {
    container.innerHTML = '<p style="color:#8B9BAE;text-align:center;padding:40px 0;">Blog posts coming soon.</p>';
    return;
  }

  posts.sort(function (a, b) {
    return new Date(b.publishedDate || b.date) - new Date(a.publishedDate || a.date);
  });

  var CATEGORY_LABEL = {
    'all':                       'All',
    'property-management':       'Property Management',
    'diy-property-management':   'DIY Property Management',
    'investments':               'Investments',
  };
  var TABS = ['all', 'property-management', 'diy-property-management', 'investments'];
  var activeCategory = 'all';

  var BASE = './blog/';

  function postUrl(post) { return BASE + post.slug + '/'; }
  function fmtDate(d) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function render() {
    container.innerHTML = '';

    var filtered = activeCategory === 'all'
      ? posts
      : posts.filter(function (p) { return p.category === activeCategory; });

    var featured = filtered.find(function (p) { return p.featured; }) || filtered[0];
    var listPosts = filtered.filter(function (p) { return p !== featured; });

    var tabsEl = document.createElement('div');
    tabsEl.className = 'blog-tabs';
    TABS.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.className = 'blog-tab' + (cat === activeCategory ? ' active' : '');
      btn.textContent = CATEGORY_LABEL[cat];
      btn.onclick = function () { activeCategory = cat; render(); };
      tabsEl.appendChild(btn);
    });
    container.appendChild(tabsEl);

    if (!featured) {
      container.insertAdjacentHTML('beforeend', '<p style="color:#8B9BAE;text-align:center;padding:40px 0;">No articles in this category yet.</p>');
      return;
    }

    var featEl = document.createElement('a');
    featEl.className = 'blog-featured';
    featEl.href = postUrl(featured);
    var featImage = featured.heroImage
      ? '<div class="blog-featured-image" style="background-image:url(\'' + featured.heroImage + '\')"></div>'
      : '';
    featEl.innerHTML =
      featImage +
      '<div class="blog-featured-top">' +
        '<div class="blog-featured-cat">' + CATEGORY_LABEL[featured.category] + '</div>' +
        '<div class="blog-featured-title">' + featured.title + '</div>' +
        '<div class="blog-featured-excerpt">' + featured.excerpt + '</div>' +
      '</div>' +
      '<div class="blog-featured-foot">' +
        '<span class="blog-featured-byline">' + (featured.author || 'DoryAngel Team') + ' &middot; ' + fmtDate(featured.publishedDate) + ' &middot; ' + (featured.minutesToRead || 5) + ' min read</span>' +
        '<span class="blog-featured-link">Read full article &rarr;</span>' +
      '</div>';
    container.appendChild(featEl);

    if (listPosts.length > 0) {
      var listEl = document.createElement('div');
      listEl.className = 'blog-list';
      listPosts.forEach(function (post, idx) {
        var num = (idx + 1).toString().padStart(2, '0');
        var item = document.createElement('a');
        item.className = 'blog-list-item';
        item.href = postUrl(post);
        item.innerHTML =
          '<div class="blog-list-num">' + num + '</div>' +
          '<div class="blog-list-body">' +
            '<div class="blog-list-cat">' + CATEGORY_LABEL[post.category] + '</div>' +
            '<div class="blog-list-title">' + post.title + '</div>' +
            '<div class="blog-list-meta">' + fmtDate(post.publishedDate) + ' &middot; ' + (post.minutesToRead || 5) + ' min read</div>' +
          '</div>' +
          '<div class="blog-list-arrow">&rarr;</div>';
        listEl.appendChild(item);
      });
      container.appendChild(listEl);
    }

    var footEl = document.createElement('div');
    footEl.className = 'blog-footer-row';
    footEl.innerHTML =
      '<span class="blog-post-cadence">' + posts.length + ' articles &middot; new post every 3 days</span>';
    container.appendChild(footEl);
  }

  render();
})();
