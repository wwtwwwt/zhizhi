import { spawn } from 'node:child_process';
const env={...process.env,ZHIZHI_DESKTOP_DEV:'1'};
delete env.ELECTRON_RUN_AS_NODE;
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:'inherit',env});
let desktop;
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;vite.kill('SIGTERM');desktop?.kill('SIGTERM');process.exitCode=code;}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
vite.on('exit',code=>stop(code||0));
try{
  let ready=false;
  for(let i=0;i<100;i++){
    if(stopping)break;
    try{const response=await fetch('http://127.0.0.1:5174');if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready)throw new Error('Vite 启动超时');
  const {default:electron}=await import('electron');
  desktop=spawn(electron,['.'],{stdio:'inherit',env});
  desktop.on('exit',code=>stop(code||0));
  desktop.on('error',error=>{console.error(error);stop(1);});
}catch(error){console.error(error);stop(1);}
