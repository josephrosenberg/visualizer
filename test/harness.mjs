// Loads visualizer.js for headless tests: strips the Three.js imports and
// the boot line, prepends a small stub THREE (vectors, colors, geometry
// holders; no DOM, no WebGL) and exports the classes. The generated module
// lands in test/.generated/, which is gitignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(here, '..', 'visualizer.js');
const outDir = path.join(here, '.generated');
const outPath = path.join(outDir, 'viz-under-test.mjs');

const STUB = `
const THREE = {
  MathUtils: { lerp: (a,b,t) => a + (b-a)*t },
  AdditiveBlending: 2, ACESFilmicToneMapping: 1,
  Vector3: class {
    constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} setScalar(s){this.x=s;this.y=s;this.z=s;return this;}
    clone(){return new THREE.Vector3(this.x,this.y,this.z);} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
    sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
    lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
    multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
    length(){return Math.hypot(this.x,this.y,this.z);} normalize(){const l=this.length()||1;this.x/=l;this.y/=l;this.z/=l;return this;}
    applyQuaternion(q){const {x,y,z}=this,{x:qx,y:qy,z:qz,w:qw}=q;const ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x,iw=-qx*x-qy*y-qz*z;
      this.x=ix*qw+iw*-qx+iy*-qz-iz*-qy;this.y=iy*qw+iw*-qy+iz*-qx-ix*-qz;this.z=iz*qw+iw*-qz+ix*-qy-iy*-qx;return this;}
  },
  Quaternion: class { constructor(x=0,y=0,z=0,w=1){this.x=x;this.y=y;this.z=z;this.w=w;} copy(q){this.x=q.x;this.y=q.y;this.z=q.z;this.w=q.w;return this;} invert(){this.x=-this.x;this.y=-this.y;this.z=-this.z;return this;} },
  Color: class { constructor(h){this.r=0;this.g=0;this.b=0;if(h!==undefined)this.set(h);} set(h){if(typeof h==='number'){this.r=((h>>16)&255)/255;this.g=((h>>8)&255)/255;this.b=(h&255)/255;}else if(h&&h.r!==undefined){this.r=h.r;this.g=h.g;this.b=h.b;}return this;} lerpColors(a,b,t){this.r=a.r+(b.r-a.r)*t;this.g=a.g+(b.g-a.g)*t;this.b=a.b+(b.b-a.b)*t;return this;} setHSL(){return this;} offsetHSL(){return this;} },
  BufferAttribute: class { constructor(arr,size){this.array=arr;this.itemSize=size;this.needsUpdate=false;this.updateRanges=[];} addUpdateRange(s,c){this.updateRanges.push({start:s,count:c});} clearUpdateRanges(){this.updateRanges.length=0;} },
  BufferGeometry: class { constructor(){this.attributes={};this.index=null;this.drawRange={start:0,count:0};} setAttribute(n,a){this.attributes[n]=a;} setIndex(a){this.index=a;} setDrawRange(s,c){this.drawRange={start:s,count:c};} dispose(){} },
  IcosahedronGeometry: class { dispose(){} },
  ShaderMaterial: class { constructor(o){Object.assign(this,o);} dispose(){} },
  LineBasicMaterial: class { constructor(o){Object.assign(this,o);} },
  Points: class { constructor(g,m){this.geometry=g;this.material=m;this.visible=true;} },
  LineSegments: class { constructor(g,m){this.geometry=g;this.material=m;this.visible=true;this.frustumCulled=true;this.position=new THREE.Vector3();this.scale=new THREE.Vector3(1,1,1);this.rotation={x:0,y:0,z:0};} },
  Mesh: class { constructor(g,m){this.geometry=g;this.material=m;this.visible=true;this.castShadow=false;this.scale=new THREE.Vector3(1,1,1);this.position=new THREE.Vector3();this.rotation={x:0,y:0,z:0};this.quaternion=new THREE.Quaternion();} },
};
`;

export async function load() {
  const body = fs.readFileSync(srcPath, 'utf8')
    .replace(/^import .*$/mg, '')
    .replace(/const viz = new Visualizer\(\);\s*viz\.start\(\);/, '');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, STUB + body + '\nexport { Core, MagneticParticles, PARTICLE_TUNING, AudioAnalyzer, DemoAnalyzer, AUDIO_TUNING, Visualizer, LOOKS, MODES, makeLook, PALETTES, paletteFromPixels, PHYSICS_G, TRAIL_POINTS, RAY_COUNT, LINK_MAX_PAIRS, THREE };\n');
  return import(pathToFileURL(outPath).href);
}
