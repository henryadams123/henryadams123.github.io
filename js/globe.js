/* GLOBE ENGINE — the 3D instrument. Avoid editing unless you know Three.js. */

/* ===================== GLOBE ===================== */
const canvas=document.getElementById('globe');
const reduceMotion=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
const R=2;
let scene,camera,renderer,globe,landMat,markerGroups=[],markerSprites=[],starfield=null,sat=null;
let raf,mode='boot',selected=null,hovered=null;
let velX=0,velY=0,dragging=false,lastX=0,lastY=0,moved=0;
let qTarget=null,dolly=6.8,dollyTarget=6.8;
let mouseNX=0,mouseNY=0,introStart=0,introT=0,homeQ=null;
let raycaster,ndc;
const arcPulses=[];
const labelEls=[];
const _v=new THREE.Vector3(),_q=new THREE.Quaternion(),_p=new THREE.Vector3();
const loadbar=document.getElementById('loadbar');
const DEFAULT_Q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12,-1.0,0,'YXZ'));

function ll2v(lat,lon,r){const phi=(90-lat)*Math.PI/180,theta=(lon+180)*Math.PI/180;
  return new THREE.Vector3(-r*Math.sin(phi)*Math.cos(theta),r*Math.cos(phi),r*Math.sin(phi)*Math.sin(theta));}
function spriteTex(color){const s=64,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
  const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,color);g.addColorStop(.3,color);g.addColorStop(1,'rgba(0,0,0,0)');
  x.fillStyle=g;x.beginPath();x.arc(s/2,s/2,s/2,0,7);x.fill();const t=new THREE.Texture(c);t.needsUpdate=true;return t;}

/* ---- State outline system (real GeoJSON borders) ---- */
const stateLines={oregon:[],colorado:[],australia:[]};
const stateMats={};
// NSW boundary [lat, lon] traced from actual border
const NSW_POLY=[[-29.0,141.0],[-29.0,143.5],[-28.6,146.0],[-28.9,148.5],[-29.05,150.0],[-28.5,151.5],[-28.17,153.55],[-29.0,153.4],[-30.3,153.1],[-31.5,152.85],[-33.0,151.6],[-33.87,151.2],[-34.4,150.9],[-35.0,150.7],[-36.0,150.2],[-37.0,149.95],[-37.5,149.97],[-36.8,148.5],[-36.1,147.0],[-35.9,145.5],[-35.5,143.9],[-35.1,142.5],[-34.1,141.0],[-29.0,141.0]];

function geojsonToLines(region,geometry){
  const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  polys.forEach(poly=>{
    const pts=poly[0].map(([lon,lat])=>ll2v(lat,lon,R*1.003));
    const ln=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),stateMats[region]);
    globe.add(ln);stateLines[region].push(ln);
  });
}

function buildStateBorders(){
  ['oregon','colorado','australia'].forEach(r=>{
    stateMats[r]=new THREE.LineBasicMaterial({color:0x5A9BC4,transparent:true,opacity:0,depthWrite:false});
  });
  globe.userData.stateMats=stateMats;
  // NSW hardcoded
  const nswPts=NSW_POLY.map(([lat,lon])=>ll2v(lat,lon,R*1.003));
  const nswLn=new THREE.Line(new THREE.BufferGeometry().setFromPoints(nswPts),stateMats.australia);
  globe.add(nswLn);stateLines.australia.push(nswLn);
  // US states via topojson CDN (Oregon FIPS=41, Colorado FIPS=08)
  if(typeof topojson!=='undefined'){
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json')
      .then(r=>r.json())
      .then(topo=>{
        const features=topojson.feature(topo,topo.objects.states).features;
        const or=features.find(f=>f.id==='41');
        const co=features.find(f=>f.id==='08');
        if(or)geojsonToLines('oregon',or.geometry);
        if(co)geojsonToLines('colorado',co.geometry);
      }).catch(()=>{});
  }
}

