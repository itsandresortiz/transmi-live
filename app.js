/* TransMi LIVE - motor: datos, mapa y buses */

"use strict";
const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>String(s??"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const TYPES={troncal:"Troncal",dual:"Dual",alimentador:"Alimentador",zonal:"Zonal",otro:"Otros"};
const KP=["troncal","dual","alimentador","zonal"];
const tv=t=>`var(--${TYPES[t]?t:"otro"})`;
const tcol=t=>css("--"+(TYPES[t]?t:"otro"));

const S={gaps:[],lastBts:0,glide:34000,est:true,lastChangeAt:0,xsMap:new Map(),exZoom:false,speedMul:1,selT0:0,showStreets:true,tu:new Map(),alerts:[],alByRoute:new Map(),alByStop:new Map(),arr:new Map(),colorBy:"tipo",alOpen:null,last:null,qa:"",zip:null,stops:new Map(),routes:new Map(),trips:new Map(),tripsByRoute:new Map(),shapes:new Map(),reps:null,repStops:null,
  vehicles:new Map(),markers:new Map(),sel:null,dir:"0",tab:"rutas",q:"",qs:"",qb:"",typeOn:new Set(Object.keys(TYPES)),
  mode:"load",timer:null,follow:null,hasData:false,showStops:true,showNet:true,showBuses:true,stamp:null};

/* ---------- Mapa ---------- */
const map=L.map("map",{zoomControl:false,zoomSnap:.5,zoomDelta:.5,wheelPxPerZoomLevel:90,minZoom:9,maxZoom:19,attributionControl:false});
map.createPane("base").style.zIndex=210;map.createPane("roads").style.zIndex=220;map.createPane("buses").style.zIndex=450;map.createPane("lbl").style.zIndex=440;
const URBAN=[[4.47,-74.215],[4.84,-74.01]];
map.fitBounds(URBAN);L.control.zoom({position:"bottomright"}).addTo(map);
L.control.attribution({prefix:false,position:"bottomright"}).addTo(map).addAttribution("© OpenStreetMap · TransMilenio · Bogotá");
const svg=L.svg({pane:"base"});
const gBase=L.layerGroup().addTo(map), gRoads=L.layerGroup().addTo(map), gTM=L.layerGroup().addTo(map), gEst=L.layerGroup().addTo(map), gMinor=L.layerGroup(), gNet=L.layerGroup().addTo(map), gStops=L.layerGroup().addTo(map), gRoute=L.layerGroup().addTo(map), gBus=L.layerGroup().addTo(map);
const cvMinor=L.canvas({padding:.3}), cvRoads=L.canvas({padding:.3}), cv=L.canvas({padding:.4}), cvNet=L.canvas({padding:.4}), cvBus=L.canvas({padding:.3});
[svg,cvMinor,cvRoads,cvNet,cv].forEach(r=>map.addLayer(r));

const gStreet=L.layerGroup().addTo(map);const SMIN=[13,13.5,14.5,15,16];
let stT;
function drawStreets(){clearTimeout(stT);stT=setTimeout(()=>{
  gStreet.clearLayers();const z=map.getZoom();if(z<13||!S.showStreets)return;
  const b=map.getBounds().pad(.04),grid=new Set();let n=0;
  const free=(p,w)=>{const x0=Math.floor((p.x-w/2)/64),x1=Math.floor((p.x+w/2)/64),y=Math.floor(p.y/22);for(let x=x0;x<=x1;x++)if(grid.has(x+","+y))return false;for(let x=x0;x<=x1;x++)grid.add(x+","+y);return true;};
  if(z>=14.5)for(const e of ESTS){if(!b.contains([e[0],e[1]]))continue;const p=map.latLngToContainerPoint([e[0],e[1]]);if(!free(p,Math.min(150,e[2].length*6+8)))continue;
    L.marker([e[0],e[1]],{interactive:false,keyboard:false,icon:L.divIcon({className:"stl st",iconSize:[0,0],html:`<span style="transform:translate(-50%,9px)">${esc(e[2])}</span>`})}).addTo(gStreet);}
  const cand=[];for(const a of STREETS.a){if(z<SMIN[a[0]])continue;if(!b.contains([a[1]/1e5,a[2]/1e5]))continue;cand.push(a);}
  cand.sort((x,y)=>x[0]-y[0]);
  for(const a of cand){if(n>=500)break;const name=STREETS.n[a[4]],p=map.latLngToContainerPoint([a[1]/1e5,a[2]/1e5]);
    if(!free(p,Math.min(170,name.length*6.4+8)))continue;n++;
    L.marker([a[1]/1e5,a[2]/1e5],{interactive:false,keyboard:false,icon:L.divIcon({className:"stl c"+(a[0]<2?"M":"m"),iconSize:[0,0],html:`<span style="transform:translate(-50%,-50%) rotate(${a[3]}deg)">${esc(name)}</span>`})}).addTo(gStreet);}
},150);}
map.on("moveend",drawStreets);map.on("zoomstart",()=>{clearTimeout(stT);gStreet.clearLayers();});
const gLbl=L.layerGroup();let roadsDec=null;
function decRoads(){
  if(roadsDec)return roadsDec;roadsDec={};
  for(const [k,arr] of Object.entries(ROADS))roadsDec[k]=arr.map(e=>{let x=e[0],y=e[1];const p=[[x/1e4,y/1e4]];for(let i=2;i<e.length;i+=2){x+=e[i];y+=e[i+1];p.push([x/1e4,y/1e4]);}return p;});
  return roadsDec;
}
/* Calles dibujadas por mosaicos desde un índice espacial: el zoom solo pinta lo visible */
const RW={lines:[],cells:new Map()};let roadTiles=null;
const CELLS=16384;
function buildRoadIndex(){
  const R=decRoads(),order=["residential","unclassified","tertiary","secondary","primary","trunk"];
  order.forEach((k,ci)=>{for(const l of R[k]||[]){
    const a=new Float64Array(l.length*2);let x0=9,x1=-9,y0=9,y1=-9;
    for(let i=0;i<l.length;i++){const x=(l[i][1]+180)/360,y=.5-Math.log(Math.tan(Math.PI/4+l[i][0]*Math.PI/360))/(2*Math.PI);a[2*i]=x;a[2*i+1]=y;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
    const id=RW.lines.length;RW.lines.push({c:ci,p:a});
    for(let cx=Math.floor(x0*CELLS);cx<=Math.floor(x1*CELLS);cx++)for(let cy=Math.floor(y0*CELLS);cy<=Math.floor(y1*CELLS);cy++){const key=cx*65536+cy;let q=RW.cells.get(key);if(!q)RW.cells.set(key,q=[]);q.push(id);}
  }});
  roadsDec=null;
}
const RW_W=[.8,1,1.4,2,2.8,3.4];
function drawRoadTile(c,tx,ty,z,size,cols){
  const n=2**z,sc=size*n,ox=tx*size,oy=ty*size,pad=8/sc;
  const x0=tx/n-pad,x1=(tx+1)/n+pad,y0=ty/n-pad,y1=(ty+1)/n+pad;
  const buckets=[[],[],[],[],[],[]],seen=new Set();
  const take=a=>{for(const id of a){if(seen.has(id))continue;seen.add(id);const ln=RW.lines[id];if(ln.c<2&&z<14)continue;buckets[ln.c].push(ln.p);}};
  const cx0=Math.floor(x0*CELLS),cx1=Math.floor(x1*CELLS),cy0=Math.floor(y0*CELLS),cy1=Math.floor(y1*CELLS);
  if((cx1-cx0+1)*(cy1-cy0+1)>6000){for(const [key,a] of RW.cells){const cx=Math.floor(key/65536),cy=key%65536;if(cx>=cx0&&cx<=cx1&&cy>=cy0&&cy<=cy1)take(a);}}
  else for(let cx=cx0;cx<=cx1;cx++)for(let cy=cy0;cy<=cy1;cy++){const a=RW.cells.get(cx*65536+cy);if(a)take(a);}
  const k=Math.max(.6,Math.min(1.6,(z-10)/4.5+.55));
  c.lineCap="round";c.lineJoin="round";
  for(let ci=0;ci<6;ci++){const bk=buckets[ci];if(!bk.length)continue;
    c.beginPath();
    for(const p of bk){let px=p[0]*sc-ox,py=p[1]*sc-oy;c.moveTo(px,py);const m=p.length;
      for(let i=2;i<m;i+=2){const qx=p[i]*sc-ox,qy=p[i+1]*sc-oy;if(Math.abs(qx-px)+Math.abs(qy-py)<.8&&i<m-2)continue;c.lineTo(qx,qy);px=qx;py=qy;}}
    c.strokeStyle=ci<3?cols.m:cols.M;c.lineWidth=RW_W[ci]*k;c.stroke();}
}
const RoadTiles=L.GridLayer.extend({createTile(co){
  const t=document.createElement("canvas"),ts=this.getTileSize(),d=window.devicePixelRatio||1;
  t.width=ts.x*d;t.height=ts.y*d;const c=t.getContext("2d");c.scale(d,d);
  drawRoadTile(c,co.x,co.y,co.z,ts.x,{m:css("--road"),M:css("--roadM")});return t;}});
function ensureRoadTiles(){
  if(!roadTiles){buildRoadIndex();roadTiles=new RoadTiles({pane:"roads",tileSize:256,updateWhenZooming:false,updateInterval:80,keepBuffer:3}).addTo(map);}
  else roadTiles.redraw();
}
function drawBase(){
  gBase.clearLayers();gLbl.clearLayers();gRoads.clearLayers();gMinor.clearLayers();gTM.clearLayers();gEst.clearLayers();
  for(const l of LOCALIDADES){
    L.polygon(l.r,{renderer:svg,className:"bm-land",interactive:false}).addTo(gBase);
    if(l.n!=="Sumapaz")L.marker(l.c,{pane:"lbl",interactive:false,keyboard:false,icon:L.divIcon({className:"bus",iconSize:[0,0],html:'<span class="loc">'+esc(l.n)+'</span>'})}).addTo(gLbl);
  }
  ensureRoadTiles();
  const tc=css("--troncal");
  for(const t of TRONC)L.polyline(t.p,{renderer:cvRoads,color:tc,weight:3.4,opacity:.8,interactive:false,lineCap:"round"}).addTo(gTM);
  for(const e of ESTS)L.circleMarker([e[0],e[1]],{renderer:cvRoads,radius:3.8,weight:2,color:tc,fillColor:css("--panel"),fillOpacity:1})
    .bindTooltip(`<b>${esc(e[2])}</b><br>${esc(e[3])}${e[4]?" · "+esc(e[4]):""}`).addTo(gEst);
  syncTM();
}
function syncTM(){ if(S.hasData&&map.hasLayer(gTM))map.removeLayer(gTM); if(!S.hasData&&!map.hasLayer(gTM))gTM.addTo(map); }
new MutationObserver(()=>{drawBase();drawNet();}).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{drawBase();drawNet();});
/* ---------- CSV / GTFS ---------- */
function parseLine(line){
  const out=[];let i=0,n=line.length;
  while(i<=n){
    if(line[i]==='"'){let v="";i++;while(i<n){if(line[i]==='"'){if(line[i+1]==='"'){v+='"';i+=2;}else{i++;break;}}else v+=line[i++];}out.push(v);if(line[i]===",")i++;else break;}
    else{const j=line.indexOf(",",i);if(j<0){out.push(line.slice(i));break;}out.push(line.slice(i,j));i=j+1;if(i===n){out.push("");break;}}
  }
  return out;
}
function* csvRows(t){
  let pos=t.charCodeAt(0)===0xFEFF?1:0;let nl=t.indexOf("\n",pos);if(nl<0)nl=t.length;
  const head=parseLine(t.slice(pos,nl).replace(/\r$/,"")).map(h=>h.trim());pos=nl+1;
  while(pos<t.length){nl=t.indexOf("\n",pos);if(nl<0)nl=t.length;const line=t.slice(pos,nl).replace(/\r$/,"");pos=nl+1;if(!line)continue;
    const f=parseLine(line),o={};for(let k=0;k<head.length;k++)o[head[k]]=f[k]??"";yield o;}
}
async function zipText(name){const f=S.zip.file(name)||S.zip.file(new RegExp("(^|/)"+name.replace(".","\\.")+"$"))[0];return f?f.async("string"):null;}
const tick=()=>new Promise(r=>setTimeout(r,15));
function classify(r){
  const sn=(r.route_short_name||"").trim().toUpperCase();
  const txt=norm([r.route_long_name,r.route_desc,r.agency_id].join(" "));
  if(/alimentador/.test(txt)||/^\d{1,2}-\d{1,2}$/.test(sn))return"alimentador";
  if(/\bdual\b/.test(txt))return"dual";
  if(/troncal|transmilenio/.test(txt)||/^[A-M]\d{2}$/.test(sn))return"troncal";
  if(r.route_type==="3"||/^[A-Z]{0,2}\d{1,3}[A-Z]?$/.test(sn)||/sitp|zonal/.test(txt))return"zonal";
  return"otro";
}
function resetStatic(){S.xsMap=new Map();S.stops.clear();S.routes.clear();S.trips.clear();S.tripsByRoute.clear();S.shapes.clear();S.reps=null;S.repStops=null;S.shapesDone=false;S.sel=null;gNet.clearLayers();gStops.clearLayers();gRoute.clearLayers();}
async function loadGTFS(buf){
  setNote("Leyendo GTFS…"); await tick();
  S.zip=await JSZip.loadAsync(buf); resetStatic();
  for(const r of csvRows(await zipText("routes.txt")||""))
    S.routes.set(r.route_id,{id:r.route_id,short:r.route_short_name||r.route_id,long:r.route_long_name||"",type:classify(r),color:null});
  const tt=await zipText("trips.txt");
  if(tt)for(const t of csvRows(tt)){const o={id:t.trip_id,route:t.route_id,head:t.trip_headsign||"",dir:t.direction_id||"0",shape:t.shape_id||""};S.trips.set(t.trip_id,o);let a=S.tripsByRoute.get(t.route_id);if(!a)S.tripsByRoute.set(t.route_id,a=[]);a.push(o);}
  for(const s of csvRows(await zipText("stops.txt")||"")){const lat=+s.stop_lat,lon=+s.stop_lon;if(!isFinite(lat)||!lat)continue;S.stops.set(s.stop_id,{id:s.stop_id,code:s.stop_code||"",name:s.stop_name||s.stop_id,lat,lon,desc:s.stop_desc||""});}
  buildReps(); S.hasData=true; syncTM();
  setNote("Dibujando la red de rutas…"); await tick();
  await loadShapes(); drawNet(); applyZoom();
  fitAll(); setPill(); if(S.last)ingest(S.last); renderAll();
  setNote(`<b>${S.routes.size}</b> rutas · <b>${S.stops.size}</b> paradas`);
}
function fitAll(){const pts=[];for(const s of S.stops.values())pts.push([s.lat,s.lon]);const b=L.latLngBounds(pts.length?pts:[[4.5,-74.2],[4.8,-74.0]]);map.fitBounds(b.pad(.03));}
function buildReps(){
  if(S.reps)return;S.reps=new Map();
  for(const [rid,trips] of S.tripsByRoute){const by=new Map(),cnt=new Map();for(const t of trips)cnt.set(t.shape||t.id,(cnt.get(t.shape||t.id)||0)+1);
    for(const t of trips){const cur=by.get(t.dir);if(!cur||cnt.get(t.shape||t.id)>cnt.get(cur.shape||cur.id))by.set(t.dir,t);}S.reps.set(rid,by);}
}
async function loadShapes(){
  if(S.shapesDone)return;S.shapesDone=true;
  const want=new Set();for(const by of S.reps.values())for(const t of by.values())if(t.shape)want.add(t.shape);
  const txt=await zipText("shapes.txt");if(!txt)return;
  const tmp=new Map();
  for(const r of csvRows(txt)){if(!want.has(r.shape_id))continue;let a=tmp.get(r.shape_id);if(!a)tmp.set(r.shape_id,a=[]);a.push([+r.shape_pt_sequence,+r.shape_pt_lat,+r.shape_pt_lon]);}
  for(const [id,a] of tmp){a.sort((x,y)=>x[0]-y[0]);const st=Math.max(1,Math.floor(a.length/400));const o=[];for(let i=0;i<a.length;i+=st)o.push([a[i][1],a[i][2]]);o.push([a[a.length-1][1],a[a.length-1][2]]);S.shapes.set(id,o);}
}
function drawNet(){
  gNet.clearLayers();if(!S.showNet)return;
  const dim=S.sel?.12:.55;
  for(const [rid,by] of (S.reps||[])){const r=S.routes.get(rid);if(!r||!S.typeOn.has(r.type))continue;
    for(const t of by.values()){const p=S.shapes.get(t.shape);if(p)L.polyline(p,{renderer:cvNet,color:r.color||tcol(r.type),weight:r.type==="troncal"?2.6:1.4,opacity:dim,interactive:false}).addTo(gNet);}}
}
function drawStops(){
  gStops.clearLayers();
  for(const s of S.stops.values())L.circleMarker([s.lat,s.lon],{renderer:cv,radius:3.2,weight:1,color:css("--muted"),fillColor:css("--panel"),fillOpacity:1}).on("click",()=>stopFocus(s,false)).addTo(gStops);
}
function applyZoom(){
  const z=map.getZoom(),ez=z>=14.5;
  if(ez!==S.exZoom){S.exZoom=ez;S.selT0=performance.now();const t=performance.now();for(const v of S.vehicles.values())if(v._ex&&!S.sel){v._bfx=v._wx;v._bfy=v._wy;v._bt0=t;v._cyc=null;}speedChip();if(S.vehicles.size)syncBuses();}
  const want=S.showStops&&S.stops.size&&z>=13.5;
  if(want&&!gStops.getLayers().length)drawStops();
  if(want&&!map.hasLayer(gStops))gStops.addTo(map);
  if(!want&&map.hasLayer(gStops))map.removeLayer(gStops);
  if(z>=14&&!map.hasLayer(gMinor))gMinor.addTo(map);if(z<14&&map.hasLayer(gMinor))map.removeLayer(gMinor);
  if(z<=13.5&&!map.hasLayer(gLbl))gLbl.addTo(map);if(z>13.5&&map.hasLayer(gLbl))map.removeLayer(gLbl);
}
map.on("zoomend",applyZoom);

/* ---------- Paradas por ruta ---------- */
async function ensureRepStops(){
  if(S.repStops)return;if(!S.zip){S.repStops=new Map();return;}buildReps();
  const wanted=new Map();for(const [rid,by] of S.reps)for(const [d,t] of by)wanted.set(t.id,[rid,d]);
  const tmp=new Map();let txt=null;
  try{txt=await zipText("stop_times.txt");}catch(e){setNote("stop_times.txt es demasiado grande para el navegador; solo se dibuja la traza.",true);}
  if(txt){
    setNote("Indexando paradas por ruta (una sola vez)…");await tick();
    let nl=txt.indexOf("\n");const head=parseLine(txt.slice(txt.charCodeAt(0)===0xFEFF?1:0,nl).replace(/\r$/,"")).map(h=>h.trim());
    const iT=head.indexOf("trip_id"),iS=head.indexOf("stop_id"),iQ=head.indexOf("stop_sequence");let pos=nl+1;
    while(pos<txt.length){nl=txt.indexOf("\n",pos);if(nl<0)nl=txt.length;
      let tid=null;if(iT===0&&txt[pos]!=='"'){const c=txt.indexOf(",",pos);if(c>0&&c<nl)tid=txt.slice(pos,c);}
      if(tid===null||wanted.has(tid)){const f=parseLine(txt.slice(pos,nl).replace(/\r$/,""));tid=f[iT];if(wanted.has(tid)){let a=tmp.get(tid);if(!a)tmp.set(tid,a=[]);a.push({q:+f[iQ],id:f[iS]});}}
      pos=nl+1;}
  }
  S.repStops=new Map();
  for(const [tid,[rid,d]] of wanted){const a=(tmp.get(tid)||[]).sort((x,y)=>x.q-y.q).map(x=>S.stops.get(x.id)).filter(Boolean);let m=S.repStops.get(rid);if(!m)S.repStops.set(rid,m=new Map());m.set(d,a);}
}
async function stopRoutes(s){
  await ensureRepStops();const out=[];
  for(const [rid,dirs] of S.repStops)for(const a of dirs.values())if(a.some(x=>x.id===s.id)){out.push(rid);break;}
  return out;
}

/* ---------- Selección de ruta ---------- */
async function selectRoute(rid,{fit=true}={}){
  S.sel=rid;S.follow=null;gRoute.clearLayers();drawNet();
  for(const v of S.vehicles.values()){v._bt0=null;v._cyc=null;}
  if(!rid){speedChip();syncBuses();renderAll();return;}
  const r=S.routes.get(rid);if(!r)return;
  const by=S.reps?.get(rid)||new Map();
  if(![...by.keys()].includes(S.dir))S.dir=[...by.keys()][0]||"0";
  renderAll();syncBuses();
  if(!S.demo)await ensureRepStops();
  drawRouteLayer(fit);
  if(S.speedMul>1)for(const v of S.vehicles.values())if(v.routeId===rid&&!v._ex)setupExtrap(v);
  S.selT0=performance.now();speedChip();
  syncBuses();
  if(fit&&!(S.reps?.get(rid)?.size)){const pts=[...S.vehicles.values()].filter(v=>v.routeId===rid).map(v=>[v.lat,v.lon]);if(pts.length)map.fitBounds(L.latLngBounds(pts).pad(.25),{maxZoom:15});}
  {const n=[...S.vehicles.values()].filter(v=>v.routeId===rid&&v._ex).length;renderAll();setNote(`<b>${esc(r.short)}</b> · ${esc(r.long)}${n?` · <b>${n}</b> buses con movimiento estimado${S.speedMul>1?` · <b>cámara rápida ×${S.speedMul}</b>`:""}`:""}`);}
}
function drawRouteLayer(fit){
  gRoute.clearLayers();const r=S.routes.get(S.sel);if(!r)return;
  const col=r.color||tcol(r.type),by=S.reps?.get(S.sel)||new Map(),b=[];
  for(const [d,t] of by){const stops=S.repStops?.get(S.sel)?.get(d)||[];const p=S.shapes.get(t.shape)||stops.map(s=>[s.lat,s.lon]);const on=d===S.dir;
    if(p.length>1){L.polyline(p,{renderer:cv,color:col,weight:on?6:3,opacity:on?.95:.35,dashArray:on?null:"2 7",lineCap:"round"}).addTo(gRoute);if(on)b.push(...p);}
    if(on)stops.forEach((s,i)=>L.circleMarker([s.lat,s.lon],{renderer:cv,radius:5,weight:2.5,color:col,fillColor:css("--panel"),fillOpacity:1}).bindTooltip(`${i+1}. ${s.name}`).on("click",()=>stopFocus(s,false)).addTo(gRoute));}
  if(fit&&b.length)map.fitBounds(L.latLngBounds(b).pad(.12));
}

/* ---------- Buses ---------- */
const gPill=L.layerGroup().addTo(map), gAlert=L.layerGroup().addTo(map);
const fmtT=ts=>ts?new Date(ts*1000).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"America/Bogota"}):"—";
function b64(x){const bin=atob(x),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
function delayOf(v){const u=v.tripId&&S.tu.get(v.tripId);return u&&isFinite(u.delay)?u.delay:null;}
function delayText(d){if(d==null)return"Sin dato";if(Math.abs(d)>7200)return"Dato desactualizado";const m=Math.round(Math.abs(d)/60);if(m<2)return"A tiempo";return d>0?`${m} min tarde`:`${m} min adelantado`;}
function palette(){const t={};for(const k of Object.keys(TYPES))t[k]=css("--"+k);return{t,late:css("--troncal"),warn:"#f5a524",ok:css("--alimentador"),early:css("--zonal"),none:css("--otro")};}
function busColor(v,pal){
  if(S.colorBy==="tipo"){const r=v.route;return r?.color||pal.t[r?.type||"otro"];}
  const d=delayOf(v);if(d==null||Math.abs(d)>7200)return pal.none;
  return d>600?pal.late:d>180?pal.warn:d<-300?pal.early:pal.ok;
}
const lerp=(a,b,u)=>a+(b-a)*u;
function wc(lat,lon){return[(lon+180)/360,.5-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/(2*Math.PI)];}
const MPW=40075016.686*Math.cos(4.65*Math.PI/180);
function buildXS(rid){
  const out=[];
  for(const t of (S.reps?.get(rid)?.values()||[])){const p=S.shapes.get(t.shape);if(!p||p.length<2)continue;
    const w=new Float64Array(p.length*2),cum=new Float64Array(p.length);
    for(let i=0;i<p.length;i++){const q=wc(p[i][0],p[i][1]);w[2*i]=q[0];w[2*i+1]=q[1];if(i)cum[i]=cum[i-1]+Math.hypot(w[2*i]-w[2*i-2],w[2*i+1]-w[2*i-1])*MPW;}
    out.push({w,cum,n:p.length});}
  return out;
}
function snapOn(sh,x,y,lo,hi,ref){
  let best=null;
  for(let i=0;i<sh.n-1;i++){if(sh.cum[i+1]<lo||sh.cum[i]>hi)continue;
    const ax=sh.w[2*i],ay=sh.w[2*i+1],dx=sh.w[2*i+2]-ax,dy=sh.w[2*i+3]-ay,L2=dx*dx+dy*dy;
    let u=L2?((x-ax)*dx+(y-ay)*dy)/L2:0;u=u<0?0:u>1?1:u;
    const d=Math.hypot(x-(ax+dx*u),y-(ay+dy*u))*MPW;
    const ss=sh.cum[i]+(sh.cum[i+1]-sh.cum[i])*u,sc=ref==null?d:d+.004*Math.max(0,ref-ss)+.2*Math.max(0,ss-ref);
    if(!best||sc<best.sc)best={d,s:ss,sc};}
  return best;
}
function xsFor(rid){let x=S.xsMap.get(rid);if(!x){x=buildXS(rid);S.xsMap.set(rid,x);}return x;}
function setupExtrap(v){
  v._ex=null;v._exDone=false;
  if(!S.shapes.size||!v.routeId)return;
  const xs=xsFor(v.routeId);if(!xs.length)return;
  const u=v.tripId&&S.tu.get(v.tripId),st=S.stops.get(u?.stops?.[0]?.stopId||v.stopId);if(!st)return;
  const sw=wc(st.lat,st.lon);let bs=null,bsh=null;
  for(const sh of xs){const a=snapOn(sh,sw[0],sw[1],-1e9,1e9);if(a&&a.d<220&&(!bs||a.d<bs.d)){bs=a;bsh=sh;}}
  if(!bs)return;
  const b=snapOn(bsh,v._wx,v._wy,bs.s-12000,bs.s+1500,bs.s);
  if(!b||b.d>220)return;
  v._ex={sh:bsh,s0:b.s,sNext:bs.s,end:bsh.cum[bsh.n-1]};
}
function exOn(v){return S.speedMul>1&&v._ex&&(S.sel?v.routeId===S.sel:(S.exZoom||v.key===S.follow));}
const TAU=30,TAU_S=3500;
function gAge(age){return Math.min(75,Math.max(0,age-15));}
function alongWorld(e,sv){const c=e.sh.cum;let lo=0,hi=e.sh.n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(c[m]<=sv)lo=m;else hi=m;}
  const L=c[hi]-c[lo]||1,u=Math.min(1,Math.max(0,(sv-c[lo])/L)),ax=e.sh.w[2*lo],ay=e.sh.w[2*lo+1],bx=e.sh.w[2*hi],by=e.sh.w[2*hi+1];
  return[ax+(bx-ax)*u,ay+(by-ay)*u,(Math.atan2(bx-ax,-(by-ay))*180/Math.PI+360)%360];}
