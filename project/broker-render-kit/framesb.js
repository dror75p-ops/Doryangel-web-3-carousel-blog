const p=require('puppeteer');const http=require('http');const fs=require('fs');const path=require('path');
const root=__dirname;
const types={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'};
const srv=http.createServer((q,s)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();return}s.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});s.end(d)})});
srv.listen(8767,async()=>{
 const b=await p.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const pg=await b.newPage(); pg.on('pageerror',e=>console.log('pageerror',e.message));
 await pg.setViewport({width:1080,height:1920});
 await pg.goto('http://localhost:8767/'+(process.env.REEL||'reel2.html'),{waitUntil:'networkidle0'});
 await pg.waitForFunction('window.done===true',{timeout:60000});
 const mode=process.argv[2]; const outDir=process.argv[3]; fs.mkdirSync(outDir,{recursive:true});
 const el=await pg.$('#v');
 if(mode==='range'){const fps=24;const a=+process.argv[4],z=+process.argv[5];for(let i=a;i<=z;i++){await pg.evaluate(t=>window.frame(t),i/fps);await el.screenshot({path:`${outDir}/f_${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:92});}} else if(mode==='keys'){
   for(const t of process.argv.slice(4).map(Number)){await pg.evaluate(t=>window.frame(t),t);await el.screenshot({path:`${outDir}/k_${t}.jpg`,type:'jpeg',quality:85});}
 } else {
   const fps=+mode; const D=await pg.evaluate('window.DURATION'); const N=Math.round(D*fps);
   const t0=Date.now();
   for(let i=0;i<N;i++){await pg.evaluate(t=>window.frame(t),i/fps);await el.screenshot({path:`${outDir}/f_${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:92});
     if(i%48===0)console.log('frame',i,'/',N,((Date.now()-t0)/1000).toFixed(0)+'s');}
 }
 await b.close(); srv.close();
});
