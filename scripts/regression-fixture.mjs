import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomInt} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9f8fSJ8AAAAASUVORK5CYII=','base64');
export async function fixture({favorites=[],entries=[],bridge=false}={}){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dflow-regression-'));
 const data=path.join(temp,'data'), worded=path.join(data,'favorites','worded');
 await fs.mkdir(worded,{recursive:true});
 await fs.writeFile(path.join(worded,'index.json'),JSON.stringify(entries));
 for(const item of entries)if(item.imageExt)await fs.writeFile(path.join(worded,`${item.id}.${item.imageExt}`),png);
 for(const item of favorites)if(item.cacheFile){const dir=path.join(data,'favorites',item.folder);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,item.cacheFile),png);}
 await fs.writeFile(path.join(data,'dflow-state.json'),JSON.stringify({favorites,preferences:{mode:'favorites',columns:5,ratings:['g','s','q','e'],search:'',selectedTags:[]}}));
 const mock=path.join(temp,'mock.mjs');
 await fs.writeFile(mock,`const original=globalThis.fetch;
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(String(input));
  if(url.hostname==='danbooru.donmai.us' && url.pathname==='/profile.json'){
   const key=url.searchParams.get('api_key');
   if(key==='bad')return Response.json({message:'Invalid API key'},{status:401});
   if(key==='restricted')return Response.json({message:'IP not allowed'},{status:403});
   if(key==='html')return new Response('<html>blocked</html>',{status:403});
   if(key==='timeout')throw new TypeError('fetch failed',{cause:{code:'ETIMEDOUT'}});
   if(key==='public')return Response.json([]);
   return Response.json({id:42,name:url.searchParams.get('login')});
  }
  if(!['127.0.0.1','localhost'].includes(url.hostname))return Response.json([]);
  return original(input,options);
 };
 `);
 const messages=[],sockets=new Set();let bridgeServer;
 const endpoint=path.join(temp,'endpoint.json');
 if(bridge){
  bridgeServer=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.setEncoding('utf8');let buffer='';socket.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);messages.push(message);let result={ok:true};if(message.method==='session.list')result={sessions:[{sessionId:'older-chat',runtime:'dsh',title:'Older',orderingTime:'2026-10-10',metadata:{live:true,readOnly:false}},{sessionId:'active-chat',runtime:'dsh',title:'Active',orderingTime:'2026-10-11',metadata:{live:true,readOnly:false}}]};socket.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');}});});
  bridgeServer.listen(0,'127.0.0.1');await once(bridgeServer,'listening');
  await fs.writeFile(endpoint,JSON.stringify({host:'127.0.0.1',port:bridgeServer.address().port,token:'fixture-secret'}));
 }
 // Windows may allocate port 1720 (or another Fetch-forbidden low port) for
 // listen(0). Probe a high port instead so HTTP readiness is actually testable.
 let port;
 for(let attempt=0;attempt<30;attempt++){
  const candidate=randomInt(20000,60000),probe=net.createServer();
  try {probe.listen(candidate,'127.0.0.1');await once(probe,'listening');port=candidate;await new Promise(resolve=>probe.close(resolve));break;}
  catch(error){if(error.code!=='EADDRINUSE' && error.code!=='EACCES')throw error;}
 }
 if(!port)throw Error('Cannot allocate an isolated test port');
 let service,logs='';
 const start=async()=>{service=spawn(process.execPath,['--import',pathToFileURL(mock).href,'server.js'],{cwd:root,env:{...process.env,DFLOW_DATA_DIR:data,DFLOW_NO_SYSTEM_PROXY:'1',HTTP_PROXY:'',HTTPS_PROXY:'',http_proxy:'',https_proxy:'',DFLOW_PROXY:'',DFLOW_DSH_BRIDGE_ENDPOINT:endpoint,DFLOW_DSH_SESSION_ID:'',PORT:String(port),HOST:'127.0.0.1'},windowsHide:true,stdio:['ignore','pipe','pipe']});service.stdout.on('data',c=>logs+=c);service.stderr.on('data',c=>logs+=c);
 for(let n=0;n<80;n++){try{if((await fetch(`http://127.0.0.1:${port}/api/state`)).ok)return;}catch{}await sleep(100);}throw Error('Fixture did not start: '+logs);};
 const stop=async()=>{if(service?.exitCode===null && service.signalCode===null){const exited=once(service,'exit');service.kill();await exited;}};
 const request=(route,body,method=body===undefined?'GET':'POST',headers={})=>fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{await start();}catch(error){await stop();throw error;}
 return {temp,data,port,base:`http://127.0.0.1:${port}`,messages,request,restart:async()=>{await stop();await start();},close:async()=>{await stop();for(const socket of sockets)socket.destroy();if(bridgeServer)await new Promise(resolve=>bridgeServer.close(resolve));await fs.rm(temp,{recursive:true,force:true});}};
}
export const favorite=(id,folder='pending',queueOrder=1,extra={})=>({id,source:'local',folder,queueOrder,autoEnabled:true,cacheFile:`${id}.png`,cacheStatus:'ready',image_width:800,image_height:400,rating:'g',reverseStatus:'idle',createdAt:'2026-01-01',...extra});
export const entry=(id,folder='pending',queueOrder=1,extra={})=>({id,source:'手写',folder,queueOrder,autoEnabled:true,imageExt:'png',width:400,height:800,positive:'Fixture prompt',summary:'Fixture summary',preset:'通用扩写',reversePreset:'通用反推',reverseStatus:'idle',createdAt:'2026-01-01',...extra});