function predictW(v,wallSec){
  const sp=v._spd||0;if(sp<.3||v._ux==null)return[v._wx,v._wy];
  const m=sp*gAge(wallSec-(v.ts||wallSec))/MPW;return[v._wx+v._ux*m,v._wy+v._uy*m];}
function exW(v,now){
  const e=v._ex,wall=Date.now()/1000,age=Math.min(420,Math.max(0,wall-(v.ts||wall))),spd=v._spd==null?4.2:v._spd,mul=S.speedMul||1;
  const el=(now-S.selT0)/1000,tsel=mul>1?el%60:0,cyc=mul>1?Math.floor(el/60):0;
  const s=Math.min(e.end,e.s0+spd*(age+tsel*mul)),c=e.sh.cum;
  v._exDone=mul===1&&(age>=420||s>=e.end);
  let lo=0,hi=e.sh.n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}
  const L=c[hi]-c[lo]||1,u=Math.min(1,Math.max(0,(s-c[lo])/L)),ax=e.sh.w[2*lo],ay=e.sh.w[2*lo+1],bx=e.sh.w[2*hi],by=e.sh.w[2*hi+1];
  v.bearing=(Math.atan2(bx-ax,-(by-ay))*180/Math.PI+360)%360;
  if(mul>1){if(v._cyc!=null&&v._cyc!==cyc&&v._lx!=null){v._bfx=v._lx;v._bfy=v._ly;v._bt0=now;}v._cyc=cyc;}else v._cyc=null;
  return[ax+(bx-ax)*u,ay+(by-ay)*u];
}
function curW(v,now){
  if(exOn(v)){
    let w=exW(v,now);
    if(v._bt0!=null){const u=Math.min(1,(now-v._bt0)/3500);if(u<1)w=[v._bfx+(w[0]-v._bfx)*u,v._bfy+(w[1]-v._bfy)*u];}
    v._lx=w[0];v._ly=w[1];return w;
  }
  if(S.est){
    const P=predictW(v,Date.now()/1000);
    if(v._dx==null){v._dx=P[0];v._dy=P[1];v._dl=now;v._cv=0;}
    const dt=Math.max(0,now-(v._dl||now));
    if(dt>0){const far=Math.hypot(P[0]-v._dx,P[1]-v._dy)*MPW;if(far>800){v._dx=P[0];v._dy=P[1];}else{const a=1-Math.exp(-dt/TAU_S);v._dx+=(P[0]-v._dx)*a;v._dy+=(P[1]-v._dy)*a;}v._dl=now;}
    v._cv=Math.hypot(P[0]-v._dx,P[1]-v._dy)*MPW;
    return[v._dx,v._dy];
  }
  const u=v._fx==null?1:Math.min(1,(now-v._t0)/v._d);return u>=1?[v._wx,v._wy]:[v._fx+(v._wx-v._fx)*u,v._fy+(v._wy-v._fy)*u];
}
function curPos(v,now){const w=curW(v,now);return{lon:w[0]*360-180,lat:(2*Math.atan(Math.exp((.5-w[1])*2*Math.PI))-Math.PI/2)*180/Math.PI};}
function openBus(k){const v=S.vehicles.get(k);if(!v)return;L.popup({offset:[0,-4]}).setLatLng(((c)=>[c.lat,c.lon])(curPos(v,performance.now()))).setContent(busPopup(v)).openOn(map);}
function visible(v){
  if(!S.showBuses)return false;const t=v.route?.type||"otro";if(!S.typeOn.has(t))return false;
  if(S.sel&&v.routeId!==S.sel)return false;return true;
}
function syncBuses(){
  const pal=palette();
  for(const v of S.vehicles.values()){v._col=busColor(v,pal);v._vis=visible(v);}
  busLayer.redraw();
}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
const SPR=new Map();
function busSprite(col,flip,k,dot){
  const key=col+"|"+(flip?1:0)+"|"+k+"|"+(dot?1:0),hit=SPR.get(key);if(hit)return hit;
  const d=window.devicePixelRatio||1,W=Math.ceil(dot?9:30*k),H=Math.ceil(dot?9:19*k),cv=document.createElement("canvas");
  cv.width=W*d;cv.height=H*d;const c=cv.getContext("2d");c.scale(d,d);c.translate(W/2,H/2);
  if(dot){c.beginPath();c.arc(0,0,3,0,6.3);c.fillStyle=col;c.fill();c.lineWidth=1.1;c.strokeStyle="#fff";c.stroke();}
  else{c.scale(flip?-k:k,k);c.lineWidth=1.7/k;c.strokeStyle="#fff";c.fillStyle=col;rr(c,-12,-6.5,24,12.5,3.2);c.fill();c.stroke();
    c.fillStyle="rgba(255,255,255,.92)";for(let i=0;i<4;i++)c.fillRect(-9.2+i*4.5,-4.4,3.4,3.3);c.fillRect(8.4,-4.4,2.6,5.6);
    c.fillStyle="rgba(0,0,0,.28)";c.fillRect(-12,2.2,24,1.6);
    c.fillStyle="#1b1f27";for(const wx of[-6.4,6.4]){c.beginPath();c.arc(wx,6,2.2,0,6.3);c.fill();c.lineWidth=.8/k;c.stroke();}}
  const o={cv,W,H};SPR.set(key,o);return o;
}
const BusLayer=L.Layer.extend({
  onAdd(m){this._c=L.DomUtil.create("canvas","leaflet-zoom-animated");this._c.style.pointerEvents="none";m.getPane("buses").appendChild(this._c);this._ctx=this._c.getContext("2d");
    m.on("moveend",this._reset,this);m.on("zoomanim",this._anim,this);this._reset();},
  onRemove(m){L.DomUtil.remove(this._c);m.off("moveend",this._reset,this);m.off("zoomanim",this._anim,this);},
  _anim(e){const m=this._map,sc=m.getZoomScale(e.zoom),off=m._latLngBoundsToNewLayerBounds(m.getBounds(),e.zoom,e.center).min;L.DomUtil.setTransform(this._c,off,sc);},
  _reset(){const m=this._map,sz=m.getSize(),min=m.containerPointToLayerPoint(sz.multiplyBy(-.25)).round(),b=new L.Bounds(min,min.add(sz.multiplyBy(1.5)).round()),d=window.devicePixelRatio||1,s=b.getSize();
    this._b=b;const c=this._c;c.width=s.x*d;c.height=s.y*d;c.style.width=s.x+"px";c.style.height=s.y+"px";
    this._ctx.setTransform(d,0,0,d,-b.min.x*d,-b.min.y*d);L.DomUtil.setPosition(c,b.min);this.redraw();},
  redraw(){
    if(!this._map||!this._b)return;L.DomUtil.setTransform(this._c,this._b.min,1);
    const m=this._map,c=this._ctx,b=this._b,z=m.getZoom(),dot=z<12.5,k=Math.round(Math.max(.5,Math.min(1.25,(z-11.2)/4.2))*10)/10,sz=b.getSize();
    c.clearRect(b.min.x,b.min.y,sz.x,sz.y);this._fast=false;let lab=0,moving=false;const now=performance.now(),t0=now,sc=256*Math.pow(2,z),org=m.getPixelOrigin();
    const fg=z>=16?css("--fg"):null,bg=z>=16?css("--mapbg"):null;if(fg){c.font="700 11px system-ui,sans-serif";c.textAlign="center";c.lineWidth=3;c.lineJoin="round";}
    for(const v of S.vehicles.values()){
      if(S.est&&!exOn(v)){if(v._spd>.3&&Date.now()/1000-(v.ts||0)<200)moving=true;}
      if(v._fx!=null&&now-v._t0<v._d)moving=true;
      if(v._vis&&exOn(v)&&(!v._exDone||(v._bt0!=null&&now-v._bt0<3500))){moving=true;this._fast=true;}
      if(!v._vis)continue;const w=curW(v,now),p={x:w[0]*sc-org.x,y:w[1]*sc-org.y};if(S.est&&v._cv>.4)moving=true;
      if(p.x<b.min.x-20||p.x>b.max.x+20||p.y<b.min.y-20||p.y>b.max.y+20)continue;
      const sp=busSprite(v._col,isFinite(v.bearing)&&v.bearing>180,k,dot);c.drawImage(sp.cv,p.x-sp.W/2,p.y-sp.H/2,sp.W,sp.H);
      if(fg&&lab<400){const t=v.route?.short||v.routeId||"";if(t){lab++;c.strokeStyle=bg;c.strokeText(t,p.x,p.y-12*k);c.fillStyle=fg;c.fillText(t,p.x,p.y-12*k);}}
    }
    this._cost=performance.now()-t0;
    if(moving&&!this._raf)this._raf=requestAnimationFrame(()=>this._loop());
  },
  _loop(){
    this._raf=0;if(!this._map)return;
    const n=performance.now(),z=this._map.getZoom(),gap=this._fast?Math.max(16,(this._cost||0)*1.2):Math.max(z<13.5?130:z<15?66:33,(this._cost||0)*2.2);
    if(document.hidden||this._map._animatingZoom||n-(this._last||0)<gap){this._raf=requestAnimationFrame(()=>this._loop());return;}
    this._last=n;this.redraw();
  }
});
const busLayer=new BusLayer().addTo(map);
function nearestBus(pt,maxPx){let best=null,bd=maxPx*maxPx;for(const [k,v] of S.vehicles){if(!v._vis)continue;const cp=curPos(v,performance.now()),q=map.latLngToContainerPoint([cp.lat,cp.lon]),dx=q.x-pt.x,dy=q.y-pt.y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=k;}}return best;}
map.on("click",e=>{const k=nearestBus(e.containerPoint,13);if(k)openBus(k);});
let mvT=0;map.on("mousemove",e=>{const n=performance.now();if(n-mvT<70)return;mvT=n;map.getContainer().style.cursor=S.showBuses&&nearestBus(e.containerPoint,12)?"pointer":"";});
function refreshPills(){}
function inferType(e){if((e.tripId||"").startsWith("TTBD"))return"troncal";if(/^Z\d/.test(e.label||e.vid||""))return"zonal";return"otro";}
function ingest(list){
  {let bts=0;for(const e of list)if((e.ts||0)>bts)bts=e.ts;
   if(bts&&S.lastBts&&bts>S.lastBts){const g=bts-S.lastBts;if(g>=8&&g<=120){S.gaps.push(g);if(S.gaps.length>6)S.gaps.shift();}}
   if(bts)S.lastBts=Math.max(S.lastBts||0,bts);
   const med=S.gaps.length?[...S.gaps].sort((a,b)=>a-b)[S.gaps.length>>1]:21;S.glide=Math.max(30,Math.min(60,1.6*med))*1000;}
  S.last=list;const seen=new Set();const vote=new Map();const now=performance.now();
  for(const e of list){
    const key=e.vid||e.id||e.plate||e.tripId||(e.lat+","+e.lon),trip=S.trips.get(e.tripId),routeId=e.routeId||trip?.route||"";
    let route=S.routes.get(routeId);
    if(!route&&routeId&&!S.hasData){route={id:routeId,short:routeId,long:"Ruta "+routeId,type:"otro",virtual:true};S.routes.set(routeId,route);}
    if(route?.virtual){let m=vote.get(routeId);if(!m)vote.set(routeId,m={});const t=inferType(e);m[t]=(m[t]||0)+1;}
    const prev=S.vehicles.get(key);let bearing=e.bearing;
    if(bearing==null&&prev&&(Math.abs(prev.lat-e.lat)+Math.abs(prev.lon-e.lon))>3e-5)bearing=(Math.atan2((e.lon-prev.lon)*Math.cos(e.lat*Math.PI/180),e.lat-prev.lat)*180/Math.PI+360)%360;
    else if(bearing==null&&prev)bearing=prev.bearing;
    const nv={key,...e,bearing,routeId,route,head:trip?.head||e.head||"",dir:e.dir??trip?.dir};
    {const w=wc(e.lat,e.lon);nv._wx=w[0];nv._wy=w[1];}
    if(prev){
      const dl=Math.abs(prev.lat-e.lat)+Math.abs(prev.lon-e.lon);
      nv._spd=prev._spd;nv._ux=prev._ux;nv._uy=prev._uy;nv._dx=prev._dx;nv._dy=prev._dy;nv._dl=prev._dl;nv._cv=prev._cv;nv._h=prev._h;
      if(e.ts!=null&&e.ts===prev.ts){nv._fx=prev._fx;nv._fy=prev._fy;nv._t0=prev._t0;nv._d=prev._d;nv._ex=prev._ex;nv._exDone=prev._exDone;nv._bfx=prev._bfx;nv._bfy=prev._bfy;nv._bt0=prev._bt0;nv.bearing=prev.bearing;nv.lat=prev.lat;nv.lon=prev.lon;nv._wx=prev._wx;nv._wy=prev._wy;}   // sin reporte nuevo
      else if(dl>=.0075){nv._spd=0;nv._dx=null;nv._h=null;}
      if(!(e.ts!=null&&e.ts===prev.ts)&&dl>1e-6&&dl<.0075){const cur=curW(prev,now);const dt=(e.ts||0)-(prev.ts||0);{}nv._bfx=cur[0];nv._bfy=cur[1];nv._bt0=now;nv._fx=cur[0];nv._fy=cur[1];nv._t0=now;nv._d=S.glide;}
    }
    {const newRep=!prev||e.ts!==prev.ts;
     if(newRep){const h=(prev&&prev._h?prev._h:[]).filter(x=>(e.ts||0)-x[0]<=150);h.push([e.ts||0,nv._wx,nv._wy]);nv._h=h;
       let o=null;for(let q=h.length-2;q>=0;q--){if(h[h.length-1][0]-h[q][0]>=28){o=h[q];break;}}
       if(o){const dt=h[h.length-1][0]-o[0],dxw=nv._wx-o[1],dyw=nv._wy-o[2],hh=Math.hypot(dxw,dyw),dm=hh*MPW;
         if(dm>8&&dt>0){nv._spd=Math.min(20,dm/dt);nv._ux=dxw/hh;nv._uy=dyw/hh;}else nv._spd=0;}}}
    if(S.speedMul>1&&S.shapes.size&&(!nv._ex||(prev&&e.ts!==prev.ts)))setupExtrap(nv);
    nv._seen=now;S.vehicles.set(key,nv);seen.add(key);}
  for(const [k,v] of [...S.vehicles])if(!seen.has(k)&&now-(v._seen||0)>90000)S.vehicles.delete(k);
  for(const [rid,m] of vote){const r=S.routes.get(rid);if(r)r.type=Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0];}
  syncBuses();renderKPIs();softRender();
}
function setTU(list){
  S.tu=new Map();S.arr=new Map();
  for(const u of list){if(u.delay==null&&u.stops[0]?.d!=null)u.delay=u.stops[0].d;S.tu.set(u.tripId,u);
    const s=u.stops[0];if(s?.stopId){let a=S.arr.get(s.stopId);if(!a)S.arr.set(s.stopId,a=[]);a.push({routeId:u.routeId,t:s.time,delay:u.delay,plate:u.plate});}}
  S.tuStamp=Math.max(0,...list.map(u=>u.ts||0));
  if(S.speedMul>1&&S.shapes.size)for(const v of S.vehicles.values())if(!v._ex)setupExtrap(v);
  syncBuses();renderKPIs();renderPane();
}
function setAlerts(list){
  S.alerts=list;S.alByRoute=new Map();S.alByStop=new Map();S.alOpen=null;gAlert.clearLayers();
  list.forEach((a,i)=>{for(const r of a.routes){let x=S.alByRoute.get(r);if(!x)S.alByRoute.set(r,x=[]);x.push(i);}for(const t of a.stops){let x=S.alByStop.get(t);if(!x)S.alByStop.set(t,x=[]);x.push(i);}});
  renderKPIs();renderPane();
}

