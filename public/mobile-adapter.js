// Dflow Mobile Standalone Adapter
// 100% 纯前端单机直连引擎：脱离 Node.js，让手机 App 独立请求 Danbooru 并将数据持久化在本地

(function() {
  const DANBOORU_HOST = 'https://danbooru.donmai.us';

  // 辅助：获取保存在本地的认证信息
  function getAuthParams() {
    const username = localStorage.getItem('loginName') || '';
    const apiKey = localStorage.getItem('loginKey') || '';
    return { username, apiKey };
  }

  // 辅助：构造带鉴权的 URL
  function appendAuth(urlStr) {
    const url = new URL(urlStr, DANBOORU_HOST);
    const { username, apiKey } = getAuthParams();
    if (username && apiKey) {
      url.searchParams.set('login', username);
      url.searchParams.set('api_key', apiKey);
    }
    return url.toString();
  }

  // 拦截全局 fetch，将原本发给本地 Node 的 /api/... 全面接管为纯前端处理
  const origFetch = window.fetch;
  window.fetch = async function(resource, init = {}) {
    const urlStr = typeof resource === 'string' ? resource : resource.url;

    // 1. 如果不是 /api/，走原版 fetch
    if (!urlStr.startsWith('/api/')) {
      return origFetch(resource, init);
    }

    const [path, queryString] = urlStr.split('?');
    const params = new URLSearchParams(queryString || '');

    // 2. 帖子列表接口 /api/posts
    if (path === '/api/posts') {
      const targetUrl = appendAuth(`${DANBOORU_HOST}/posts.json?${params.toString()}`);
      return origFetch(targetUrl, {
        headers: { 'Accept': 'application/json' }
      });
    }

    // 3. 热门推荐接口 /api/explore/popular
    if (path === '/api/explore/popular') {
      const scale = params.get('scale') || 'day';
      params.delete('scale');
      const targetUrl = appendAuth(`${DANBOORU_HOST}/explore/popular.json?date_range=${scale}&${params.toString()}`);
      return origFetch(targetUrl, {
        headers: { 'Accept': 'application/json' }
      });
    }

    // 4. 浏览最多接口 /api/explore/viewed
    if (path === '/api/explore/viewed') {
      const targetUrl = appendAuth(`${DANBOORU_HOST}/explore/posts/viewed.json?${params.toString()}`);
      return origFetch(targetUrl, {
        headers: { 'Accept': 'application/json' }
      });
    }

    // 5. 标签自动补全 /api/tags
    if (path === '/api/tags') {
      const targetUrl = appendAuth(`${DANBOORU_HOST}/tags.json?${params.toString()}`);
      return origFetch(targetUrl, {
        headers: { 'Accept': 'application/json' }
      });
    }

    // 6. 鉴权测试 /api/auth-test
    if (path === '/api/auth-test') {
      const targetUrl = appendAuth(`${DANBOORU_HOST}/profile.json`);
      try {
        const res = await origFetch(targetUrl, { headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const profile = await res.json();
          return new Response(JSON.stringify({ ok: true, name: profile.name, id: profile.id }), { status: 200, headers: {'Content-Type': 'application/json'} });
        }
        return new Response(JSON.stringify({ ok: false, message: '认证失败，请检查账号和 API Key' }), { status: 401, headers: {'Content-Type': 'application/json'} });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, message: err.message }), { status: 500, headers: {'Content-Type': 'application/json'} });
      }
    }

    // 7. 图片代理接口 /api/image?url=... -> 直接重定向或拉取原图
    if (path === '/api/image') {
      const realUrl = params.get('url');
      if (!realUrl) return new Response('Missing url', { status: 400 });
      return origFetch(realUrl, { referrerPolicy: 'no-referrer' });
    }

    // 8. 状态与配置接口 /api/state, /api/preferences, /api/account
    if (path === '/api/state') {
      const prefs = JSON.parse(localStorage.getItem('dflowPreferencesV1') || '{}');
      return new Response(JSON.stringify({
        account: {
          loginName: localStorage.getItem('loginName') || '',
          loginKey: localStorage.getItem('loginKey') || ''
        },
        preferences: prefs,
        favoritesCount: JSON.parse(localStorage.getItem('dflowFavoritesV1') || '[]').length
      }), { status: 200, headers: {'Content-Type': 'application/json'} });
    }

    if (path === '/api/account') {
      if (init.method === 'PUT' && init.body) {
        const data = JSON.parse(init.body);
        if (data.loginName !== undefined) localStorage.setItem('loginName', data.loginName);
        if (data.loginKey !== undefined) localStorage.setItem('loginKey', data.loginKey);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: {'Content-Type': 'application/json'} });
    }

    if (path === '/api/preferences') {
      if (init.method === 'PUT' && init.body) {
        localStorage.setItem('dflowPreferencesV1', init.body);
      }
      const prefs = JSON.parse(localStorage.getItem('dflowPreferencesV1') || '{}');
      return new Response(JSON.stringify(prefs), { status: 200, headers: {'Content-Type': 'application/json'} });
    }

    // 9. 本地收藏夹接口 /api/favorites
    if (path === '/api/favorites' || path.startsWith('/api/favorites/')) {
      let favs = JSON.parse(localStorage.getItem('dflowFavoritesV1') || '[]');
      if (init.method === 'PUT' && init.body) {
        const body = JSON.parse(init.body);
        if (Array.isArray(body.favorites)) {
          favs = body.favorites;
          localStorage.setItem('dflowFavoritesV1', JSON.stringify(favs));
        }
      }
      return new Response(JSON.stringify({ favorites: favs, updatedAt: Date.now() }), {
        status: 200,
        headers: {'Content-Type': 'application/json'}
      });
    }

    // 10. 词条与元数据相关接口 /api/worded/..., /api/metadata/...
    if (path.startsWith('/api/worded') || path.startsWith('/api/metadata')) {
      return new Response(JSON.stringify([]), { status: 200, headers: {'Content-Type': 'application/json'} });
    }

    // 兜底返回 200 JSON
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: {'Content-Type': 'application/json'} });
  };

  console.log('[Dflow] 纯手机端单机直连引擎已激活');
})();