function initGlobe(){
  try{
    if(!window.THREE)throw 0;
    raycaster=new THREE.Raycaster();ndc=new THREE.Vector2();
    if(loadbar)loadbar.style.width='30%';
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.1,100);camera.position.set(0,0,dolly);
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight,false);
    globe=new THREE.Group();scene.add(globe);

    /* inner sphere with subtle lit gradient */
    const innerMat=new THREE.ShaderMaterial({
      uniforms:{uLight:{value:new THREE.Vector3(-0.5,0.5,0.8).normalize()}},
      vertexShader:'varying vec3 vN;varying vec3 vP;void main(){vN=normalize(normalMatrix*normal);vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying vec3 vN;varying vec3 vP;uniform vec3 uLight;void main(){float l=clamp(dot(normalize(vN),uLight)*0.5+0.5,0.0,1.0);vec3 dark=vec3(0.018,0.035,0.065);vec3 lit=vec3(0.05,0.09,0.14);gl_FragColor=vec4(mix(dark,lit,l),1.0);}'
    });
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(R*0.985,64,64),innerMat));

    /* atmosphere */
    const atmoMat=new THREE.ShaderMaterial({transparent:true,blending:THREE.AdditiveBlending,side:THREE.BackSide,depthWrite:false,
      uniforms:{c:{value:new THREE.Color(0x4F92CC)},o:{value:1}},
      vertexShader:'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying vec3 vN;uniform vec3 c;uniform float o;void main(){float i=pow(0.74-dot(vN,vec3(0,0,1.0)),3.0);gl_FragColor=vec4(c,clamp(i,0.0,1.0)*0.95*o);}'});
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(R*1.15,48,48),atmoMat));
    globe.userData.atmoMat=atmoMat;

    if(loadbar)loadbar.style.width='52%';

    /* ---- LAND: custom shader points (size/twinkle/coast/color) ---- */
    const n=LAND_FLAT.length/3;
    const pos=new Float32Array(n*3),aSize=new Float32Array(n),aPhase=new Float32Array(n),aCoast=new Float32Array(n);
    for(let i=0;i<n;i++){
      const lat=LAND_FLAT[i*3],lon=LAND_FLAT[i*3+1],coast=LAND_FLAT[i*3+2];
      const v=ll2v(lat,lon,R*1.004);pos[i*3]=v.x;pos[i*3+1]=v.y;pos[i*3+2]=v.z;
      aSize[i]=coast?1.05:0.62;aCoast[i]=coast;aPhase[i]=Math.random()*6.28;
    }
    const lg=new THREE.BufferGeometry();
    lg.setAttribute('position',new THREE.BufferAttribute(pos,3));
    lg.setAttribute('aSize',new THREE.BufferAttribute(aSize,1));
    lg.setAttribute('aPhase',new THREE.BufferAttribute(aPhase,1));
    lg.setAttribute('aCoast',new THREE.BufferAttribute(aCoast,1));
    landMat=new THREE.ShaderMaterial({
      transparent:true,depthTest:true,depthWrite:false,
      uniforms:{uTime:{value:0},uOpacity:{value:0},uPix:{value:Math.min(devicePixelRatio,1.5)},
        uCoast:{value:new THREE.Color(0xCDE6F7)},uInland:{value:new THREE.Color(0x4E7CA6)},uPole:{value:new THREE.Color(0x7FA8CC)}},
      vertexShader:[
        'attribute float aSize;attribute float aPhase;attribute float aCoast;',
        'uniform float uTime;uniform float uPix;',
        'varying float vC;varying float vTw;varying float vLat;',
        'void main(){vC=aCoast;vLat=abs(position.y/2.0);',
        'vec4 mv=modelViewMatrix*vec4(position,1.0);',
        'float tw=0.90+0.10*sin(uTime*1.1+aPhase);vTw=tw;',
        'gl_PointSize=aSize*uPix*(16.0/ -mv.z)*tw;',
        'gl_Position=projectionMatrix*mv;}'
      ].join('\n'),
      fragmentShader:[
        'uniform float uOpacity;uniform vec3 uCoast;uniform vec3 uInland;uniform vec3 uPole;',
        'varying float vC;varying float vTw;varying float vLat;',
        'void main(){vec2 c=gl_PointCoord-0.5;float d=length(c);if(d>0.5)discard;',
        'float a=smoothstep(0.5,0.22,d);',
        'vec3 base=mix(uInland,uCoast,vC);base=mix(base,uPole,smoothstep(0.55,1.0,vLat)*0.6);',
        'gl_FragColor=vec4(base,a*uOpacity*(0.7+0.3*vTw));}'
      ].join('\n')
    });
    globe.add(new THREE.Points(lg,landMat));

    /* graticule */
    const gmat=new THREE.LineBasicMaterial({color:0x1C3346,transparent:true,opacity:0});globe.userData.gmat=gmat;
    for(let la=-60;la<=60;la+=30){const p=[];for(let lo=0;lo<=360;lo+=4)p.push(ll2v(la,lo-180,R));globe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p),gmat));}
    for(let lo=0;lo<360;lo+=30){const p=[];for(let la=-90;la<=90;la+=4)p.push(ll2v(la,lo-180,R));globe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p),gmat));}

    if(loadbar)loadbar.style.width='74%';

    /* ---- MARKERS: simple pin — thin stalk + small dot at tip ---- */
    const coolTex=spriteTex('rgba(166,210,239,1)'),amberTex=spriteTex('rgba(246,190,99,1)');
    LOCATIONS.forEach((loc,i)=>{
      const warm=loc.flagship||loc.current;
      const dir=ll2v(loc.lat,loc.lon,1).normalize();
      const base=dir.clone().multiplyScalar(R*1.004);
      const grp=new THREE.Group();grp.position.copy(base);
      const localBeacon=dir.clone().multiplyScalar(R*1.316).sub(base);
      const col=warm?0xF6BE63:0x9CD0F0;

      // thin stalk line from surface to tip
      const stalkMat=new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0});
      grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),localBeacon]),stalkMat));


      // small sphere at tip of pin
      const beaconMat=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0});
      const beacon=new THREE.Mesh(new THREE.SphereGeometry(0.022,14,14),beaconMat);
      beacon.position.copy(localBeacon);grp.add(beacon);

      // invisible click target
      const hit=new THREE.Sprite(new THREE.SpriteMaterial({map:coolTex,transparent:true,opacity:0,depthWrite:false}));
      hit.position.copy(localBeacon);hit.scale.setScalar(0.28);grp.add(hit);

      grp.userData={loc,i,beacon,beaconMat,stalkMat,warm,beaconWorld:new THREE.Vector3()};
      hit.userData={i};
      globe.add(grp);markerGroups.push(grp);markerSprites.push(hit);

      // HTML label
      const el=document.createElement('div');el.className='mlabel'+(warm?' warm':'');
      el.innerHTML='<span class="badge">'+String(loc.stop).padStart(2,'0')+'</span><span class="city">'+loc.where+'</span>';
      el.addEventListener('click',()=>selectLocation(i));
      el.addEventListener('mouseenter',()=>{hovered=i;syncChips();});
      el.addEventListener('mouseleave',()=>{hovered=null;syncChips();});
      document.getElementById('labels').appendChild(el);
      labelEls.push({el,i,grp});
    });

    /* ---- ARCS (journey) ---- */
    ARCS.forEach(a=>{const A=byId(a.from),B=byId(a.to);if(!A||!B)return;
      const v1=ll2v(A.lat,A.lon,R*1.01),v2=ll2v(B.lat,B.lon,R*1.01),mid=v1.clone().add(v2).multiplyScalar(.5);
      mid.normalize().multiplyScalar(R*(1+v1.distanceTo(v2)*0.30));
      const curve=new THREE.QuadraticBezierCurve3(v1,mid,v2),pts=curve.getPoints(64);
      const am=new THREE.LineBasicMaterial({color:a.accent?0xE9A23B:0x6FA8D0,transparent:true,opacity:0});
      const ln=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),am);ln.userData.fade=0.4;globe.add(ln);
      const tex=a.accent?amberTex:coolTex;
      for(let k=0;k<3;k++){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,color:a.accent?0xF6BE63:0xA6D2EF,opacity:0}));
        sp.scale.setScalar(0.14-k*0.03);sp.userData={curve,t:k*0.13,speed:0.0017+(a.accent?0.0006:0),trail:k};globe.add(sp);arcPulses.push(sp);}
    });

    /* ---- REMOTE satellite link (any location with a remote field) ---- */
    const tp=LOCATIONS.find(l=>l.remote);
    if(tp&&tp.remote){
      const v1=ll2v(tp.lat,tp.lon,R*1.01),v2=ll2v(tp.remote.lat,tp.remote.lon,R*1.01),mid=v1.clone().add(v2).multiplyScalar(.5);
      mid.normalize().multiplyScalar(R*(1+v1.distanceTo(v2)*0.55));
      const curve=new THREE.QuadraticBezierCurve3(v1,mid,v2),pts=curve.getPoints(80);
      // dotted: build short segments
      const dgeo=new THREE.BufferGeometry().setFromPoints(pts);
      const dmat=new THREE.LineDashedMaterial({color:0xA6D2EF,transparent:true,opacity:0,dashSize:0.07,gapSize:0.04});
      const dl=new THREE.Line(dgeo,dmat);dl.computeLineDistances();dl.userData.fade=0.85;globe.add(dl);
      // little satellite blip traveling
      // lights — only affect the lit satellite (globe uses unlit materials)
      scene.add(new THREE.AmbientLight(0x8da3bf,0.95));
      const sunLite=new THREE.DirectionalLight(0xffffff,1.15);sunLite.position.set(2,2,3);scene.add(sunLite);
      // assemble a tiny satellite: body + gold foil + solar panels + dish
      const spin=new THREE.Group();
      const bodyMat=new THREE.MeshPhongMaterial({color:0xd2d8df,shininess:70,specular:0x9aa3ad,transparent:true,opacity:0});
      spin.add(new THREE.Mesh(new THREE.BoxGeometry(0.05,0.05,0.085),bodyMat));
      const foilMat=new THREE.MeshPhongMaterial({color:0xC9A24B,shininess:120,specular:0xffe7a0,transparent:true,opacity:0});
      const foil=new THREE.Mesh(new THREE.BoxGeometry(0.052,0.052,0.022),foilMat);foil.position.z=0.05;spin.add(foil);
      const panelMat=new THREE.MeshPhongMaterial({color:0x1b3f78,shininess:110,specular:0x5a8fd0,emissive:0x07142c,transparent:true,opacity:0});
      const pL=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.045,0.004),panelMat);pL.position.x=-0.105;spin.add(pL);
      const pR=pL.clone();pR.position.x=0.105;spin.add(pR);
      const armMat=new THREE.MeshPhongMaterial({color:0x99a0a8,transparent:true,opacity:0});
      const aL=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.006,0.006),armMat);aL.position.x=-0.05;spin.add(aL);
      const aR=aL.clone();aR.position.x=0.05;spin.add(aR);
      const dishMat=new THREE.MeshPhongMaterial({color:0xe6eaee,side:THREE.DoubleSide,shininess:60,transparent:true,opacity:0});
      const dish=new THREE.Mesh(new THREE.SphereGeometry(0.022,14,10,0,6.28,0,1.1),dishMat);dish.position.z=-0.062;dish.rotation.x=-Math.PI/2.2;spin.add(dish);
      const satGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:coolTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,color:0xA6D2EF,opacity:0}));
      satGlow.scale.setScalar(0.24);
      sat=new THREE.Group();sat.add(spin);sat.add(satGlow);sat.scale.setScalar(0.5);
      sat.userData={curve,t:0,speed:0.0024,spin,satGlow,satMats:[bodyMat,foilMat,panelMat,armMat,dishMat]};
      globe.add(sat);
      // VA endpoint faint marker
      const vEnd=new THREE.Sprite(new THREE.SpriteMaterial({map:coolTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,color:0x8493A6,opacity:0}));
      vEnd.position.copy(v2);vEnd.scale.setScalar(0.12);vEnd.userData.fade=0.7;globe.add(vEnd);
    }

    /* ---- starfield (two layers) ---- */
    function makeStars(count,radMin,radMax,size,op){const p=new Float32Array(count*3);
      for(let i=0;i<count;i++){const r=radMin+Math.random()*(radMax-radMin),t=Math.random()*6.28,ph=Math.acos(2*Math.random()-1);
        p[i*3]=r*Math.sin(ph)*Math.cos(t);p[i*3+1]=r*Math.sin(ph)*Math.sin(t);p[i*3+2]=r*Math.cos(ph);}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));
      return new THREE.Points(g,new THREE.PointsMaterial({color:0x9FB4CC,size:size,transparent:true,opacity:op}));}
    starfield=new THREE.Group();starfield.add(makeStars(340,20,30,0.05,0.5));starfield.add(makeStars(160,30,44,0.09,0.35));scene.add(starfield);

    globe.quaternion.copy(DEFAULT_Q);
    if(loadbar){loadbar.style.width='100%';setTimeout(()=>loadbar.style.opacity='0',500);}
    buildStateBorders();
    bind();buildChips();onResize();window.addEventListener('resize',onResize);
    introStart=performance.now();mode='intro';animate();
  }catch(e){console.warn('globe init failed',e);document.querySelector('.hero-fallback').style.display='flex';canvas.style.display='none';buildChips();}
}