/* ---------- Protobuf GTFS-realtime ---------- */
function pbFields(buf,s,e){
  const out=[];let p=s;const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const vi=()=>{let r=0,m=1,b,n=0;const st=p;do{b=buf[p++];r+=(b&127)*m;m*=128;n++;}while(b&128&&p<e);if(n>=10){let big=0n;for(let i=0;i<n;i++)big|=BigInt(buf[st+i]&127)<<BigInt(7*i);return Number(BigInt.asIntN(64,big));}return r;};
  while(p<e){const k=vi(),f=Math.floor(k/8),w=k&7;
    if(w===0)out.push([f,w,vi()]);else if(w===2){const l=vi();out.push([f,w,[p,p+l]]);p+=l;}
    else if(w===5){out.push([f,w,dv.getFloat32(p,true)]);p+=4;}else if(w===1){out.push([f,w,dv.getFloat64(p,true)]);p+=8;}else break;}
  return out;
}
const dec=new TextDecoder();
function decodeFeed(buf){
  const out=[],ts=r=>dec.decode(buf.subarray(r[0],r[1]));
  for(const [f,w,v] of pbFields(buf,0,buf.length)){if(f!==2||w!==2)continue;const ent={id:""};
    for(const [f2,w2,v2] of pbFields(buf,v[0],v[1])){if(f2===1)ent.id=ts(v2);
      if(f2===4&&w2===2)for(const [f3,,v3] of pbFields(buf,v2[0],v2[1])){
        if(f3===1)for(const [a,,b] of pbFields(buf,v3[0],v3[1])){if(a===1)ent.tripId=ts(b);if(a===5)ent.routeId=ts(b);if(a===6)ent.dir=String(b);}
        if(f3===2)for(const [a,,b] of pbFields(buf,v3[0],v3[1])){if(a===1)ent.lat=b;if(a===2)ent.lon=b;if(a===3)ent.bearing=b;if(a===5)ent.speed=b;}
        if(f3===5)ent.ts=v3;if(f3===7)ent.stopId=ts(v3);
        if(f3===8)for(const [a,,b] of pbFields(buf,v3[0],v3[1])){if(a===1)ent.vid=ts(b);if(a===2)ent.label=ts(b);if(a===3)ent.plate=ts(b);}}}
    if(isFinite(ent.lat)&&isFinite(ent.lon))out.push(ent);}
  return out;
}
function decodeJSON(j){
  const arr=Array.isArray(j)?j:(j.entity||j.vehicles||j.data||j.items||Object.values(j).find(Array.isArray)||[]);
  return arr.map(x=>{const v=x.vehicle||x,p=v.position||v,t=v.trip||v,d=v.vehicle||v;
    return{id:x.id||d.id||v.id,vid:d.id,label:d.label,plate:d.license_plate||d.licensePlate||d.plate,lat:+(p.latitude??p.lat),lon:+(p.longitude??p.lon??p.lng),bearing:p.bearing,speed:p.speed,routeId:t.route_id??t.routeId,tripId:t.trip_id??t.tripId,stopId:v.stop_id??v.stopId,ts:v.timestamp};}).filter(v=>isFinite(v.lat)&&isFinite(v.lon));
}
function entsOf(buf){return pbFields(buf,0,buf.length).filter(x=>x[0]===2&&x[1]===2).map(x=>x[2]);}
function decodeTU(buf){
  const out=[],tx=r=>dec.decode(buf.subarray(r[0],r[1]));
  for(const v of entsOf(buf))for(const [f,w,x] of pbFields(buf,v[0],v[1])){if(f!==3||w!==2)continue;
    const u={stops:[]};
    for(const [g,,y] of pbFields(buf,x[0],x[1])){
      if(g===1)for(const [a,,b] of pbFields(buf,y[0],y[1])){if(a===1)u.tripId=tx(b);if(a===5)u.routeId=tx(b);}
      if(g===2){const s={};for(const [a,,b] of pbFields(buf,y[0],y[1])){if(a===1)s.seq=b;if(a===4)s.stopId=tx(b);if(a===2||a===3)for(const [c,,d] of pbFields(buf,b[0],b[1])){if(c===2)s.time=d;if(c===1)s.d=d;}}u.stops.push(s);}
      if(g===3)for(const [a,,b] of pbFields(buf,y[0],y[1])){if(a===1)u.vid=tx(b);if(a===3)u.plate=tx(b);}
      if(g===4)u.ts=y;if(g===5)u.delay=y;}
    if(u.tripId)out.push(u);}
  return out;
}
function decodeAlerts(buf){
  const out=[],tx=r=>dec.decode(buf.subarray(r[0],r[1]));
  const text=r=>{let t="";for(const [a,,b] of pbFields(buf,r[0],r[1]))if(a===1)for(const [c,,d] of pbFields(buf,b[0],b[1]))if(c===1&&!t)t=tx(d);return t;};
  for(const v of entsOf(buf))for(const [f,w,x] of pbFields(buf,v[0],v[1])){if(f!==5||w!==2)continue;
    const a={routes:[],stops:[]};
    for(const [g,,y] of pbFields(buf,x[0],x[1])){
      if(g===1)for(const [h,,z] of pbFields(buf,y[0],y[1])){if(h===1)a.start=z;if(h===2)a.end=z;}
      if(g===5)for(const [h,,z] of pbFields(buf,y[0],y[1])){if(h===2)a.routes.push(tx(z));if(h===5)a.stops.push(tx(z));}
      if(g===7)a.effect=y;if(g===10)a.header=text(y);if(g===11)a.desc=text(y);}
    a.routes=[...new Set(a.routes)];a.stops=[...new Set(a.stops)];out.push(a);}
  return out;
}
function sniff(b){for(const v of entsOf(b))for(const [f] of pbFields(b,v[0],v[1])){if(f===4)return"pos";if(f===3)return"tu";if(f===5)return"al";}return null;}
function applyPb(b){
  if(b[0]===0x7b||b[0]===0x5b){if(S.demo){S.demo=false;stopTimer();S.vehicles.clear();}ingest(decodeJSON(JSON.parse(dec.decode(b))));return"pos";}
  const k=sniff(b);
  if(k==="pos"){if(S.demo){S.demo=false;stopTimer();S.vehicles.clear();resetStatic();S.hasData=false;}const l=decodeFeed(b);if(S.vehicles.size>500&&l.length<.6*S.vehicles.size)throw new Error("lote incompleto ("+l.length+" vehículos); se descarta y se reintenta");ingest(l);S.stamp=new Date(Math.max(0,...l.map(p=>p.ts||0))*1000);}
  else if(k==="tu")setTU(decodeTU(b));
  else if(k==="al")setAlerts(decodeAlerts(b));
  return k;
}
const RAW="https://raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/";
const PROXY="https://kmefztxxhipjowgcfxds.supabase.co/functions/v1/rapid-responder";
const FEEDS={pos:"positions.pb",tu:"tripupdates.pb",al:"alerts.pb"};
const SIG={pos:null,tu:null,al:null};
let busy=false;
async function pbGet(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error(url.split("/").pop().split("?")[0]+": HTTP "+r.status);return new Uint8Array(await r.arrayBuffer());}
async function fetchMeta(){
  try{const r=await fetch(PROXY+"/meta",{cache:"no-store"});if(r.ok){const m=await r.json();if(m&&m.pos)return{m,base:PROXY+"/",q:k=>FEEDS[k].replace(".pb","")};}}catch(e){}
  try{const r=await fetch(RAW+"meta.json?t="+Math.floor(Date.now()/3000),{cache:"no-store"});if(r.ok){const m=await r.json();if(m&&m.pos)return{m,base:RAW,q:k=>FEEDS[k],late:true};}}catch(e){}
  return null;
}
async function refreshLive(first){
  if(busy)return;
  if(!first&&S.lastChangeAt&&Date.now()-S.lastChangeAt<9000)return;
  busy=true;
  try{
    const src=await fetchMeta();
    if(!src){S.fails=(S.fails||0)+1;if(S.fails===3)toast("Sin conexión con los datos. Reintentando…");}
    else{
      S.fails=0;const {m,base,q}=src;let fresh=false;
      if(m.pos&&m.pos!==SIG.pos){applyPb(await pbGet(base+q("pos")+"?v="+m.pos));SIG.pos=m.pos;fresh=true;S.lastChangeAt=Date.now();}
      if(m.tu&&m.tu!==SIG.tu){try{applyPb(await pbGet(base+q("tu")+"?v="+m.tu));SIG.tu=m.tu;}catch(e){}}
      if(m.al&&m.al!==SIG.al){try{applyPb(await pbGet(base+q("al")+"?v="+m.al));SIG.al=m.al;}catch(e){}}
      S.mode=src.late?"late":"live";
      if(fresh||first){syncBuses();renderAll();}
      setPill();
    }
  }catch(e){S.fails=(S.fails||0)+1;if(S.fails===3)toast("Un lote de datos llegó incompleto. Reintentando…");}
  busy=false;
}
function ageSec(){return S.stamp?Math.max(0,Date.now()/1000-S.stamp/1000):null;}
function startAuto(){stopTimer();refreshLive(true);S.timer=setInterval(()=>{if(!document.hidden)refreshLive();},3000);}
function stopTimer(){clearInterval(S.timer);S.timer=null;}
async function loadGtfsLite(){
  try{const r=await fetch(RAW+"gtfs-lite.zip?t="+Math.floor(Date.now()/3600000));if(!r.ok)return;await loadGTFS(await r.arrayBuffer());}catch(e){}
}
