/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Reproducible browser screenshots of the ACTUAL built Pocket-T Svelte app.
 *
 * Only the machine/WebSocket payloads are fixtures. No Mac, SSH session,
 * credentials or real terminal is accessed. Fixture terminal text is clearly
 * identified in the screenshots. This script runs in GitHub Actions and
 * writes a ZIP-uploadable set of PNG screenshots for design review.
 *
 * Requires a built packages/web-client/dist and ephemeral CI dependencies:
 * PLAYWRIGHT_MODULE=/tmp/pt-visual/node_modules/playwright
 * WS_MODULE=/tmp/pt-visual/node_modules/ws
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/tmp/pt-visual/node_modules/playwright');
const { WebSocketServer } = require(process.env.WS_MODULE || '/tmp/pt-visual/node_modules/ws');

const root = path.resolve(__dirname, '../dist');
const output = path.resolve(process.env.POCKET_T_SHOT_DIR || 'ui-screenshots');
fs.mkdirSync(output, { recursive: true });

function eventFrame(type, sessionId, payload) {
  const sid = Buffer.from(sessionId || '', 'utf8');
  const body = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const out = Buffer.alloc(12 + sid.length + body.length);
  out.writeUInt16LE(0x5450, 0);
  out.writeUInt8(3, 2);
  out.writeUInt8(type, 3);
  out.writeUInt32LE(sid.length, 4);
  sid.copy(out, 8);
  out.writeUInt32LE(body.length, 8 + sid.length);
  body.copy(out, 12 + sid.length);
  return out;
}

function decode(buf) {
  if (buf.length < 12 || buf.readUInt16LE(0) !== 0x5450 || buf.readUInt8(2) !== 3) return null;
  const sidLen = buf.readUInt32LE(4);
  if (sidLen > 1000 || 12 + sidLen > buf.length) return null;
  const sid = buf.subarray(8, 8 + sidLen).toString('utf8');
  const len = buf.readUInt32LE(8 + sidLen);
  if (12 + sidLen + len > buf.length) return null;
  return { type: buf.readUInt8(3), sessionId: sid, payload: buf.subarray(12 + sidLen, 12 + sidLen + len) };
}

const now = Date.now();
const sessions = [
  { sessionId:'pt-demo-001', cwd:'/Users/demo/Projects/pocket-t', pid:4281, rows:35, cols:105, shell:'/bin/zsh', registeredAt:now-100000, lastActiveAt:now-5000, bytesIn:12000, bytesOut:400, exitCode:null, vendor:null, detached:false, pendingApprovals:0 },
  { sessionId:'pt-demo-002', cwd:'/Users/demo/Projects/atlas', pid:4700, rows:35, cols:105, shell:'/bin/zsh', registeredAt:now-60000, lastActiveAt:now-20000, bytesIn:45000, bytesOut:2000, exitCode:null, vendor:'claude', detached:false, pendingApprovals:0 },
  { sessionId:'join-demo-003', cwd:'/Users/demo/Projects/api-server', pid:4960, rows:35, cols:105, shell:'/bin/zsh', registeredAt:now-18000, lastActiveAt:now-22000, bytesIn:1000, bytesOut:100, exitCode:null, vendor:null, detached:false, pendingApprovals:0 },
];
const inventory = [
  { sessionId:'existing:tmux:%1', source:'tmux', title:'server / dev', cwd:'/Users/demo/Projects/server', pane:'%1', tmuxSession:'server', capabilities:['discover','join'] },
  { sessionId:'existing:terminal:/dev/ttys001', source:'terminal', title:'Terminal — deploy', cwd:'', tty:'/dev/ttys001', capabilities:['discover'] },
  { sessionId:'existing:iterm2:/dev/ttys005', source:'iterm2', title:'iTerm2 — analytics', cwd:'', tty:'/dev/ttys005', capabilities:['discover'] }
];
const screenshotText = [
 '\x1b[38;5;115mPOCKET-T · PREVIEW SESSION / SAMPLE OUTPUT\x1b[0m',
 '',
 '\x1b[38;5;250mdemo@macbook\x1b[0m \x1b[38;5;114m~/Projects/pocket-t\x1b[0m % git status -sb',
 '\x1b[38;5;111m## design/aurora-workspace-2028\x1b[0m',
 '',
 '\x1b[38;5;250mdemo@macbook\x1b[0m \x1b[38;5;114m~/Projects/pocket-t\x1b[0m % pnpm test',
 '',
 ' RUN  v1.6.1',
 '',
 ' \x1b[32m✓\x1b[0m shared/ws-v3.test.ts                 9 passed',
 ' \x1b[32m✓\x1b[0m daemon/existing-terminals.test.ts   5 passed',
 ' \x1b[32m✓\x1b[0m daemon/state.test.ts               17 passed',
 '',
 ' \x1b[38;5;114mTest files: 3 passed\x1b[0m',
 ' \x1b[38;5;114mDuration: 1.42s\x1b[0m',
 '',
 '\x1b[38;5;250mdemo@macbook\x1b[0m \x1b[38;5;114m~/Projects/pocket-t\x1b[0m % ',
].join('\r\n');