function frontLatLon(){_q.copy(globe.quaternion).invert();_v.set(0,0,1).applyQuaternion(_q).multiplyScalar(R);
  const lat=90-Math.acos(THREE.MathUtils.clamp(_v.y/R,-1,1))*180/Math.PI;let lon=Math.atan2(_v.z,-_v.x)*180/Math.PI-180;
  while(lon<-180)lon+=360;while(lon>180)lon-=360;return{lat,lon};}
function targetQuatFor(loc){const v=ll2v(loc.lat,loc.lon,1).normalize();
  const yaw=Math.asin(THREE.MathUtils.clamp(-v.x,-1,1));
  const pitch=Math.atan2(v.y,v.z);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));}

/* ---- interaction ---- */
function bind(){
  canvas.addEventListener('pointerdown',e=>{dragging=true;stopTour();mode='drag';qTarget=null;lastX=e.clientX;lastY=e.clientY;moved=0;velX=velY=0;canvas.classList.add('grabbing');canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{updatePointer(e);if(!dragging)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;moved+=Math.abs(dx)+Math.abs(dy);rotateBy(dx*0.006,dy*0.006);velX=dx*0.006;velY=dy*0.006;lastX=e.clientX;lastY=e.clientY;});
  function up(e){if(dragging&&moved<6)clickAt(e);dragging=false;canvas.classList.remove('grabbing');if(mode==='drag')mode='inertia';}
  canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',()=>{dragging=false;canvas.classList.remove('grabbing');if(mode==='drag')mode='inertia';});
  canvas.addEventListener('wheel',e=>{e.preventDefault();dollyTarget=THREE.MathUtils.clamp(dollyTarget+Math.sign(e.deltaY)*0.4,2.8,8.4);},{passive:false});
}
function rotateBy(ax,ay){globe.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),ax)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),ay));}
function updatePointer(e){const r=canvas.getBoundingClientRect();ndc.x=((e.clientX-r.left)/r.width)*2-1;ndc.y=-((e.clientY-r.top)/r.height)*2+1;mouseNX=ndc.x;mouseNY=ndc.y;
  const hit=pick();hovered=hit;canvas.style.cursor=hit!==null?'pointer':(dragging?'grabbing':'grab');syncChips();}
