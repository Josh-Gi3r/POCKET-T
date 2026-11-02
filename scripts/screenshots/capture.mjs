/**
 * Browser screenshots of the real built Pocket-T client.
 * A deterministic local websocket fixture supplies SAMPLE SESSION DATA.
 * No AI image generation or production Mac is involved.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const requirePw = createRequire('/tmp/pocket-t-preview-playwright/package.json');
const { chromium } = requirePw('playwright');

const output = 'screenshots';
fs.mkdirSync(output,{recursive:true});
const failures=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

async function createPage({width,height,dpr=2,mobile=false}) {
  const context=await browser.newContext({
    viewport:{width,height},
    deviceScaleFactor:dpr,
    isMobile:mobile,
    hasTouch:mobile,
    locale:'en-US',
    colorScheme:'dark',
    reducedMotion:'reduce',
  });
  const page=await context.newPage();
  page.on('pageerror',(error)=>failures.push(error.stack||error.message));
  page.on('console',(msg)=>{if(msg.type()==='error')failures.push('Console: '+msg.text());});
  await page.goto('http://127.0.0.1:4173/?t=demo', {waitUntil:'domcontentloaded'});
  await page.locator('.terminal-stage').waitFor({timeout:12000});
  await page.locator('.terminal-host .xterm-screen').waitFor({timeout:12000});
  await page.waitForTimeout(1400);
  return {page,context};
}

try {
  const mobile=await createPage({width:393,height:852,dpr:2,mobile:true});
  await mobile.page.screenshot({path:output+'/01-mobile-live-terminal.png',animations:'disabled'});
  console.log('CAPTURED 01-mobile-live-terminal.png');
  await mobile.page.getByRole('button',{name:'Choose terminal session'}).click();
  await mobile.page.getByRole('button',{name:'Scan'}).last().click();
  await mobile.page.waitForTimeout(350);
  await mobile.page.screenshot({path:output+'/02-mobile-session-switcher.png',animations:'disabled'});
  console.log('CAPTURED 02-mobile-session-switcher.png');
  await mobile.page.getByRole('button',{name:'Close session selector'}).click();
  await mobile.page.getByRole('button',{name:'Open navigation'}).click();
  await mobile.page.getByRole('button',{name:'Files',exact:true}).click();
  await mobile.page.waitForTimeout(350);
  await mobile.page.screenshot({path:output+'/03-mobile-files.png',animations:'disabled'});
  console.log('CAPTURED 03-mobile-files.png');
  await mobile.page.getByRole('button',{name:'Open navigation'}).click();
  await mobile.page.getByRole('button',{name:'Applications',exact:true}).click();
  await mobile.page.waitForTimeout(350);
  await mobile.page.screenshot({path:output+'/04-mobile-apps.png',animations:'disabled'});
  console.log('CAPTURED 04-mobile-apps.png');
  await mobile.context.close();

  const desktop=await createPage({width:1440,height:900,dpr:1,mobile:false});
  await desktop.page.screenshot({path:output+'/05-desktop-live-terminal.png',animations:'disabled'});
  console.log('CAPTURED 05-desktop-live-terminal.png');
  await desktop.context.close();
} finally {
  await browser.close();
}
const record=[
  'REAL rendered Pocket-T web client build, with SIMULATED SAMPLE terminal sessions.',
  'No live Mac connection. No screenshot is a claim that native tmux joining was verified.',
  'Viewport: iPhone-class 393x852 @2x DPR; desktop 1440x900.',
  'Browser: Playwright Chromium. Date: '+new Date().toISOString(),
  'Runtime errors: '+failures.length,
  ...failures.slice(0,30),
].join('\n');
fs.writeFileSync(output+'/SOURCE-NOTES.txt',record);
console.log(record);
if(failures.length>0)process.exitCode=1;
