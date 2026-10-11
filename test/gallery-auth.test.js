import test from 'node:test';
import assert from 'node:assert/strict';
import {compareGalleryItems,comparePendingRows,responsiveColumnCount,displayQueueOrder,galleryItemTime,compactRowSpan,queueGridPlacements} from '../public/gallery-rules.js';
import {danbooruCredentials,normalizePixivCookie,authFailure} from '../auth.js';
import {proxyUrl} from '../network.js';
test('all non-pending folders: landscape first, newest prompt first, never completion time',()=>{
 const rows=[{id:'portrait-new',width:400,height:800,promptWrittenAt:'2026-10-10'},{id:'landscape-old',width:800,height:400,promptWrittenAt:'2026-01-01',completedAt:'2026-10-11'},{id:'landscape-new',image_width:800,image_height:400,promptWrittenAt:'2026-02-01'}];
 for(const folder of ['original','worded','completed'])assert.deepEqual(rows.slice().sort((a,b)=>compareGalleryItems(a,b,folder)).map(x=>x.id),['landscape-new','landscape-old','portrait-new']);
 assert.equal(galleryItemTime({wordedAt:'2026-01-01',completedAt:'2026-10-11'}),Date.parse('2026-01-01'));
});
test('pending mixes both storage kinds strictly by valid queue order, disabled last',()=>{
 const rows=[{queueOrder:2},{queueOrder:1},{queueOrder:0,autoEnabled:false},{queueOrder:Date.now()},{queueOrder:3}].map((value,index)=>({value,index}));
 assert.deepEqual(rows.sort(comparePendingRows).map(x=>x.index),[1,0,4,3,2]);
 for(const order of [0,-1,1.2,Date.now(),Infinity,'invalid'])assert.equal(displayQueueOrder(order),null);
 assert.equal(displayQueueOrder('3'),3);
});
test('column counts shrink/expand with width while respecting saved preference',()=>{
 assert.deepEqual([1600,1000,700,400,1600].map(width=>responsiveColumnCount(width,5)),[5,4,3,1,5]);
 assert.equal(responsiveColumnCount(2000,3),3);assert.equal(responsiveColumnCount(0,8),1);
});
test('Chinese login uses JSON or encoded legacy header without byte-string errors',()=>{
 const credentials=danbooruCredentials({method:'POST',body:{loginName:' 测试用户 ',loginKey:' key '},get:()=>undefined},{loginName:'old'});
 assert.deepEqual(credentials,{username:'测试用户',apiKey:'key'});
 const headers={'X-Danbooru-Username':encodeURIComponent('测试用户'),'X-Danbooru-Key':'key','X-DFlow-Auth-Encoding':'uri'};
 assert.deepEqual(danbooruCredentials({method:'GET',get:name=>headers[name]}),credentials);
 assert.equal(danbooruCredentials({method:'POST',body:{},get:()=>undefined},{loginName:'old',loginKey:'old'}).username,'');
});
test('cookie, proxy and auth failures normalize without confusing network with password',()=>{
 for(const input of ['123_secret','PHPSESSID=123_secret','other=1; PHPSESSID=123_secret; lang=zh'])assert.equal(normalizePixivCookie(input),'PHPSESSID=123_secret');
 assert.equal(proxyUrl('127.0.0.1:7890'),'http://127.0.0.1:7890/');
 assert.equal(proxyUrl('http=127.0.0.1:8888;https=127.0.0.1:7890'),'http://127.0.0.1:7890/');
 assert.equal(proxyUrl('socks5://127.0.0.1:1234'),'');assert.equal(proxyUrl('not a url'),'');
 assert.match(authFailure(401),/API Key/);assert.match(authFailure(403,{},true),/防护/);assert.match(authFailure(403),/IP/);assert.match(authFailure(429),/频繁/);
});

test('compact row spans leave only the requested gap plus sub-row rounding',()=>{
 for(const height of [0,149,240.5,335,440.25,800])for(const gap of [8,10]){
  const packed=compactRowSpan(height,4,gap)*4;assert.ok(packed-height>=gap);assert.ok(packed-height<gap+4);
 }
 assert.equal(compactRowSpan(240,4,10),63);assert.equal(compactRowSpan(440,4,10),113);
});

test('queue fixed-column rounds preserve adjacency without height-ranked insertion',()=>{
 const spans=[45,93,81,82,112,88,106,85,82,113,150,120,90,80,60];
 for(const cols of [7,3,2,1]){
  const placements=queueGridPlacements(spans,cols),bottoms=Array(cols).fill(1);
  placements.forEach(({column,row},index)=>{
   assert.equal(column,index%cols+1);assert.equal(row,bottoms[column-1]);bottoms[column-1]+=spans[index];
  });
 }
 const seven=queueGridPlacements(spans,7);
 assert.deepEqual(seven.slice(7,10),[{column:1,row:46},{column:2,row:94},{column:3,row:82}]);
 assert.deepEqual(queueGridPlacements([4,8],0),[{column:1,row:1},{column:1,row:5}]);
});
