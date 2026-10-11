import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {fixture,favorite,entry} from '../scripts/regression-fixture.mjs';
import {findLoginBrowser} from '../browser-login.js';
const browserPath=findLoginBrowser();
test('real browser: mixed order, paste into agent text-only card, move reflow, resize and stable settings polling',{timeout:60000,skip:!browserPath},async()=>{
 const f=await fixture({bridge:true,favorites:[favorite('local_q2','pending',2),favorite('local_w_old','worded',0,{prompt:'Old landscape prompt',promptWrittenAt:'2026-03-01'}),favorite('local_w_new','worded',0,{prompt:'New landscape prompt',promptWrittenAt:'2026-04-01'}),favorite('local_o_old','original',0,{promptWrittenAt:'2026-01-01'}),favorite('local_o_new','original',0,{promptWrittenAt:'2026-02-01'})],entries:[entry('q1','pending',1),entry('q3','pending',3),entry('paused','pending',0,{autoEnabled:false}),entry('agent-text','worded',0,{imageExt:'',width:0,height:0,positive:'An agent created this prompt without an image',promptWrittenAt:'2026-10-01'}),entry('portrait','worded',0,{promptWrittenAt:'2026-05-01'}),...Array.from({length:35},(_,n)=>entry(`load-${n}`,'worded',0,{width:800,height:400,promptWrittenAt:'2026-02-01'}))]});
 let browser;const errors=[];
 try{
  await f.request('/api/mcp/sessions',{clientId:'ui',name:'DSH Desktop'});
  browser=await chromium.launch({executablePath:browserPath,headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===f.base || ['blob:','data:'].includes(url.protocol)?route.continue():route.abort();});
  let galleryRequests=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/local-gallery')galleryRequests++;});
  await page.goto(f.base);await page.locator('[data-mode="favorites"]').click();
  await page.locator('#favoriteFolders [data-folder="pending"]').click();await page.waitForFunction(()=>document.querySelectorAll('#gallery>.reverse-card').length===4);
  assert.deepEqual(await page.locator('#gallery>.reverse-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.reverseId)),['q1','local_q2','q3','paused']);
  assert.deepEqual(await page.locator('#gallery .round-queue-btn').allTextContents(),['1','2','3','+']);
  // Responsive changes redistribute existing DOM, without fetching again.
  const initialRequests=galleryRequests;await page.locator('[data-reverse-id="q1"]').evaluate(node=>window.savedCard=node);
  for(const [width,count] of [[900,3],[620,2],[1600,5]]){
   await page.setViewportSize({width,height:1000});await page.waitForFunction(expected=>Number(document.querySelector('#gallery').style.getPropertyValue('--gallery-cols'))===expected,count);
   assert.equal(await page.locator('[data-reverse-id="q1"]').evaluate(node=>window.savedCard===node),true);
  }
  assert.equal(galleryRequests,initialRequests);
  await page.locator('#favoriteFolders [data-folder="worded"]').click();await page.waitForFunction(()=>document.querySelectorAll('#gallery>.reverse-card').length===39);
  const wordedIds=await page.locator('#gallery>.reverse-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.reverseId));assert.deepEqual(wordedIds.slice(0,2),['local_w_new','local_w_old']);assert.deepEqual(wordedIds.slice(-2),['agent-text','portrait']);
  await page.locator('[data-reverse-id="local_w_old"]').evaluate(node=>window.unchangedCard=node);
  const started=Date.now();await page.locator('[data-reverse-id="local_w_new"] button[title="释放至已完成"]').click();await page.waitForFunction(()=>!document.querySelector('[data-reverse-id="local_w_new"]'));
  assert.equal(await page.locator('[data-reverse-id="local_w_old"]').evaluate(node=>node===window.unchangedCard),true);
  const firstRect=await page.locator('#gallery>.reverse-card').first().boundingBox(),secondRect=await page.locator('#gallery>.reverse-card').nth(1).boundingBox();assert.equal(Math.round(firstRect.y),Math.round(secondRect.y));
  console.log(`UI move-and-reflow (${wordedIds.length} cards): ${Date.now()-started} ms`);
  // Paste with focus on the document rather than the picture/drop zone.
  await page.locator('[data-reverse-id="agent-text"] .add-card-image').click();
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;canvas.getContext('2d').fillRect(0,0,800,400);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const clipboardData=new DataTransfer();clipboardData.items.add(new File([blob],'paste.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));});
  const save=page.locator('.prompt-save');await page.waitForFunction(()=>!document.querySelector('.prompt-save').disabled);await save.click();await page.waitForFunction(()=>document.querySelector('[data-reverse-id="agent-text"] .art-img'));
  const snapshot=await (await f.request('/api/local-gallery')).json(),pasted=snapshot.entries.find(x=>x.id==='agent-text');assert.equal(pasted.imageExt,'png');assert.equal(pasted.width,800);assert.equal(pasted.height,400);assert.equal(pasted.promptWrittenAt,'2026-10-01');
  assert.equal((await fs.stat(path.join(f.data,'favorites','worded','agent-text.png'))).size>100,true);
  await page.locator('button[aria-label="关闭提示词"]').click();
  assert.equal(await page.locator('#gallery>.reverse-card').first().getAttribute('data-reverse-id'),'agent-text');
  await page.locator('#settings').click();await page.locator('[data-tab="tabMcp"]').click();await page.waitForFunction(()=>document.querySelector('#mcpSessions .mcp-session'));
  await page.locator('#mcpSessions .mcp-session').first().evaluate(node=>window.mcpRow=node);
  await page.waitForFunction(()=>document.querySelector('#dshSessions .mcp-session'));
  await page.locator('#dshSessions .mcp-session').first().evaluate(node=>window.dshRow=node);
  await page.waitForTimeout(11000);await page.locator('#refreshMcpSessions').click();await page.waitForTimeout(300);
  assert.equal(await page.locator('#mcpSessions .mcp-session').first().evaluate(node=>window.mcpRow===node),true);
  await page.locator('#refreshDshSessions').click();await page.waitForTimeout(300);
  assert.equal(await page.locator('#dshSessions .mcp-session').first().evaluate(node=>window.dshRow===node),true);
  assert.equal(errors.length,0,errors.join('\n'));
  if(process.env.DFLOW_QA_OUTPUT){await fs.mkdir(process.env.DFLOW_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.DFLOW_QA_OUTPUT,'settings.png')});await page.locator('#closeSettingsHeader').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(process.env.DFLOW_QA_OUTPUT,'gallery.png')});}
  if(await page.locator('#settingsDialog').evaluate(node=>node.open))await page.locator('#closeSettingsHeader').click();
  await page.locator('#favoriteFolders [data-folder="original"]').click();await page.waitForFunction(()=>document.querySelectorAll('#gallery>.card').length===2);
  assert.deepEqual(await page.locator('#gallery>.card').evaluateAll(nodes=>nodes.map(node=>node.dataset.favoriteId)),['local_o_new','local_o_old']);
  await page.locator('#gallery>.card').first().evaluate(node=>window.originalCard=node);
  await f.request('/api/favorites/local_o_old',{reverseError:'only-status-change'},'PATCH');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(500);
  assert.equal(await page.locator('#gallery>.card').first().evaluate(node=>node===window.originalCard),true);assert.equal(await page.locator('#gallery>.card img').count(),2);
 }finally{await browser?.close();await f.close();}
});


test('real browser: mixed-height ordered cards pack tightly, resize and fill after removal',{timeout:60000,skip:!browserPath},async()=>{
 const sizes=[[1000,650],[700,1050],[700,1080],[700,700],[600,1600],[600,1560],[700,1200],[800,950],[700,1100],[700,1150]];
 const f=await fixture({entries:sizes.map(([width,height],n)=>entry('compact-'+n,'worded',0,{width,height,autoEnabled:false,promptWrittenAt:new Date(Date.UTC(2026,9,10)-n*86400000).toISOString()}))});
 let browser;const errors=[];
 try{
  browser=await chromium.launch({executablePath:browserPath,headless:true});
  const page=await browser.newPage({viewport:{width:1800,height:1200}});
  page.on('pageerror',e=>errors.push(e.message));
  // Real, differently-sized images, in the temporary fixture only.
  const images=await page.evaluate(sizes=>sizes.map(([width,height],n)=>{
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,width,height);
   gradient.addColorStop(0,'hsl('+n*33+' 55% 40%)');gradient.addColorStop(1,'hsl('+(n*33+60)+' 55% 18%)');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
   ctx.fillStyle='#ffffffaa';ctx.font='bold 70px sans-serif';ctx.fillText('Card '+(n+1),35,110);
   return canvas.toDataURL('image/png').split(',')[1];
  }),sizes);
  for(let n=0;n<images.length;n++)await fs.writeFile(path.join(f.data,'favorites','worded','compact-'+n+'.png'),Buffer.from(images[n],'base64'));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===f.base || ['blob:','data:'].includes(url.protocol)?route.continue():route.abort();});
  await page.goto(f.base);await page.locator('[data-mode="favorites"]').click();
  await page.locator('#columnButton').click();await page.locator('#columnOptions button[data-columns="7"]').click();
  await page.locator('#favoriteFolders [data-folder="worded"]').click();
  const waitLayout=async(count,cols)=>page.waitForFunction(({count,cols})=>{
   const gallery=document.querySelector('#gallery'),cards=[...gallery.children];
   if(cards.length!==count || Number(gallery.style.getPropertyValue('--gallery-cols'))!==cols)return false;
   const style=getComputedStyle(gallery),row=parseFloat(style.gridAutoRows),gap=parseFloat(style.getPropertyValue('--gallery-card-gap'));
   return cards.every(card=>card.style.gridRowEnd==='span '+Math.ceil((card.offsetHeight+gap)/row));
  },{count,cols});
  const geometry=()=>page.locator('#gallery>.reverse-card').evaluateAll(nodes=>nodes.map(node=>{
   const r=node.getBoundingClientRect();return {id:node.dataset.reverseId,x:r.x,y:r.y,right:r.right,bottom:r.bottom};
  }));
  const assertOrderedAndSeparated=rects=>{
   for(let n=1;n<rects.length;n++)assert.ok(rects[n].y>=rects[n-1].y-0.5 && (Math.abs(rects[n].y-rects[n-1].y)>0.5 || rects[n].x>rects[n-1].x),'visual start points follow DOM order');
   for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j];if(a.x<b.right-1 && b.x<a.right-1)assert.ok(a.bottom<=b.y+0.5 || b.bottom<=a.y+0.5,'cards never overlap');
   }
  };
  await waitLayout(10,7);
  let rects=await geometry();assert.deepEqual(rects.map(r=>r.id),sizes.map((_,n)=>'compact-'+n));assertOrderedAndSeparated(rects);
  assert.ok(Math.abs(rects[7].x-rects[0].x)<1);
  const gap=rects[7].y-rects[0].bottom;
  assert.ok(gap>=9 && gap<=15,'eighth card follows shortest card with only a normal gap: '+gap);
  assert.ok(rects[7].y<Math.max(...rects.slice(0,7).map(r=>r.bottom))-120,'no tallest-card row-sized blank');
  await page.locator('[data-reverse-id="compact-1"]').evaluate(node=>window.savedCompact=node);
  if(process.env.DFLOW_QA_OUTPUT){await fs.mkdir(process.env.DFLOW_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.DFLOW_QA_OUTPUT,'compact-gallery.png'),fullPage:true});}
  for(const [width,cols] of [[900,3],[620,2],[1800,7]]){
   await page.setViewportSize({width,height:1200});await waitLayout(10,cols);assertOrderedAndSeparated(await geometry());
   assert.equal(await page.locator('[data-reverse-id="compact-1"]').evaluate(node=>node===window.savedCompact),true);
  }
  await page.locator('[data-reverse-id="compact-0"] button[title="释放至已完成"]').click();await waitLayout(9,7);
  rects=await geometry();assert.deepEqual(rects.map(r=>r.id),sizes.slice(1).map((_,n)=>'compact-'+(n+1)));assertOrderedAndSeparated(rects);
  assert.equal(await page.locator('[data-reverse-id="compact-1"]').evaluate(node=>node===window.savedCompact),true);
  assert.equal(errors.length,0,errors.join('\n'));
 }finally{await browser?.close();await f.close();}
});

