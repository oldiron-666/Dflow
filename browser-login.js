import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

export function findLoginBrowser() {
  const candidates = [process.env.DFLOW_LOGIN_BROWSER,
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates.find(file => file && fs.existsSync(file));
}

// The user authenticates only on accounts.pixiv.net in a real system browser.
// Never ask DFlow to collect a password or provider token. A dedicated profile
// avoids touching the user's normal browser, extensions or existing cookies.
export class PixivBrowserLogin {
  constructor(dataDir, onSuccess, options = {}) {
    this.profile = path.join(dataDir, 'pixiv-login-browser');
    this.onSuccess = onSuccess;
    this.launch = options.launch || ((dir, settings) => chromium.launchPersistentContext(dir,settings));
    this.browserPath = options.browserPath || findLoginBrowser();
    this.state = {status:'idle',message:''};
    this.context = null; this.timer = null; this.starting = null; this.generation = 0;
  }
  status() { return {...this.state}; }
  async start() {
    if(this.starting) return this.starting;
    if(this.context) return this.status();
    this.starting = this.open().finally(()=>{this.starting=null;});
    return this.starting;
  }
  async open() {
    const generation = ++this.generation;
    if(!this.browserPath) throw Error('找不到 Chrome/Edge。请安装浏览器，或设置 DFLOW_LOGIN_BROWSER；也可使用手动 Cookie 登录。');
    this.state = {status:'starting',message:'正在打开 Pixiv 官方登录窗口…'};
    try {
      fs.mkdirSync(this.profile,{recursive:true});
      const context=await this.launch(this.profile,{executablePath:this.browserPath,headless:false,viewport:null,timeout:20000});
      if(generation!==this.generation){await context.close();return this.status();}
      this.context=context;
      context.on('close',()=>{if(this.context===context){this.context=null;clearTimeout(this.timer);if(['waiting','starting'].includes(this.state.status))this.state={status:'cancelled',message:'登录窗口已关闭，可以重新登录'};}});
      const page=context.pages()[0] || await context.newPage();
      this.state={status:'waiting',message:'请在官方窗口完成登录；DFlow 会自动同步，无需复制 Cookie'};
      // Navigation failure need not close the official browser; the user can
      // fix their proxy and reload there. Poll only authenticated Pixiv pages.
      page.goto('https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F', {waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
      const deadline=Date.now()+10*60*1000;
      const poll=async()=>{
        if(this.context!==context)return;
        try {
          for(const tab of context.pages()) {
            const url=new URL(tab.url());
            if(url.hostname!=='www.pixiv.net') continue;
            const user=await tab.evaluate(()=>{
              try {const data=JSON.parse(document.querySelector('meta[name="global-data"]')?.content || '{}');return data.userData?.id ? {id:String(data.userData.id),name:String(data.userData.name || '')}:null;} catch {return null;}
            });
            if(!user || !/^\d+$/.test(user.id) || Number(user.id)<=0)continue;
            const cookies=await context.cookies('https://www.pixiv.net/');
            const session=cookies.find(cookie=>cookie.name==='PHPSESSID');
            if(!session?.value)continue;
            await this.onSuccess(`PHPSESSID=${session.value}`,user);
            this.state={status:'connected',message:`已登录 ${user.name || user.id}，登录状态已保存`,user};
            await context.close();return;
          }
        } catch { /* Page redirects and closing tabs are normal during login. */ }
        if(Date.now()>deadline){this.state={status:'expired',message:'登录等待已超时，请重新打开官方登录'};await context.close();return;}
        this.timer=setTimeout(poll,2000);this.timer.unref?.();
      };
      this.timer=setTimeout(poll,1000);this.timer.unref?.();
      return this.status();
    } catch(error){this.state={status:'error',message:'无法打开官方登录，请使用手动 Cookie 或检查浏览器配置'};throw error;}
  }
  async cancel() {
    this.generation++;
    clearTimeout(this.timer);
    this.state={status:'cancelled',message:'已取消官方登录'};
    if(this.context)await this.context.close();
    return this.status();
  }
}