function pick(){if(!raycaster)return null;raycaster.setFromCamera(ndc,camera);const hits=raycaster.intersectObjects(markerSprites);if(!hits.length)return null;
  const camDir=camera.position.clone().normalize();for(const h of hits){const wp=h.object.getWorldPosition(_p).clone().normalize();if(wp.dot(camDir)>0.12)return h.object.userData.i;}return null;}
function clickAt(e){updatePointer(e);const i=pick();if(i!==null)selectLocation(i);}

function focusMarker(i){qTarget=targetQuatFor(LOCATIONS[i]);dollyTarget=5.9;mode='focus';}
function selectLocation(i){selected=i;stopTour();focusMarker(i);showDetail(i);syncChips();}
function showDetail(i){const loc=LOCATIONS[i];
  document.getElementById('dnum').textContent='STOP '+String(loc.stop).padStart(2,'0')+' / 0'+LOCATIONS.length;
  document.getElementById('dtag').textContent=loc.tag;document.getElementById('dtitle').textContent=loc.title;
  document.getElementById('dorg').textContent=loc.org;document.getElementById('ddate').textContent=loc.date;
  document.getElementById('dwhere').textContent=loc.where;document.getElementById('ddesc').textContent=loc.desc;
  document.getElementById('detail').classList.add('show');}