test('real browser: pending queue keeps natural image shapes, fixed-column rounds and compact gaps',{timeout:60000,skip:!browserPath},async()=>{
 const sizes=[[1000,600],[700,1050],[700,1080],[700,700],[600,1600],[600,1560],[700,1200],[800,950],[700,1100],[700,1150],[1000,600],[600,1700]];
 const id=n=>n%2===0?'local_queue-'+n:'queue-'+n;
 const favorites=[],entries=[];
 sizes.forEach(([width,height],n)=>{
  const active=n<10,order=active?n+1:0;
  if(n%2===0)favorites.unshift(favorite(id(n),'pending',order,{autoEnabled:active,image_width:width,image_height:height}));
  else entries.unshift(entry(id(n),'pending',order,{autoEnabled:active,width,height}));
 });
 entries.push(entry('queue-text','pending',0,{autoEnabled:false,imageExt:'',width:0,height:0}));
 favorites.push(favorite('local_queue-uncached','pending',0,{autoEnabled:false,cacheFile:'',cacheStatus:'error',image_width:600,image_height:1800}));
 const f=await fixture({favorites,entries});let browser;const errors=[];
 try{
  browser=await chromium.launch({executablePath:browserPath,headless:true});
  const page=await browser.newPage({viewport:{width:1800,height:1200}});page.on('pageerror',e=>errors.push(e.message));
  const images=await page.evaluate(sizes=>sizes.map(([width,height],n)=>{
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,width,height);
   gradient.addColorStop(0,'hsl('+n*31+' 55% 40%)');gradient.addColorStop(1,'hsl('+(n*31+60)+' 55% 18%)');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
   ctx.strokeStyle='#ffffffaa';ctx.lineWidth=20;ctx.strokeRect(10,10,width-20,height-20);
   ctx.fillStyle='#ffffff';ctx.font='bold 64px sans-serif';ctx.fillText(n<10?'Queue '+(n+1):'Paused',35,110);
   return canvas.toDataURL('image/png').split(',')[1];
  }),sizes);
  for(let n=0;n<images.length;n++)await fs.writeFile(path.join(f.data,'favorites',n%2===0?'pending':'worded',id(n)+'.png'),Buffer.from(images[n],'base64'));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===f.base || ['blob:','data:'].includes(url.protocol)?route.continue():route.abort();});
  await page.goto(f.base);await page.locator('[data-mode="favorites"]').click();
  await page.locator('#columnButton').click();await page.locator('#columnOptions button[data-columns="7"]').click();
  await page.locator('#favoriteFolders [data-folder="pending"]').click();
  const waitLayout=async(count,cols)=>page.waitForFunction(({count,cols})=>{
   const g=document.querySelector('#gallery');
   if(g.dataset.folder!=='pending' || g.children.length!==count || Number(g.style.getPropertyValue('--gallery-cols'))!==cols)return false;
   const style=getComputedStyle(g),row=parseFloat(style.gridAutoRows),gap=parseFloat(style.getPropertyValue('--gallery-card-gap')),bottoms=Array(cols).fill(1);
   return [...g.children].every((c,n)=>{
    const col=n%cols,span=Math.ceil((c.offsetHeight+gap)/row),start=bottoms[col];bottoms[col]+=span;
    return c.style.gridColumnStart===String(col+1) && c.style.gridRowStart===String(start) && c.style.gridRowEnd==='span '+span;
   });
  },{count,cols});
  const assertQueueColumns=async(cols,expected)=>{
   const rects=await page.locator('#gallery>.reverse-card').evaluateAll(nodes=>nodes.map(node=>{
    const r=node.getBoundingClientRect(),img=node.querySelector('.art-img'),ir=img?.getBoundingClientRect();
    return {id:node.dataset.reverseId,x:r.x,y:r.y,height:r.height,bottom:r.bottom,number:node.querySelector('.round-queue-btn').textContent,
     landscape:node.classList.contains('landscape'),horizontalStrip:node.querySelector('.ui-strip').classList.contains('horizontal-strip'),
     imageRatio:ir?ir.width/ir.height:null,declaredRatio:img?getComputedStyle(img).aspectRatio:null,
     frontRatio:getComputedStyle(node.querySelector('.card-front')).aspectRatio};
   }));
   assert.deepEqual(rects.filter(r=>r.number!=='+').map(r=>r.id),expected);
   assert.deepEqual(rects.filter(r=>r.number!=='+').map(r=>Number(r.number)),expected.map((_,n)=>n+1));
   for(let n=0;n<rects.length;n++){
    const r=rects[n],column=rects[n%cols];
    assert.ok(Math.abs(r.x-column.x)<1,'fixed column index follows queue position, never image height');
    assert.equal(r.horizontalStrip,r.landscape,'original landscape bottom bar and portrait sidebar');
    assert.equal(r.frontRatio,'auto','no fixed-ratio card frame');
    if(n<cols)assert.ok(Math.abs(r.y-rects[0].y)<1,'first cards begin at the gallery top');
    else {
     const gap=r.y-rects[n-cols].bottom;
     assert.ok(gap>=7.5 && gap<14.5,'column-local normal gap, never waits for tallest card: '+gap);
    }
    if(r.imageRatio){const [w,h]=r.declaredRatio.split('/').map(Number);assert.ok(Math.abs(r.imageRatio-w/h)<0.025,'image uses its natural aspect ratio, no contain frame or crop');}
   }
   return rects;
  };
  await waitLayout(14,7);let rects=await assertQueueColumns(7,sizes.slice(0,10).map((_,n)=>id(n)));
  assert.deepEqual(rects.slice(7,10).map(r=>r.number),['8','9','10']);
  assert.ok(rects[7].x<rects[8].x && rects[8].x<rects[9].x,'8/9/10 occupy adjacent left-to-right columns');
  assert.ok(Math.max(...rects.slice(0,7).map(r=>r.height))-Math.min(...rects.slice(0,7).map(r=>r.height))>100,'natural mixed heights, not equal-height cards');
  assert.ok(rects[7].y<Math.max(...rects.slice(0,7).map(r=>r.bottom))-120,'short first column packs without row-sized whitespace');
  await page.locator('[data-reverse-id="queue-1"]').evaluate(node=>window.savedQueue=node);
  if(process.env.DFLOW_QA_OUTPUT){await fs.mkdir(process.env.DFLOW_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.DFLOW_QA_OUTPUT,'pending-natural-columns.png'),fullPage:true});}
  for(const [width,cols] of [[900,3],[620,2],[380,1],[1800,7]]){
   await page.setViewportSize({width,height:1200});await waitLayout(14,cols);await assertQueueColumns(cols,sizes.slice(0,10).map((_,n)=>id(n)));
   assert.equal(await page.locator('[data-reverse-id="queue-1"]').evaluate(node=>node===window.savedQueue),true);
  }
  // A height change repacks only the affected column, never changes queue lanes.
  await page.locator('[data-reverse-id="queue-1"] .art-img').evaluate(node=>{node.style.aspectRatio='1 / 8';});
  await waitLayout(14,7);
  await assertQueueColumns(7,sizes.slice(0,10).map((_,n)=>id(n)));
  await page.locator('[data-reverse-id="local_queue-0"] .round-arrow-btn').click();await waitLayout(13,7);
  await page.waitForFunction(()=>document.querySelector('[data-reverse-id="queue-1"] .round-queue-btn').textContent==='1');
  await assertQueueColumns(7,sizes.slice(1,10).map((_,n)=>id(n+1)));
  // Pausing and re-enabling moves the item to the queue's tail, still in fixed-column rounds.
  await page.locator('[data-reverse-id="queue-1"] .round-queue-btn').click();
  await page.waitForFunction(()=>document.querySelector('[data-reverse-id="queue-1"] .round-queue-btn').textContent==='+');
  await assertQueueColumns(7,sizes.slice(2,10).map((_,n)=>id(n+2)));
  await page.locator('[data-reverse-id="queue-1"] .round-queue-btn').click();
  await page.waitForFunction(()=>document.querySelector('[data-reverse-id="queue-1"] .round-queue-btn').textContent==='9');
  await assertQueueColumns(7,[...sizes.slice(2,10).map((_,n)=>id(n+2)),id(1)]);
  assert.equal(errors.length,0,errors.join('\n'));
 }finally{await browser?.close();await f.close();}
});

