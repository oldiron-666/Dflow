import { execFileSync } from 'node:child_process';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

export function proxyUrl(value) {
  const input=String(value || '').trim();
  if(!input)return '';
  const parts=Object.fromEntries(input.split(';').filter(x=>x.includes('=')).map(x=>x.split('=')));
  const selected=parts.https || parts.http || input;
  try {
    const url=new URL(selected.includes('://')?selected:`http://${selected}`);
    return ['http:','https:'].includes(url.protocol)?url.toString():'';
  } catch { return ''; }
}
function windowsProxy() {
  if(process.platform!=='win32' || process.env.DFLOW_NO_SYSTEM_PROXY==='1')return '';
  try {
    const settings=execFileSync('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{encoding:'utf8',windowsHide:true,timeout:2000});
    if(!/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(settings))return '';
    return proxyUrl(settings.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/)?.[1]);
  } catch {return '';}
}
export function configureNetwork() {
  const system=windowsProxy();
  const http=proxyUrl(process.env.DFLOW_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || system);
  const https=proxyUrl(process.env.DFLOW_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || http);
  if(!http && !https)return;
  // MCP and the local API must NEVER travel through the external proxy.
  const noProxy=['localhost','127.0.0.1','::1',process.env.NO_PROXY || process.env.no_proxy || ''].join(',');
  setGlobalDispatcher(new EnvHttpProxyAgent({httpProxy:http,httpsProxy:https,noProxy}));
}