let rmapOpen=false,rmapLeaflet=null,rmapMarkers=[];
document.getElementById('dclose').addEventListener('click',()=>{
  document.getElementById('detail').classList.remove('show');selected=null;syncChips();
  if(!rmapOpen){qTarget=(homeQ||DEFAULT_Q).clone();dollyTarget=6.8;mode='focus';}
});
const REGIONS={
  oregon:   {lat:44.05, lon:-123.0,  dolly:4.1},
  colorado: {lat:39.60, lon:-105.5,  dolly:3.9},
  australia:{lat:-33.87,lon: 151.21, dolly:4.3}
};
let activeRegion=null,hoveredRegion=null;
function focusRegion(name){
  const reg=REGIONS[name];if(!reg)return;
  stopTour();selected=null;document.getElementById('detail').classList.remove('show');
  qTarget=targetQuatFor(reg);dollyTarget=reg.dolly;mode='focus';syncChips();
  document.querySelectorAll('.region-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('region-'+name);if(btn)btn.classList.add('active');
  activeRegion=name;hoveredRegion=null;
}
function clearRegion(){
  qTarget=(homeQ||DEFAULT_Q).clone();dollyTarget=6.8;mode='focus';
  document.querySelectorAll('.region-btn').forEach(b=>b.classList.remove('active'));
  activeRegion=null;hoveredRegion=null;
}
['oregon','colorado','australia'].forEach(name=>{
  const btn=document.getElementById('region-'+name);if(!btn)return;
  btn.addEventListener('click',()=>openRegionMap(name));
  btn.addEventListener('mouseenter',()=>{if(!activeRegion&&!rmapOpen){hoveredRegion=name;const r=REGIONS[name];qTarget=targetQuatFor(r);dollyTarget=r.dolly;mode='focus';}});
  btn.addEventListener('mouseleave',()=>{if(!activeRegion&&!rmapOpen){hoveredRegion=null;qTarget=(homeQ||DEFAULT_Q).clone();dollyTarget=6.8;mode='focus';}});
});

/* ---- FLAT REGION MAP ---- */
const REGION_FLAT={
  colorado:  {title:'COLORADO',   center:[39.35,-105.6], zoom:8,  locs:['cu','xcel','boot','dsl','mca','copper']},
  oregon:    {title:'OREGON',     center:[44.05,-122.8], zoom:9,  locs:['uo']},
  australia: {title:'AUSTRALIA',  center:[-33.87,151.21],zoom:13, locs:['rfc']}
};

function openRegionMap(name){
  const cfg=REGION_FLAT[name];if(!cfg)return;
  rmapOpen=true;stopTour();
  document.getElementById('region-map-overlay').classList.add('rmap-open');
  document.getElementById('rmap-title').textContent=cfg.title;
  document.getElementById('detail').classList.remove('show');
  selected=null;syncChips();
  activeRegion=name;hoveredRegion=null;
  document.querySelectorAll('.region-btn').forEach(b=>b.classList.remove('active'));
  const ab=document.getElementById('region-'+name);if(ab)ab.classList.add('active');

  if(!rmapLeaflet){
    rmapLeaflet=L.map('rmap-canvas',{zoomControl:true,attributionControl:true});
    // topo base — terrain relief + roads + water, styled dark via CSS
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',{
      attribution:'Tiles &copy; Esri',maxZoom:19
    }).addTo(rmapLeaflet);
  }

  // clear old markers
  rmapMarkers.forEach(m=>rmapLeaflet.removeLayer(m));rmapMarkers=[];

  rmapLeaflet.setView(cfg.center,cfg.zoom,{animate:false});

  cfg.locs.forEach(id=>{
    const loc=byId(id);if(!loc)return;
    const warm=!!(loc.flagship||loc.current);
    const icon=L.divIcon({
      className:'',
      iconSize:[32,52],
      iconAnchor:[16,16],
      html:`<div class="rmap-pin"><div class="rmap-circle${warm?' warm':''}">
        ${String(loc.stop).padStart(2,'0')}</div>
        <div class="rmap-pin-label">${loc.where}</div></div>`
    });
    const m=L.marker([loc.lat,loc.lon],{icon,title:loc.title}).addTo(rmapLeaflet);
    m.on('click',e=>{L.DomEvent.stopPropagation(e);showDetail(LOCATIONS.indexOf(loc));});
    rmapMarkers.push(m);
  });

  setTimeout(()=>{if(rmapLeaflet)rmapLeaflet.invalidateSize();},350);
}

