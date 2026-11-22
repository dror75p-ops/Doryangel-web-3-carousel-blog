const p=require('puppeteer');const http=require('http');const fs=require('fs');const path=require('path');
const root=__dirname;
const types={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png','.css':'text/css'};
const srv=http.createServer((q,s)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();return}s.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});s.end(d)})});
srv.listen(8765,async()=>{
 const b=await p.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const pg=await b.newPage(); pg.on('console',m=>console.log('console:',m.text())); pg.on('pageerror',e=>console.log('pageerror',e.message));
 const [url,out,w,h]=process.argv.slice(2);
 await pg.setViewport({width:+w||1080,height:+h||1080});
 await pg.goto('http://localhost:8765/'+url,{waitUntil:'networkidle0'});
 await pg.waitForFunction('window.done===true',{timeout:60000});
 await pg.screenshot({path:out});
 await b.close(); srv.close();
});
