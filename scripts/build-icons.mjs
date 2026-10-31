import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('build',{recursive:true});
const mark=await readFile('src/assets/zhizhi-mark.svg','utf8');
const inner=mark.replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="48" y="48" width="928" height="928" rx="212" fill="#ffffff"/><g transform="translate(192 192) scale(26.666667)" fill="none" stroke="#626262" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`);
await sharp(svg).png().toFile('build/icon.png');
const png=async size=>sharp(svg).resize(size,size).png().toBuffer();
const chunks=[];
for(const [type,size] of [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]]){
  const data=await png(size),header=Buffer.alloc(8);header.write(type,0,'ascii');header.writeUInt32BE(data.length+8,4);chunks.push(header,data);
}
const payload=Buffer.concat(chunks),header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(payload.length+8,4);
await writeFile('build/icon.icns',Buffer.concat([header,payload]));
const sizes=[16,32,48,64,128,256],images=await Promise.all(sizes.map(png));
const ico=Buffer.alloc(6+16*sizes.length);ico.writeUInt16LE(1,2);ico.writeUInt16LE(sizes.length,4);
let offset=ico.length;
images.forEach((image,index)=>{const p=6+index*16,size=sizes[index];ico[p]=size===256?0:size;ico[p+1]=ico[p];ico.writeUInt16LE(1,p+4);ico.writeUInt16LE(32,p+6);ico.writeUInt32LE(image.length,p+8);ico.writeUInt32LE(offset,p+12);offset+=image.length;});
await writeFile('build/icon.ico',Buffer.concat([ico,...images]));