const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.ico':'image/x-icon','.woff2':'font/woff2'};
const server = http.createServer((req,res) => {
  let requested;
  try { requested = decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
  catch {res.writeHead(400);res.end();return;}
  let resolved = path.resolve(root, '.' + requested);
  if (resolved === root) resolved = path.join(root,'index.html');
  if (!resolved.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
  try {
    const data = fs.readFileSync(resolved);
    res.writeHead(200,{'Content-Type': mime[path.extname(resolved)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  } catch {res.writeHead(404);res.end('Not found: '+requested);}
});
const wss = new WebSocketServer({server, path:'/ws'});
wss.on('connection',(ws)=>{
  const send=(type,id,payload)=>ws.readyState===1 && ws.send(eventFrame(type,id,payload));
  ws.on('message',(raw)=>{
    const f=decode(Buffer.from(raw));
    if(!f)return;
    if(f.type===1) { // HELLO
      send(2,'',{kind:'welcome',version:3});
      for (const s of sessions) send(22,s.sessionId,{kind:'sessionAdded',session:s});
    } else if(f.type===10){ // SUBSCRIBE
      const title = f.sessionId === 'pt-demo-002' ? '\x1b[38;5;115mATLAS AGENT · PREVIEW SESSION / SAMPLE OUTPUT\x1b[0m\r\n\r\nThis is a simulated agent terminal for visual review.\r\n' : screenshotText;
      send(21,f.sessionId,title);
    } else if(f.type===22){
      let msg;try {msg=JSON.parse(f.payload.toString('utf8'))} catch {return;}
      if (msg.kind==='discoverExistingTerminals') send(22,'',{kind:'existingTerminals',sessions:inventory});
      if (msg.kind==='listFileRoots') send(22,'',{kind:'fileRoots',roots:[{id:'1000000000000001',label:'Projects'},{id:'1000000000000002',label:'Documents'}]});
      if (msg.kind==='browseFiles'){
        send(22,'',{kind:'fileListing',requestId:msg.requestId,listing:{rootId:msg.rootId,relativePath:msg.relativePath || '',truncated:false,
          entries:[
            {name:'pocket-t',relativePath:'pocket-t',kind:'directory',size:null,modifiedAt:now},
            {name:'atlas',relativePath:'atlas',kind:'directory',size:null,modifiedAt:now},
            {name:'silvervolt-hq',relativePath:'silvervolt-hq',kind:'directory',size:null,modifiedAt:now},
            {name:'README.md',relativePath:'README.md',kind:'file',size:9247,modifiedAt:now},
            {name:'package.json',relativePath:'package.json',kind:'file',size:1120,modifiedAt:now},
          ]
        }});
      }
      if (msg.kind==='listApprovedApps') send(22,'',{kind:'approvedApps',apps:[{name:'Safari',bundleId:'com.apple.Safari'},{name:'Terminal',bundleId:'com.apple.Terminal'}]});
    } else if (f.type===40) send(41,'','');
  });
});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const url='http://127.0.0.1:'+port+'/?t=visual-preview';
  const bins=['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
  const executablePath=bins.find(candidate=>fs.existsSync(candidate));
  if(!executablePath)throw new Error('No system Chrome/Chromium installed on CI runner');
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const failures=[];

  async function makePage(name,viewport,action){
    const mobile=viewport.width<500;
    const context=await browser.newContext({
      viewport,deviceScaleFactor:2,isMobile:mobile,hasTouch:mobile,
      colorScheme:'light',reducedMotion:'reduce',
    });
    const page=await context.newPage();
    page.on('pageerror',error=>failures.push(name+': '+error.message));
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
    await page.waitForTimeout(1000);
    if(action==='session'){
      await page.getByRole('button',{name:'Continue session'}).click();
      await page.locator('.terminal-host').waitFor({timeout:12000});
      await page.waitForTimeout(800);
    }else if(action==='sessions'){
      await page.getByRole('button',{name:'Continue session'}).click();
      await page.getByRole('button',{name:'Choose terminal session'}).click();
      await page.getByRole('button',{name:/Scan/}).last().click();
      await page.waitForTimeout(500);
    }else if(action==='files'){
      if(mobile) await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Files'}).click();
      else await page.getByRole('navigation',{name:'Workspaces'}).getByRole('button',{name:'Files'}).click();
      await page.waitForTimeout(500);
    }else if(action==='palette'){
      await page.getByRole('button',{name:'Open command palette'}).first().click();
      await page.getByRole('dialog',{name:'Quick commands'}).waitFor({timeout:5000});
      await page.waitForTimeout(300);
    }

    // The interface is the exact built app; only WS/machine state is fake.
    // Clearly mark the screenshot rather than passing fixture data off as real.
    await page.evaluate(()=>{
      const tag=document.createElement('div');
      tag.textContent='INTERFACE PREVIEW  ·  SIMULATED SESSION DATA';
      Object.assign(tag.style,{
        position:'fixed',zIndex:'9999',left:'12px',top:'10px',
        fontFamily:'system-ui,sans-serif',fontSize:'9px',fontWeight:'800',
        letterSpacing:'1px',color:'#272747',background:'#f5f3ffeb',
        padding:'6px 9px',border:'1px solid #9b9ae5',
        borderRadius:'999px',pointerEvents:'none',
      });
      document.body.appendChild(tag);
    });
    await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});
    const result={name,title:await page.title(),width:viewport.width,height:viewport.height};
    console.log('visual-check:',JSON.stringify(result));
    await context.close();
  }
  try{
    await makePage('01-iphone-overview',{width:393,height:852},null);
    await makePage('02-iphone-live-session',{width:393,height:852},'session');
    await makePage('03-iphone-session-picker',{width:393,height:852},'sessions');
    await makePage('04-iphone-files',{width:393,height:852},'files');
    await makePage('05-desktop-overview',{width:1440,height:900},null);
    await makePage('06-desktop-live-session',{width:1440,height:900},'session');
    await makePage('07-desktop-command-palette',{width:1440,height:900},'palette');
    await fs.promises.writeFile(path.join(output,'README.txt'),
      'Actual compiled Pocket-T Svelte UI, design/aurora-workspace-2028.\n'+
      'Terminal sessions and machine events are mock WebSocket test fixtures.\n'+
      'Screenshots taken by headless Chromium/Playwright in GitHub Actions.\n');
    if(failures.length){console.error('Browser errors:',failures.join('\n'));process.exitCode=1;}
    else console.log('Visual QA successful:',fs.readdirSync(output).join(', '));
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
    wss.close();
  }
})().catch(error=>{console.error(error);process.exit(1)});
