/**
 * Pocket Studio PWA mark: an iridescent faceted prism, not a CLI prompt.
 * Pure PNG generator with no remote fonts, copyrighted images or service
 * dependencies. Works in CI on Node 22.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });
const mix = (a,b,t) => a*(1-t)+b*t;
function clamp(n) { return Math.min(1, Math.max(0,n)); }
function blend(a,b,t) { return a.map((v,i)=>mix(v,b[i],clamp(t))); }

function crc32(buf) {
  let c=~0;
  for(let i=0;i<buf.length;i++){
    c^=buf[i];
    for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));
  }
  return ~c>>>0;
}
function chunk(type,data){
  const length=Buffer.alloc(4);length.writeUInt32BE(data.length,0);
  const payload=Buffer.concat([Buffer.from(type,'ascii'),data]);
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(payload),0);
  return Buffer.concat([length,payload,crc]);
}
function colorAt(u,v){
  const radial=clamp(1-Math.hypot(u-.7,v-.23)*1.5);
  let color=blend([44,39,103],[114,88,212],clamp(.32+v*.38+radial*.34));
  // Slightly raised central glass prism with two distinct facets.
  const dx=(u-.5)*1.05, dy=(v-.505)*1.05;
  const diamond=Math.abs(dx)+Math.abs(dy);
  const inside=diamond<.3;
  const edge=diamond>.27 && diamond<.32;
  if(edge)color=blend(color,[207,199,255],clamp((.32-diamond)/.05));
  if(inside){
    const left=dx<0;
    const upper=dy<0;
    const highlight=clamp(.65-v*.42+(.3-dx)*.2);
    color=left
      ? blend([189,200,255],[255,250,255],highlight*.75)
      : blend([113,115,232],[198,191,255],highlight*.55);
    if(upper && Math.abs(dx)<.21)color=blend(color,[237,237,255],.18);
  }
  // Luminous specular highlight.
  const glint=Math.hypot((u-.41)*1.7,(v-.32)*2.1);
  color=blend(color,[255,255,255],clamp((.092-glint)*3.3));
  return color;
}
function png(size){
  const raw=Buffer.alloc(size*(size*3+1));
  let p=0;
  for(let y=0;y<size;y++){
    raw[p++]=0;
    for(let x=0;x<size;x++){
      const rgb=colorAt((x+.5)/size,(y+.5)/size);
      for(let i=0;i<3;i++)raw[p++]=Math.round(clamp(rgb[i]/255)*255);
    }
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);
  ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(raw,{level:9})),
    chunk('IEND',Buffer.alloc(0))
  ]);
}
writeFileSync(join(OUT,'icon-192.png'),png(192));
writeFileSync(join(OUT,'icon-512.png'),png(512));
writeFileSync(join(OUT,'icon-maskable-512.png'),png(512));
console.log('Pocket Studio iridescent icons written to',OUT);
