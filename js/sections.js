/* SECTIONS — timeline, skills radar, marquee, reveals, boot + init. */

/* ===================== SECTIONS ===================== */
/* timeline */
(function(){const tl=document.getElementById('timeline');if(!tl)return;
  JOURNEY.forEach(item=>{const data=item.ref?byId(item.ref):item;const mapRef=item.ref||item.mapRef||null;const loc=mapRef?byId(mapRef):null;
    const f=loc?fmtLL(loc.lat,loc.lon):null;const num=loc?loc.stop:'';
    const el=document.createElement('div');el.className='entry reveal';
    el.innerHTML='<div class="node">'+(num?String(num).padStart(2,'0'):'·')+'</div><div class="entry-card"><div class="entry-top"><h3>'+data.title+'</h3><span class="date">'+data.date+'</span></div>'+
      '<div class="org">'+data.org+'<span class="loc">'+data.where+'</span></div><p>'+data.desc+'</p>'+
      (data.tags?'<div class="tags">'+data.tags.map(t=>'<span>'+t+'</span>').join('')+'</div>':'')+
      (f?'<div class="coordtag"><span class="gl">⌖</span>'+f.la+' / '+f.lo+' · view on globe</div>':'')+'</div>';
    if(loc){const idx=LOCATIONS.indexOf(loc);el.addEventListener('click',()=>{window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>selectLocation(idx),650);});
      el.addEventListener('mouseenter',()=>el.classList.add('lit'));el.addEventListener('mouseleave',()=>el.classList.remove('lit'));}
    tl.appendChild(el);});
})();

/* marquee */
(function(){const words=['STRATEGY','·','CLEAN ENERGY','·','BOULDER','·','SYDNEY','·','ECONOMICS','·','ENGINEERING','·','ALPINE','·'];
  const t=document.getElementById('mtrack');if(!t)return;for(let r=0;r<2;r++)words.forEach((w,i)=>{const s=document.createElement('span');s.textContent=w;if(i%4===0)s.className='fill';t.appendChild(s);});})();

/* kinetic */
function kineticize(el){const txt=el.textContent;el.textContent='';txt.split(/(\s+)/).forEach((word,i)=>{if(word.trim()===''){el.appendChild(document.createTextNode(word));return;}
  const w=document.createElement('span');w.className='kin-word';const inner=document.createElement('i');inner.textContent=word;inner.style.transitionDelay=(i*0.05)+'s';w.appendChild(inner);el.appendChild(w);});}
document.querySelectorAll('[data-kin]').forEach(kineticize);

/* reveals */
const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');if(e.target.hasAttribute('data-kin'))e.target.classList.add('kin-in');io.unobserve(e.target);}});},{threshold:.14});
document.querySelectorAll('.reveal,[data-kin]').forEach(el=>io.observe(el));

window.addEventListener('scroll',()=>{document.getElementById('nav').classList.toggle('scrolled',scrollY>40);},{passive:true});
document.getElementById('dlBtn').addEventListener('click',()=>window.print());
document.getElementById('linkedin').addEventListener('click',e=>e.preventDefault());

/* radar */
(function(){const cv=document.getElementById('radarCv');if(!cv)return;const tile=document.getElementById('radarTile');const ctx=cv.getContext('2d');
  const SKILLS=['Modeling','Excel','R','PM/CAPM','Ops','Strategy','Notion','Energy'];
  const labels=SKILLS.map(s=>{const d=document.createElement('div');d.className='rlabel';d.textContent=s;tile.appendChild(d);return d;});
  let w,h,cx,cy,rad,sweep=0,rafR=null;
  function size(){const r=cv.getBoundingClientRect();w=cv.width=r.width*devicePixelRatio;h=cv.height=r.height*devicePixelRatio;cx=w/2;cy=h/2;rad=Math.min(w,h)*0.40;}
  function ang(i){return(i/SKILLS.length)*Math.PI*2-Math.PI/2;}
  function draw(){ctx.clearRect(0,0,w,h);ctx.strokeStyle='rgba(127,178,217,0.12)';ctx.lineWidth=1;
    [1,2,3].forEach(r=>{ctx.beginPath();ctx.arc(cx,cy,rad*r/3,0,7);ctx.stroke();});
    SKILLS.forEach((_,i)=>{const a=ang(i);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad);ctx.stroke();});
    if(!reduceMotion)sweep+=0.018;
    ctx.save();ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,rad,sweep-0.55,sweep);ctx.closePath();ctx.fillStyle='rgba(233,162,59,0.10)';ctx.fill();ctx.restore();
    ctx.strokeStyle='rgba(233,162,59,0.7)';ctx.lineWidth=1.5*devicePixelRatio;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(sweep)*rad,cy+Math.sin(sweep)*rad);ctx.stroke();
    SKILLS.forEach((_,i)=>{const a=ang(i);let sw=sweep%(Math.PI*2);if(sw<0)sw+=6.28;let aa=a;if(aa<0)aa+=6.28;let diff=Math.abs(sw-aa);if(diff>Math.PI)diff=6.28-diff;
      const hot=diff<0.38,rr=(hot?6:3.5)*devicePixelRatio,px=cx+Math.cos(a)*rad,py=cy+Math.sin(a)*rad;
      ctx.beginPath();ctx.arc(px,py,rr,0,7);ctx.fillStyle=hot?'rgba(246,190,99,1)':'rgba(127,178,217,0.6)';ctx.fill();
      if(hot){ctx.beginPath();ctx.arc(px,py,rr*2.4,0,7);ctx.strokeStyle='rgba(233,162,59,0.45)';ctx.lineWidth=1.5*devicePixelRatio;ctx.stroke();}
      labels[i].style.left=(px/devicePixelRatio+Math.cos(a)*16)+'px';labels[i].style.top=(py/devicePixelRatio+Math.sin(a)*16)+'px';
      labels[i].style.transform='translate(-50%,-50%)';labels[i].classList.toggle('hot',hot);});
    rafR=requestAnimationFrame(draw);}
  new ResizeObserver(size).observe(cv);
  new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){size();if(!rafR)draw();}else{cancelAnimationFrame(rafR);rafR=null;}});},{threshold:.1}).observe(cv);
})();

/* ===================== BOOT then INIT ===================== */
function runBoot(){
  const lines=document.querySelectorAll('.boot-line');const bar=document.getElementById('bootBar');
  lines.forEach((l,i)=>setTimeout(()=>l.classList.add('show'),120+i*180));
  setTimeout(()=>{if(bar)bar.style.width='100%';},200);
  setTimeout(()=>{document.getElementById('boot').classList.add('done');},1500);
}
function boot(){runBoot();initGlobe();}
if(document.readyState==='complete')boot();
else window.addEventListener('load',boot);