function closeRegionMap(){
  rmapOpen=false;
  document.getElementById('region-map-overlay').classList.remove('rmap-open');
  document.getElementById('detail').classList.remove('show');
  selected=null;syncChips();
  clearRegion();
}

document.getElementById('rmap-close').addEventListener('click',closeRegionMap);

function onResize(){if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);}

/* ---- guided tour ---- */
let tour={on:false,idx:0,next:0};
const tourBtn=document.getElementById('tourBtn'),tourProg=document.getElementById('tourProg');
function startTour(){tour.on=true;tour.idx=0;tour.next=performance.now();mode='tour';
  tourBtn.innerHTML='<span class="sq"></span>Stop tour';tourProg.style.display='inline-block';}
function stopTour(){if(!tour.on)return;tour.on=false;tourBtn.innerHTML='<span class="tri"></span>Tour the journey';tourProg.style.display='none';}
tourBtn.addEventListener('click',()=>{tour.on?stopTour():startTour();});
function tourStep(now){
  if(now<tour.next)return;
  if(tour.idx>=TOUR_ORDER.length){stopTour();document.getElementById('detail').classList.remove('show');selected=null;qTarget=DEFAULT_Q.clone();mode='focus';return;}
  const loc=byId(TOUR_ORDER[tour.idx]);const i=LOCATIONS.indexOf(loc);
  selected=i;focusMarker(i);showDetail(i);syncChips();mode='tour';
  tourProg.textContent=String(tour.idx+1).padStart(2,'0')+' / '+String(TOUR_ORDER.length).padStart(2,'0');
  tour.idx++;tour.next=now+2700;
}

