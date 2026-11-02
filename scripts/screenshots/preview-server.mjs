/**
 * Screenshot-only preview of the actual built Pocket-T Svelte app.
 * Uses simulated WS-v3 sessions, not a real Mac. Localhost only.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(new URL('../../packages/daemon/package.json', import.meta.url));
const { WebSocketServer } = req('ws');
const root = path.resolve('packages/web-client/dist');
const port = Number(process.env.PREVIEW_PORT || 4173);
const encoder = new TextEncoder();
const now = Date.now();
const sessionInfo = (id, cwd, vendor, age) => ({
  sessionId:id, cwd, pid:10830 + age, rows:28, cols:92, shell:'/bin/zsh',
  registeredAt:now-age*60_000,lastActiveAt:now-age*10000,bytesIn:5200,
  bytesOut:800,exitCode:null,vendor,detached:false,pendingApprovals:0,
});
const sessions=[
  sessionInfo('demo-pty-pocket','/Users/demo/Projects/pocket-t',null,1),
  sessionInfo('demo-pty-city','/Users/demo/Projects/city-studio','codex',10),
  sessionInfo('demo-pty-silvervolt','/Users/demo/Projects/silvervolt',null,5),
];
const vt={
  'demo-pty-pocket': [
    '\x1b[38;5;245mLast login: Mon Nov  2 21:40:08 on ttys004\x1b[0m',
    '',
    '\x1b[1;38;5;121mpocket-t\x1b[0m \x1b[38;5;244m/ terminal-first development\x1b[0m',
    '',
    '\x1b[38;5;110m~/Projects/pocket-t\x1b[0m \x1b[1;38;5;121m❯\x1b[0m git status --short',
    '\x1b[38;5;222m M\x1b[0m packages/web-client/src/App.svelte',
    '\x1b[38;5;222m M\x1b[0m packages/web-client/src/components/TerminalView.svelte',
    '\x1b[38;5;222m M\x1b[0m packages/pt-shim/src/main.rs',
    '',
    '\x1b[38;5;110m~/Projects/pocket-t\x1b[0m \x1b[1;38;5;121m❯\x1b[0m pnpm test',
    '',
    '\x1b[38;5;121m ✓\x1b[0m shared tests passed',
    '\x1b[38;5;121m ✓\x1b[0m web client checks passed',
    '\x1b[38;5;121m ✓\x1b[0m daemon tests passed',
    '',
    '\x1b[38;5;244mFinished in 4.28s\x1b[0m',
    '',
    '\x1b[38;5;110m~/Projects/pocket-t\x1b[0m \x1b[1;38;5;121m❯\x1b[0m ',
  ].join('\r\n'),
  'demo-pty-city': [
    '\x1b[1;38;5;121m◇ Codex CLI\x1b[0m   city-studio', '',
    '• Inspecting component dependencies',
    '• Reviewing browser capture',
    '• Waiting for next request',
    '',
    '\x1b[38;5;110m~/Projects/city-studio\x1b[0m \x1b[38;5;121m❯\x1b[0m ',
  ].join('\r\n'),
  'demo-pty-silvervolt': [
    '\x1b[38;5;110m~/Projects/silvervolt\x1b[0m \x1b[38;5;121m❯\x1b[0m npm run dev',
    'VITE ready in 310ms',
    '➜ Local: http://localhost:5173/',
    'Press q to quit',
  ].join('\r\n'),
};
const types={HELLO:1,WELCOME:2,SUBSCRIBE:10,SNAPSHOT:21,EVENT:22,PING:40,PONG:41};
function pack(type,sid='',payload=new Uint8Array()){
  const name=encoder.encode(sid);
  const out=new Uint8Array(12+name.length+payload.length);
  const dv=new DataView(out.buffer);
  dv.setUint16(0,0x5450,true); dv.setUint8(2,3); dv.setUint8(3,type);
  dv.setUint32(4,name.length,true);out.set(name,8);
  dv.setUint32(8+name.length,payload.length,true);out.set(payload,12+name.length);
  return out;
}
function unpack(input){
  const b=Buffer.from(input);
  if(b.length<12 || b.readUInt16LE(0)!==0x5450)return null;
  const n=b.readUInt32LE(4);
  if(n>256||b.length<12+n)return null;
  const len=b.readUInt32LE(8+n);
  if(b.length<12+n+len)return null;
  return {type:b[3],sid:b.subarray(8,8+n).toString(),payload:b.subarray(12+n,12+n+len)};
}
const sendEvent=(ws,json,sid='')=>ws.send(pack(types.EVENT,sid,encoder.encode(JSON.stringify(json))));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.png':'image/png','.svg':'image/svg+xml','.json':'application/json',
  '.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
const server=http.createServer((request,response)=>{
  let requested;
  try{requested=decodeURIComponent((request.url||'/').split('?')[0]);}
  catch{response.writeHead(400);response.end();return;}
  const loc=path.resolve(root,requested==='/'?'index.html':requested.replace(/^\/+/,''));
  if(loc!==root&&!loc.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
  const file=fs.existsSync(loc)&&fs.statSync(loc).isFile()?loc:path.join(root,'index.html');
  try{response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});response.end(fs.readFileSync(file));}
  catch{response.writeHead(404);response.end();}
});
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',(ws)=>{
  let sent=false;
  ws.on('message',(input)=>{
    const frame=unpack(input);
    if(!frame)return;
    if(frame.type===types.HELLO&&!sent){
      sent=true;ws.send(pack(types.WELCOME));
      for(const s of sessions)sendEvent(ws,{kind:'sessionAdded',session:s},s.sessionId);
    }
    if(frame.type===types.SUBSCRIBE){
      ws.send(pack(types.SNAPSHOT,frame.sid,encoder.encode(vt[frame.sid]||'')));
      if(frame.sid==='demo-pty-city'){
        sendEvent(ws,{kind:'bubble',sessionId:frame.sid,event:{kind:'chat',role:'assistant',text:'Sample agent status: Reviewing project files.',timestamp:now}},frame.sid);
      }
    }
    if(frame.type===types.PING)ws.send(pack(types.PONG));
    if(frame.type===types.EVENT){
      try{
        const obj=JSON.parse(frame.payload.toString());
        if(obj.kind==='listFileRoots')sendEvent(ws,{kind:'fileRoots',roots:[{id:'demo-root',label:'Projects'}]});
        if(obj.kind==='browseFiles')sendEvent(ws,{kind:'fileListing',requestId:obj.requestId,listing:{
          rootId:'demo-root',relativePath:obj.relativePath||'',truncated:false,entries:[
            {name:'pocket-t',relativePath:'pocket-t',kind:'directory',size:null,modifiedAt:null},
            {name:'city-studio',relativePath:'city-studio',kind:'directory',size:null,modifiedAt:null},
            {name:'README.md',relativePath:'README.md',kind:'file',size:12910,modifiedAt:now},
          ],
        }});
        if(obj.kind==='listApprovedApps')sendEvent(ws,{kind:'approvedApps',apps:[
          {name:'Safari',bundleId:'com.apple.Safari'},
          {name:'Terminal',bundleId:'com.apple.Terminal'},
        ]});
        if(obj.kind==='discoverExistingTerminals')sendEvent(ws,{kind:'existingTerminals',sessions:[
          {sessionId:'existing:tmux:%0',source:'tmux',title:'work / dev',pane:'%0',cwd:'/Users/demo/Projects',tmuxSession:'work',capabilities:['discover','join']},
        ]});
      }catch{/* Not part of screenshot fixture. */}
    }
  });
});
server.listen(port,'127.0.0.1',()=>console.log('Pocket-T demo preview: http://127.0.0.1:'+port));
process.on('SIGTERM',()=>server.close());