test('real browser: local cards load half-size thumbnails, lightbox loads originals and notices collapse/scroll',{timeout:30000,skip:!browserPath},async()=>{
 const f=await fixture({favorites:[favorite('local-preview','completed',0,{prompt:'Test prompt',image_width:1200,image_height:800}),favorite('local-original','original',0,{image_width:1200,image_height:800})],entries:[entry('preview-manual','worded',0,{width:800,height:1200})]});
 let browser;const requests=[];
 try{
  const {default:sharp}=await import('sharp');
  const landscape=await sharp({create:{width:1200,height:800,channels:3,background:'#357baa'}}).png().toBuffer();
  await fs.writeFile(path.join(f.data,'favorites','completed','local-preview.png'),landscape);
  await fs.writeFile(path.join(f.data,'favorites','original','local-original.png'),landscape);
  await fs.writeFile(path.join(f.data,'favorites','worded','preview-manual.png'),await sharp({create:{width:800,height:1200,channels:3,background:'#aa7535'}}).png().toBuffer());
  browser=await chromium.launch({executablePath:browserPath,headless:true});const page=await browser.newPage({viewport:{width:1400,height:1000}});
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===f.base || ['blob:','data:'].includes(url.protocol)?route.continue():route.abort();});
  page.on('request',r=>{const url=new URL(r.url());if(/^\/api\/(reverse\/image|worded\/images)\//.test(url.pathname))requests.push(url);});
  await page.goto(f.base);await page.locator('[data-mode="favorites"]').click();
  await page.locator('#favoriteFolders [data-folder="completed"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-reverse-id="local-preview"] .art-img')?.naturalWidth===600);
  assert.equal(requests.filter(u=>u.pathname.endsWith('/local-preview')).every(u=>u.searchParams.get('thumbnail')==='1'),true,'card and background never decode the HD original');
  await page.locator('[data-reverse-id="local-preview"] button[title="查看高清大图"]').click();
  await page.waitForFunction(()=>document.querySelector('#lightboxImage').naturalWidth===1200 && !new URL(document.querySelector('#lightboxImage').src).searchParams.has('thumbnail'));
  await page.keyboard.press('Escape');
  await page.locator('#favoriteFolders [data-folder="worded"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-reverse-id="preview-manual"] .art-img')?.naturalWidth===400);
  await page.locator('[data-reverse-id="preview-manual"] button[title="查看高清大图"]').click();
  await page.waitForFunction(()=>document.querySelector('#lightboxImage').naturalHeight===1200 && !new URL(document.querySelector('#lightboxImage').src).searchParams.has('thumbnail'));
  await page.keyboard.press('Escape');
  await page.locator('#favoriteFolders [data-folder="original"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-favorite-id="local-original"] img')?.naturalWidth===600);
  await page.locator('article[data-favorite-id="local-original"]').click();
  await page.waitForFunction(()=>document.querySelector('#lightboxImage').naturalWidth===1200 && !new URL(document.querySelector('#lightboxImage').src).searchParams.has('thumbnail'));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>document.querySelector('#updateDialog').showModal());
  assert.equal(await page.locator('.update-notes-container').evaluate(n=>n.open),false);
  const collapsed=await page.locator('#updateDialog').boundingBox();
  await page.locator('.update-notes-title').click();
  assert.equal(await page.locator('.update-notes-container').evaluate(n=>n.open),true);
  const versions=await page.locator('.update-notes-item strong').allTextContents();
  assert.match(versions[0],/^v0\.3\.8/);assert.match(versions[1],/^v0\.3\.7/);assert.match(versions.at(-1),/^v0\.3\.0/);
  assert.equal(await page.locator('.update-notes-list').evaluate(n=>{n.scrollTop=n.scrollHeight;return n.scrollHeight>n.clientHeight && n.scrollTop>0;}),true);
  const expanded=await page.locator('#updateDialog').boundingBox();assert.ok(expanded.height>collapsed.height);
  if(process.env.DFLOW_QA_OUTPUT){await fs.mkdir(process.env.DFLOW_QA_OUTPUT,{recursive:true});await page.locator('.update-notes-list').evaluate(n=>n.scrollTop=0);await page.screenshot({path:path.join(process.env.DFLOW_QA_OUTPUT,'update-notices-expanded.png')});}
  await page.locator('.update-notes-title').click();assert.equal(await page.locator('.update-notes-container').evaluate(n=>n.open),false);
 }finally{await browser?.close();await f.close();}
});