/* ---- chips ---- */
function buildChips(){const wrap=document.getElementById('chips');
  LOCATIONS.forEach((loc,i)=>{const b=document.createElement('button');b.className='chip';b.dataset.i=i;
    b.innerHTML='<span class="pip"></span>'+String(loc.stop).padStart(2,'0')+' · '+loc.where;
    b.addEventListener('click',()=>selectLocation(i));
    b.addEventListener('mouseenter',()=>{hovered=i;syncChips();});b.addEventListener('mouseleave',()=>{hovered=null;syncChips();});
    wrap.appendChild(b);});}
function syncChips(){document.querySelectorAll('.chip').forEach(c=>{const i=+c.dataset.i;c.classList.toggle('active',i===selected||i===hovered);});
  labelEls.forEach(L=>{L.el.classList.toggle('active',L.i===selected||L.i===hovered);});}

/* ---- main loop ---- */
let last=performance.now();
function animate(){
  raf=requestAnimationFrame(animate);
  const now=performance.now(),dt=Math.min(0.05,(now-last)/1000);last=now;

  if(mode==='intro'){introT=Math.min(1,(now-introStart)/1500);const e=1-Math.pow(1-introT,3);dolly=9.2-(9.2-6.8)*e;
    globe.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(1-e)*0.05));if(introT>=1){mode='idle';if(!homeQ)homeQ=globe.quaternion.clone();}}
  else if(mode==='inertia'){rotateBy(velX,velY);velX*=0.92;velY*=0.92;if(Math.abs(velX)<0.0003&&Math.abs(velY)<0.0003)mode='idle';}
  else if((mode==='focus'||mode==='tour')&&qTarget){globe.quaternion.slerp(qTarget,0.10);if(globe.quaternion.angleTo(qTarget)<0.005)globe.quaternion.copy(qTarget);}
  if(tour.on)tourStep(now);

  dolly+=(dollyTarget-dolly)*0.08;
  camera.position.x+=((0)-camera.position.x)*0.05;
  camera.position.y+=((0)-camera.position.y)*0.05;
  camera.position.z=dolly;camera.lookAt(0,0,0);
  if(starfield&&!reduceMotion)starfield.rotation.y+=0.00012;

  // fade-in everything
  const op=Math.min(1,Math.max(0,(introT-0.05)/0.7));
  if(landMat){landMat.uniforms.uTime.value=now/1000;landMat.uniforms.uOpacity.value=op*0.88;}
  if(globe.userData.gmat)globe.userData.gmat.opacity=op*0.30;
  if(globe.userData.atmoMat)globe.userData.atmoMat.uniforms.o.value=op;
  globe.traverse(o=>{if(o.userData&&o.userData.fade!==undefined&&o.material)o.material.opacity=op*o.userData.fade;});

  const t=now/1000;
  // State line opacity: 0.22 globally, 0.72 when region focused/hovered
  const sMats=globe.userData.stateMats;
  if(sMats)Object.entries(sMats).forEach(([r,mat])=>{mat.opacity=(r===activeRegion||r===hoveredRegion?0.72:0.22)*op;});

  markerGroups.forEach(g=>{const u=g.userData;const appear=Math.min(1,Math.max(0,(introT-0.3)*1.6));
    const sel=selected===u.i,hov=hovered===u.i;
    const bs=(sel?1.5:hov?1.2:1.0);
    u.beacon.scale.setScalar(Math.max(0.001,bs*appear));
    u.beaconMat.opacity=(sel||hov?1.0:0.90)*appear;
    u.stalkMat.opacity=(sel||hov?1.0:0.55)*appear;
    u.beacon.getWorldPosition(u.beaconWorld);
  });

  arcPulses.forEach(p=>{p.userData.t+=p.userData.speed;if(p.userData.t>1)p.userData.t-=1;p.position.copy(p.userData.curve.getPoint(p.userData.t));p.material.opacity=(0.25+Math.sin(p.userData.t*Math.PI)*0.7)*(p.userData.trail?0.5:1)*op;});
  if(sat){const u=sat.userData;u.t+=u.speed;if(u.t>1)u.t-=1;
    sat.position.copy(u.curve.getPoint(u.t));
    u.spin.rotation.y+=0.022;u.spin.rotation.z=0.25;
    u.satMats.forEach(m=>m.opacity=op);
    u.satGlow.material.opacity=(0.3+Math.sin(u.t*Math.PI)*0.5)*op;}

  updateLabels(op);
  updateCompass();

  const fll=frontLatLon();const f=fmtLL(fll.lat,fll.lon);const cr=document.getElementById('coordReadout');if(cr)cr.innerHTML='<b>'+f.la+'</b> &nbsp; <b>'+f.lo+'</b>';

  renderer.render(scene,camera);
}

