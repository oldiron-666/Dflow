export function danbooruCredentials(req, account = {}) {
  const explicit = req.method === 'POST';
  let username = String(explicit ? req.body?.loginName ?? '' : req.get('X-Danbooru-Username') ?? account.loginName ?? '').trim();
  if (!explicit && req.get('X-DFlow-Auth-Encoding') === 'uri') {
    try { username = decodeURIComponent(username); } catch { throw Error('账户名称编码无效，请重新填写用户名'); }
  }
  const apiKey = String(explicit ? req.body?.loginKey ?? '' : req.get('X-Danbooru-Key') ?? account.loginKey ?? '').trim();
  return { username, apiKey };
}
export function normalizePixivCookie(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const match = input.match(/(?:^|[;\s])PHPSESSID\s*=\s*([^;\s]+)/i);
  const session = match ? match[1] : (/^[^=;\s]+$/.test(input) ? input : '');
  return session ? `PHPSESSID=${session}` : input.replace(/[\r\n]+/g, ' ');
}
export function authFailure(status, detail = {}, isHtml = false) {
  const specific = status === 401 ? '用户名或 Personal API Key 不正确，或 API Key 已失效。' :
    status === 403 ? (isHtml ? '请求被站点防护或网络代理拦截，不能据此判断账号密码错误。请检查网络。' : 'API Key 权限不足或被限制；请在 Danbooru API Keys 页面检查允许的 IP、接口权限和有效期。') :
    status === 429 || status === 420 ? '站点请求过于频繁，请稍后重试。' :
    `Danbooru 返回 HTTP ${status}，请检查网络或稍后重试。`;
  return specific + (detail.message ? ` ${String(detail.message).slice(0,300)}` : '');
}
