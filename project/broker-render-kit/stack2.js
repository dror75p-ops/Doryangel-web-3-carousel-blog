// Premium broker pack 3D: glossy pearl/blue unit towers, gold $50 coins, studio reflections.
import * as THREE from './node_modules/three/build/three.module.js';
import {RoomEnvironment} from './node_modules/three/examples/jsm/environments/RoomEnvironment.js';
export const COL={pearl:0xF4F6FA,blue:0x1E5AA8,navy:0x0F2847,roof:0x0B1A33,win:0xFFD98A,gold:0xE9B949,goldDk:0xB8862B};
const phys=(c,o={})=>new THREE.MeshPhysicalMaterial({color:c,roughness:.28,metalness:.1,clearcoat:1,clearcoatRoughness:.08,...o});
export function makeRenderer(canvas,w,h){
  const r=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});
  r.setPixelRatio(1);r.setSize(w,h,false);r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;
  r.outputColorSpace=THREE.SRGBColorSpace;r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.05;return r;
}
export function makeScene(r,w,h,zoom=8){
  const s=new THREE.Scene();
  const pm=new THREE.PMREMGenerator(r); s.environment=pm.fromScene(new RoomEnvironment(),0.04).texture;
  const a=w/h,cam=new THREE.OrthographicCamera(-zoom*a,zoom*a,zoom,-zoom,-100,200);
  cam.position.set(20,18,20);cam.lookAt(0,3,0);
  s.add(new THREE.HemisphereLight(0xcfe0ff,0x0b1a33,.6));
  const d=new THREE.DirectionalLight(0xffffff,1.8);d.position.set(-10,25,14);d.castShadow=true;
  d.shadow.mapSize.set(2048,2048);Object.assign(d.shadow.camera,{left:-20,right:20,top:20,bottom:-20});d.shadow.bias=-0.0008;s.add(d);
  const rim=new THREE.DirectionalLight(0x7fb2ff,1.2);rim.position.set(18,10,-16);s.add(rim);
  const g=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.45}));
  g.rotation.x=-Math.PI/2;g.receiveShadow=true;s.add(g);
  return {scene:s,cam};
}
export function unitBlock(color=COL.pearl){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(2.4,1,2.4),phys(color));body.castShadow=body.receiveShadow=true;g.add(body);
  const wm=new THREE.MeshStandardMaterial({color:COL.win,emissive:COL.win,emissiveIntensity:1.1,roughness:.2});
  for(const sx of [-.6,.6]){
    const w1=new THREE.Mesh(new THREE.BoxGeometry(.5,.45,.04),wm);w1.position.set(sx,0,1.21);g.add(w1);
    const w2=new THREE.Mesh(new THREE.BoxGeometry(.04,.45,.5),wm);w2.position.set(1.21,0,sx);g.add(w2);
  }
  const lip=new THREE.Mesh(new THREE.BoxGeometry(2.5,.08,2.5),phys(COL.gold,{metalness:1,roughness:.22}));lip.position.y=.54;g.add(lip);
  return g;
}
function coinTex(label,flip){
  const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');
  const gr=x.createRadialGradient(200,180,20,256,256,300);gr.addColorStop(0,'#FFE9A8');gr.addColorStop(.55,'#E9B949');gr.addColorStop(1,'#A8761F');
  x.fillStyle=gr;x.fillRect(0,0,512,512);
  x.strokeStyle='#8A5F16';x.lineWidth=14;x.beginPath();x.arc(256,256,214,0,Math.PI*2);x.stroke();
  x.strokeStyle='#FFF2C8';x.lineWidth=4;x.beginPath();x.arc(256,256,196,0,Math.PI*2);x.stroke();
  x.font='800 200px "Barlow Condensed", Arial';x.textAlign='center';x.textBaseline='middle';
  x.fillStyle='#FFF4D2';x.fillText(label,259,279);x.fillStyle='#7A5212';x.fillText(label,256,272);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.center.set(.5,.5);t.rotation=Math.PI/2;if(flip){t.wrapS=THREE.RepeatWrapping;t.repeat.x=-1;}return t;
}
export function coin(label='$50'){
  const f=new THREE.MeshPhysicalMaterial({map:coinTex(label,false),metalness:.85,roughness:.28,clearcoat:1});
  const f2=new THREE.MeshPhysicalMaterial({map:coinTex(label,true),metalness:.85,roughness:.28,clearcoat:1});
  const e=new THREE.MeshPhysicalMaterial({color:COL.gold,metalness:1,roughness:.2});
  const c=new THREE.Mesh(new THREE.CylinderGeometry(1,1,.22,64),[e,f,f2]);c.castShadow=true;c.rotation.x=Math.PI/2;
  const g=new THREE.Group();g.add(c);return g;
}
export function tower(n,{alt=true}={}){
  const g=new THREE.Group();const blocks=[];
  for(let i=0;i<n;i++){const b=unitBlock(alt&&i%2?COL.blue:COL.pearl);b.position.y=.5+i*1.06;g.add(b);blocks.push(b);}
  const roof=new THREE.Mesh(new THREE.BoxGeometry(2.6,.18,2.6),phys(COL.roof));roof.position.y=n*1.06+.08;roof.castShadow=true;g.add(roof);
  g.userData={blocks,roof};return g;
}
export function place(cam,W,H,px,py,ppu){cam.left=-px/ppu;cam.right=(W-px)/ppu;cam.top=py/ppu;cam.bottom=-(H-py)/ppu;cam.updateProjectionMatrix();}