/* labels: project to screen + declutter */
const placed=[];
function updateLabels(op){
  placed.length=0;
  const camDir=camera.position.clone().normalize();
  // priority: active/hovered first, then flagship/current, then rest
  const order=labelEls.slice().sort((a,b)=>{
    const pa=(a.i===selected?3:0)+(a.i===hovered?2:0)+(LOCATIONS[a.i].flagship||LOCATIONS[a.i].current?1:0);
    const pb=(b.i===selected?3:0)+(b.i===hovered?2:0)+(LOCATIONS[b.i].flagship||LOCATIONS[b.i].current?1:0);
    return pb-pa;});
  order.forEach(L=>{
    const u=L.grp.userData;const wp=u.beaconWorld;
    const facing=wp.clone().normalize().dot(camDir);
    if(facing<0.08||op<0.4){L.el.style.opacity='0';return;}
    _p.copy(wp).project(camera);
    const x=(_p.x*0.5+0.5)*innerWidth,y=(-_p.y*0.5+0.5)*innerHeight;
    // declutter unless active/hovered
    let hide=false;const force=(L.i===selected||L.i===hovered);
    if(!force){for(const q of placed){if(Math.abs(q.x-x)<40&&Math.abs(q.y-y)<26){hide=true;break;}}}
    if(hide){L.el.style.opacity='0';return;}
    placed.push({x,y});
    L.el.style.left=x+'px';L.el.style.top=y+'px';L.el.style.opacity=String(Math.min(1,(facing-0.08)/0.25)*op);
  });
}
function updateCompass(){const{lon}=frontLatLon();const needle=document.getElementById('needle');if(needle)needle.style.transform='rotate('+(-lon)+'deg)';}
