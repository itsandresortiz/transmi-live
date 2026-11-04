/* TransMi LIVE - interfaz (hoja inferior, listas, detalle, ajustes) */

/* ---------- iconos ---------- */
const IC={
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  chev:'<path d="m9 6 6 6-6 6"/>',
  back:'<path d="m15 6-6 6 6 6"/>',
  sliders:'<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  locate:'<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5"/>',
  bus:'<rect x="4" y="3" width="16" height="14" rx="3"/><path d="M4 11h16M8 21l1.5-4M16 21l-1.5-4"/><circle cx="8" cy="14" r=".7"/><circle cx="16" cy="14" r=".7"/>',
  alert:'<path d="M12 3.5 2.8 19.5h18.4L12 3.5z"/><path d="M12 10v4M12 17v.01"/>',
  pin:'<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  route:'<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>'
};
const ic=(n,s=20,w=1.8)=>`<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

/* ---------- estado de interfaz ---------- */
Object.assign(S,{tab:"rutas",q:"",sys:null,limit:60,sheet:"peek",dirty:false,busyMsg:""});
const DESK=matchMedia("(min-width:900px)");
const sheet=$("sheet"),shead=$("shead"),viewEl=$("view"),qEl=$("q");
const fmtNum=n=>Number(n).toLocaleString("es-CO");
const sysName=t=>TYPES[t]||"Otros";
const tvar=r=>`var(--${r&&TYPES[r.type]?r.type:"otro"})`;
const PLACEHOLDER={rutas:"Buscar ruta o destino",buses:"Buscar placa o ruta",paradas:"Buscar parada o estación",avisos:"Buscar aviso o línea"};

function routeTitle(r){
  if(!r)return"";if(r.virtual)return"Ruta "+r.id;
  const p=String(r.long||"").split("||").map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/^[A-Z]{1,3}\d{1,3}[A-Z]?\s+/,""));
  return p.length>1?p.join("  ⇄  "):(p[0]||sysName(r.type));
}
function delayInfo(v){
  const d=delayOf(v);if(d==null||Math.abs(d)>7200)return{txt:"Sin dato",cls:""};
  const m=Math.round(Math.abs(d)/60);if(m<2)return{txt:"A tiempo",cls:"ok"};
  return d>0?{txt:m+" min tarde",cls:d>600?"bad":"warn"}:{txt:m+" min antes",cls:"early"};
}
function ageText(s){return s<60?Math.round(s)+" s":s<3600?Math.floor(s/60)+" min":Math.floor(s/3600)+" h "+Math.floor(s%3600/60)+" min";}

/* ---------- estado de la conexion (barra superior) ---------- */
function updateStatus(){
  const a=ageSec();let cls="",txt;
  if(a==null)txt=S.busyMsg?"Cargando…":"Conectando…";
  else if(a<=45){cls="live";txt="En vivo · hace "+ageText(a);}
  else if(a<=180){cls="warn";txt="Datos de hace "+ageText(a);}
  else{cls="bad";txt="Sin datos recientes";}
  if(a!=null&&a<=45&&S.busyMsg)txt+=" · "+S.busyMsg;
  $("sdot").className="dot "+cls;$("stxt").textContent=txt;
}
function setPill(){updateStatus();}
setInterval(updateStatus,1000);
function setNote(h,err){
  const t=String(h).replace(/<[^>]+>/g,"");
  if(err){toast(t);return;}
  if(/Leyendo|Dibujando|Indexando/.test(t))S.busyMsg="cargando rutas";else if(/rutas ·/.test(t))S.busyMsg="";
  updateStatus();
}
let toastT;
function toast(msg,ms=3800){const t=$("toast");t.textContent=msg;t.classList.add("on");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("on"),ms);}

/* ---------- hoja inferior ---------- */
function visPx(state){
  const H=sheet.offsetHeight;
  if(state==="full")return H;
  if(state==="half")return Math.min(H,Math.round(innerHeight*.52));
  return shead.offsetHeight+(parseFloat(getComputedStyle(sheet).paddingBottom)||0);
}
function currentSy(){return parseFloat(sheet.style.getPropertyValue("--sy"))||(sheet.offsetHeight-visPx("peek"));}
function setSheet(state,instant){
  if(DESK.matches){S.sheet="full";sheet.style.removeProperty("--sy");document.documentElement.style.setProperty("--vis","0px");return;}
  S.sheet=state;sheet.dataset.state=state;
  const H=sheet.offsetHeight,vis=visPx(state);
  if(instant)sheet.classList.add("dragging");
  sheet.style.setProperty("--sy",(H-vis)+"px");
  document.documentElement.style.setProperty("--vis",vis+"px");
  if(instant)requestAnimationFrame(()=>requestAnimationFrame(()=>sheet.classList.remove("dragging")));
  if(state!=="peek"&&S.dirty)renderView();
}
let drag=null,noClick=false;
shead.addEventListener("pointerdown",e=>{
  if(DESK.matches||e.target.closest("input,.clear,.tab"))return;
  drag={id:e.pointerId,y0:e.clientY,sy0:currentSy(),moved:false,last:e.clientY,lt:performance.now(),vy:0};
});
addEventListener("pointermove",e=>{
  if(!drag||e.pointerId!==drag.id)return;
  const dy=e.clientY-drag.y0;
  if(!drag.moved){if(Math.abs(dy)<6)return;drag.moved=true;sheet.classList.add("dragging");try{shead.setPointerCapture(e.pointerId);}catch(_){}}
  const H=sheet.offsetHeight,max=H-visPx("peek")+24;
  sheet.style.setProperty("--sy",Math.max(0,Math.min(max,drag.sy0+dy))+"px");
  const n=performance.now();drag.vy=(e.clientY-drag.last)/Math.max(1,n-drag.lt);drag.last=e.clientY;drag.lt=n;
});
function endDrag(e){
  if(!drag||(e&&e.pointerId!==drag.id))return;
  sheet.classList.remove("dragging");
  if(drag.moved){
    const order=["peek","half","full"],H=sheet.offsetHeight,cur=H-currentSy();let target;
    if(Math.abs(drag.vy)>.45){const i=order.indexOf(S.sheet);target=order[Math.max(0,Math.min(2,i+(drag.vy<0?1:-1)))];}
    else target=order.reduce((a,b)=>Math.abs(visPx(b)-cur)<Math.abs(visPx(a)-cur)?b:a);
    setSheet(target);noClick=true;setTimeout(()=>noClick=false,50);
  }
  drag=null;
}
addEventListener("pointerup",endDrag);addEventListener("pointercancel",endDrag);
$("grab").addEventListener("click",()=>{if(noClick)return;setSheet(S.sheet==="peek"?"half":S.sheet==="half"?"peek":"half");});
qEl.addEventListener("focus",()=>{if(!DESK.matches&&S.sheet!=="full")setSheet("full");});
DESK.addEventListener("change",()=>setSheet(S.sheet,true));
addEventListener("resize",()=>{clearTimeout(S._rz);S._rz=setTimeout(()=>setSheet(S.sheet,true),120);});

/* el mapa se encuadra en la parte que la hoja deja libre */
function fitPad(){
  if(DESK.matches)return{tl:[440,92],br:[28,28]};
  const vis=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vis"))||0;
  return{tl:[16,92],br:[16,vis+18]};
}
const _fitBounds=map.fitBounds.bind(map);
map.fitBounds=(b,o)=>{o=Object.assign({},o||{});if(!o.padding&&!o.paddingTopLeft&&!o.paddingBottomRight){const p=fitPad();o.paddingTopLeft=p.tl;o.paddingBottomRight=p.br;}return _fitBounds(b,o);};

/* ---------- cifras ---------- */
function kpis(){
  const rt=new Set();let late=0,n=0;
  for(const v of S.vehicles.values()){n++;const d=delayOf(v);if(d!=null&&d>600&&d<=7200)late++;if(v.routeId)rt.add(v.routeId);}
  return{veh:n,rutas:rt.size,late,avisos:S.alerts.length};
}
function renderKPIs(){
  const k=kpis();
  viewEl.querySelectorAll("[data-kpi]").forEach(el=>{el.textContent=fmtNum(k[el.dataset.kpi]);});
  const n=$("avisoN");if(k.avisos){n.hidden=false;n.textContent=k.avisos>99?"99+":k.avisos;}else n.hidden=true;
}
const statsHTML=()=>{const k=kpis();return`<div class="stats">
  <button class="stat" data-tab="buses"><b data-kpi="veh">${fmtNum(k.veh)}</b><span>Buses</span></button>
  <div class="stat"><b data-kpi="rutas">${fmtNum(k.rutas)}</b><span>Rutas</span></div>
  <button class="stat late" data-act="late"><b data-kpi="late">${fmtNum(k.late)}</b><span>Con retraso</span></button>
  <button class="stat" data-tab="avisos"><b data-kpi="avisos">${fmtNum(k.avisos)}</b><span>Avisos</span></button></div>`;};
const sysChips=()=>`<div class="chips" role="group" aria-label="Filtrar por sistema">`+[["","Todos"],...KP.map(k=>[k,TYPES[k]])].map(([k,l])=>`<button class="chip" data-sys="${k}" aria-pressed="${(S.sys||"")===k}"${k?` style="--c:var(--${k})"`:""}>${k?"<i></i>":""}${l}</button>`).join("")+`</div>`;
const moreBtn=(total,shown)=>total>shown?`<button class="more" data-act="more">Mostrar más (${fmtNum(total-shown)})</button>`:"";
const emptyHTML=(icon,title,txt)=>`<div class="empty">${ic(icon,34,1.5)}<b>${title}</b>${txt}</div>`;
const skeleton=()=>`<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>`;
function counts(){const m=new Map();for(const v of S.vehicles.values())m.set(v.routeId,(m.get(v.routeId)||0)+1);return m;}

/* ---------- Rutas ---------- */
function routeRowHTML(r,n){
  const na=(S.alByRoute.get(r.id)||[]).length;
  return`<button class="row" data-route="${esc(r.id)}"><span class="rb" style="--c:${tvar(r)}">${esc(r.short)}</span><span class="rm"><span class="rt">${esc(routeTitle(r))}</span><span class="rs">${sysName(r.type)}${na?` · ${na} aviso${na>1?"s":""}`:""}</span></span>${n?`<span class="rr">${fmtNum(n)}${ic("bus",15,2)}</span>`:""}${ic("chev",18,2)}</button>`;
}
function routesHTML(){
  if(!S.routes.size&&!S.vehicles.size)return statsHTML()+sysChips()+skeleton();
  const q=norm(S.q.trim()),cn=counts(),heads=new Map();
  if(q)for(const [rid,ts] of S.tripsByRoute)heads.set(rid,norm(ts.slice(0,60).map(t=>t.head).join(" ")));
  const all=[...S.routes.values()].filter(r=>S.typeOn.has(r.type)&&(!q||norm(r.short+" "+r.long).includes(q)||(heads.get(r.id)||"").includes(q)))
    .sort((a,b)=>(cn.get(b.id)||0)-(cn.get(a.id)||0)||a.short.localeCompare(b.short,"es",{numeric:true}));
  const rows=all.slice(0,S.limit).map(r=>routeRowHTML(r,cn.get(r.id))).join("");
  return statsHTML()+sysChips()+(rows?`<div class="list">${rows}</div>${moreBtn(all.length,S.limit)}`:emptyHTML("route","Sin resultados","Prueba con otro nombre o cambia el filtro."));
}
function detailHTML(){
  const r=S.routes.get(S.sel);const by=S.reps?.get(S.sel)||new Map(),col=tvar(r);
  const dirs=[...by.entries()];
  const seg=dirs.length>1?`<div class="seg" role="group" aria-label="Sentido">${dirs.map(([d,t],i)=>`<button data-dir="${d}" aria-pressed="${d===S.dir}">${t.head?esc(t.head):(i===0?"Ida":"Vuelta")}</button>`).join("")}</div>`:"";
  const stops=S.repStops?.get(S.sel)?.get(S.dir)||[];
  const buses=[...S.vehicles.values()].filter(v=>v.routeId===S.sel).sort((a,b)=>(delayOf(b)??-1e9)-(delayOf(a)??-1e9));
  const delays=buses.map(delayOf).filter(d=>d!=null&&Math.abs(d)<=7200);
  const avg=delays.length?delays.reduce((a,b)=>a+b,0)/delays.length:null;
  const avgTxt=avg==null?"—":Math.abs(avg)<120?"A tiempo":Math.round(Math.abs(avg)/60)+" min "+(avg>0?"tarde":"antes");
  const als=S.alByRoute.get(S.sel)||[],here=new Set(buses.map(v=>v.stopId));
  return`<button class="back" data-act="back">${ic("back",18,2.2)}Rutas</button>
  <div class="dcard"><span class="rb big" style="--c:${col}">${esc(r.short)}</span><div><h2>${esc(routeTitle(r))}</h2><p>${sysName(r.type)} · ${fmtNum(buses.length)} bus${buses.length===1?"":"es"} en servicio</p></div></div>
  ${seg}
  <div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b>${fmtNum(buses.length)}</b><span>En servicio</span></div><div class="stat"><b style="font-size:16px;padding:2px 0">${avgTxt}</b><span>Puntualidad media</span></div><button class="stat" data-act="routeAlerts"><b>${fmtNum(als.length)}</b><span>Avisos</span></button></div>
  ${als.length?`<h3 class="sec">Avisos</h3>${als.slice(0,4).map(i=>alertCard(S.alerts[i],i)).join("")}`:""}
  <h3 class="sec">Buses en servicio</h3>
  ${buses.length?`<div class="list">${buses.slice(0,40).map(busRowHTML).join("")}</div>`:emptyHTML("bus","Sin buses ahora","No hay vehículos reportados en esta ruta en este momento.")}
  <h3 class="sec">Paradas del recorrido${stops.length?` · ${stops.length}`:""}</h3>
  ${stops.length?`<ol class="tl" style="--rc:${col}">${stops.map(s=>`<li data-stop="${esc(s.id)}" class="${here.has(s.id)?"here":""}">${esc(s.name)}${here.has(s.id)?`<span class="bx">Bus cerca</span>`:""}</li>`).join("")}</ol>`:`<p class="rs" style="padding:8px 0">${r.virtual||!S.hasData?"Cargando recorrido…":S.repStops?"No hay paradas registradas para esta ruta.":"Cargando paradas…"}</p>`}`;
}

/* ---------- Buses ---------- */
function busRowHTML(v){
  const di=delayInfo(v),r=v.route,u=v.tripId&&S.tu.get(v.tripId),nx=u?.stops?.[0],nst=S.stops.get(nx?.stopId||v.stopId);
  const sub=nst?"Próxima: "+nst.name:(r&&!r.virtual?routeTitle(r):sysName(r?.type));
  return`<button class="row" data-bus="${esc(v.key)}"><span class="rb sm" style="--c:${tvar(r)}">${esc(r?.short||v.routeId||"?")}</span><span class="rm"><span class="rt">${esc(v.plate||v.label||v.vid||"Bus")}</span><span class="rs">${esc(sub)}</span></span><span class="pill ${di.cls}">${di.txt}</span></button>`;
}
function busesHTML(){
  if(!S.vehicles.size)return sysChips()+skeleton();
  const q=norm(S.q.trim());
  let all=[...S.vehicles.values()].filter(v=>S.typeOn.has(v.route?.type||"otro")&&(!q||norm([v.plate,v.label,v.route?.short,v.route?.long].join(" ")).includes(q)));
  if(S.onlyLate)all=all.filter(v=>{const d=delayOf(v);return d!=null&&d>600&&d<=7200;});
  all.sort((a,b)=>{if(q){const pa=norm(a.plate||"").startsWith(q)?0:1,pb=norm(b.plate||"").startsWith(q)?0:1;if(pa!==pb)return pa-pb;}return(delayOf(b)??-1e9)-(delayOf(a)??-1e9);});
  const rows=all.slice(0,S.limit).map(busRowHTML).join("");
  const filt=S.onlyLate?`<button class="chip" data-act="late" aria-pressed="true" style="margin-bottom:8px">Solo con retraso · quitar filtro</button>`:"";
  return sysChips()+filt+(rows?`<div class="list">${rows}</div>${moreBtn(all.length,S.limit)}`:emptyHTML("bus","Sin buses","No encontramos buses con ese filtro."));
}

/* ---------- Paradas ---------- */
function stopsHTML(){
  const q=norm(S.q.trim());
  if(q){
    const out=[];for(const s of S.stops.values()){if(norm(s.name+" "+s.code).includes(q)){out.push(s);if(out.length>=S.limit)break;}}
    const est=ESTS.map((e,i)=>[e,i]).filter(([e])=>norm(e[2]+" "+e[3]).includes(q)).slice(0,20);
    const rows=est.map(([e,i])=>`<button class="row" data-est="${i}"><span class="rb sm" style="--c:var(--troncal)">${ic("bus",16,2)}</span><span class="rm"><span class="rt">${esc(e[2])}</span><span class="rs">Estación${e[4]?" · "+esc(e[4]):""}</span></span>${ic("chev",18,2)}</button>`).join("")
      +out.map(s=>`<button class="row" data-stop="${esc(s.id)}"><span class="rb sm" style="--c:var(--otro)">${ic("pin",16,2)}</span><span class="rm"><span class="rt">${esc(s.name)}</span><span class="rs">Parada ${esc(s.code||s.id)}</span></span>${ic("chev",18,2)}</button>`).join("");
    return rows?`<div class="list">${rows}</div>`:emptyHTML("pin","Sin resultados","Revisa el nombre o prueba con una calle, por ejemplo «Calle 72».");
  }
  const rows=ESTS.map((e,i)=>[e,i]).slice(0,S.limit).map(([e,i])=>`<button class="row" data-est="${i}"><span class="rb sm" style="--c:var(--troncal)">${ic("bus",16,2)}</span><span class="rm"><span class="rt">${esc(e[2])}</span><span class="rs">${esc(e[4]||"TransMilenio")}${e[3]?" · "+esc(e[3]):""}</span></span>${ic("chev",18,2)}</button>`).join("");
  return`<h3 class="sec" style="margin-top:6px">Estaciones de TransMilenio</h3><div class="list">${rows}</div>${moreBtn(ESTS.length,S.limit)}`;
}
function arrivalsHTML(sid){
  const a=(S.arr.get(sid)||[]).slice().sort((x,y)=>(x.t||0)-(y.t||0)).slice(0,6);
  if(!a.length)return"";
  return`<table>${a.map(x=>{const r=S.routes.get(x.routeId);return`<tr><td><b>${esc(r?.short||x.routeId)}</b></td><td>${fmtT(x.t)}</td></tr>`;}).join("")}</table>`;
}
async function stopFocus(s,fly=true){
  if(!s)return;
  if(fly){if(!DESK.matches&&S.sheet!=="peek")setSheet("peek");map.flyTo([s.lat,s.lon],Math.max(map.getZoom(),16),{duration:.8});}
  const p=L.popup({offset:[0,-4]}).setLatLng([s.lat,s.lon]).setContent(`<div class="pc"><div class="ph"><span class="rb sm" style="--c:var(--otro)">${ic("pin",16,2)}</span><div><h4>${esc(s.name)}</h4><small>Parada ${esc(s.code||s.id)}</small></div></div><p class="rs" style="margin:12px 0 0">Buscando rutas…</p></div>`).openOn(map);
  const ids=await stopRoutes(s);
  const chips=ids.slice(0,24).map(id=>{const r=S.routes.get(id);return r?`<button class="rb sm" style="--c:${tvar(r)}" data-act="route" data-id="${esc(id)}">${esc(r.short)}</button>`:"";}).join("");
  const arr=arrivalsHTML(s.id),na=(S.alByStop.get(s.id)||[]).length;
  p.setContent(`<div class="pc"><div class="ph"><span class="rb sm" style="--c:var(--otro)">${ic("pin",16,2)}</span><div><h4>${esc(s.name)}</h4><small>Parada ${esc(s.code||s.id)}${na?` · ${na} aviso${na>1?"s":""}`:""}</small></div></div>${arr?`<h3 class="sec" style="margin:14px 0 0">Próximas llegadas</h3>${arr}`:""}${chips?`<h3 class="sec" style="margin:14px 0 8px">Rutas que pasan</h3><div class="rbs" style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>`:""}</div>`);
}
function estFocus(i){
  const e=ESTS[i];if(!e)return;
  if(!DESK.matches&&S.sheet!=="peek")setSheet("peek");
  map.flyTo([e[0],e[1]],Math.max(map.getZoom(),16),{duration:.8});
  L.popup({offset:[0,-4]}).setLatLng([e[0],e[1]]).setContent(`<div class="pc"><div class="ph"><span class="rb sm" style="--c:var(--troncal)">${ic("bus",16,2)}</span><div><h4>${esc(e[2])}</h4><small>Estación de TransMilenio${e[4]?" · "+esc(e[4]):""}</small></div></div>${e[3]?`<dl><dt>Ubicación</dt><dd>${esc(e[3])}</dd></dl>`:""}</div>`).openOn(map);
}

/* ---------- Avisos ---------- */
const EFF={1:["Sin servicio","bad"],2:["Servicio reducido","warn"],3:["Demoras","warn"],4:["Desvío","warn"],5:["Servicio adicional","ok"],6:["Modificado","warn"],9:["Parada movida","warn"]};
function prettyDesc(d){
  if(!d)return"";const p=d.split("\\");if(p.length<2)return d.replace(/^Novedad en la operacion en linea\s*/i,"");
  const line=p[0].replace(/^.*\s/,""),rest=p.slice(1).map(x=>x.replace(/^\w+?_/,""));
  return`Línea ${line}: ${rest.join(" → ")}`;
}
function alertCard(a,i){
  const [lab,cls]=EFF[a.effect]||["Aviso",""],open=S.alOpen===i;
  const per=a.start?`${new Date(a.start*1000).toLocaleDateString("es-CO",{day:"numeric",month:"short",timeZone:"America/Bogota"})}${a.end?" – "+new Date(a.end*1000).toLocaleDateString("es-CO",{day:"numeric",month:"short",timeZone:"America/Bogota"}):""}`:"";
  const chips=a.routes.slice(0,24).map(id=>{const r=S.routes.get(id);return`<span class="rb sm" style="--c:${tvar(r)}" data-route="${esc(id)}" role="button" tabindex="0">${esc(r?.short||id)}</span>`;}).join("");
  return`<div class="card" data-alert="${i}" role="button" tabindex="0" aria-expanded="${open}"><span class="pill ${cls}">${lab}</span><div class="ct">${esc(prettyDesc(a.desc)||a.header||"Aviso de servicio")}</div><div class="cs">${esc(a.header||"")}${per?` · ${per}`:""}</div>${open?`<div class="rbs">${chips}</div>${a.stops.length?`<button class="btn" data-act="alstops" data-id="${i}">${ic("pin",17,2)}Ver ${a.stops.length} parada${a.stops.length>1?"s":""} en el mapa</button>`:""}`:""}</div>`;
}
function alertsHTML(){
  const q=norm(S.q.trim());
  const list=S.alerts.map((a,i)=>[a,i]).filter(([a])=>!q||norm([a.header,a.desc,...a.routes.map(r=>S.routes.get(r)?.short||r)].join(" ")).includes(q))
    .sort((x,y)=>(x[0].effect||9)-(y[0].effect||9)||y[0].routes.length-x[0].routes.length);
  if(!S.alerts.length)return emptyHTML("alert","Sin avisos","Por ahora no hay novedades de servicio.");
  return`<h3 class="sec" style="margin-top:6px">${fmtNum(list.length)} aviso${list.length===1?"":"s"} de servicio</h3>`+(list.slice(0,S.limit).map(([a,i])=>alertCard(a,i)).join("")||emptyHTML("alert","Sin resultados","Prueba con otra línea o palabra."))+moreBtn(list.length,S.limit);
}
function showAlertStops(i){
  const a=S.alerts[i];if(!a)return;gAlert.clearLayers();const pts=[];
  for(const id of a.stops){const s=S.stops.get(id);if(!s)continue;pts.push([s.lat,s.lon]);L.circleMarker([s.lat,s.lon],{renderer:cv,radius:7,weight:2.5,color:"#f59e0b",fillColor:"#f59e0b",fillOpacity:.35}).bindTooltip(esc(s.name)).addTo(gAlert);}
  if(!pts.length){toast("Todavía estamos cargando las paradas. Inténtalo en unos segundos.");return;}
  if(!DESK.matches)setSheet("peek");
  map.fitBounds(L.latLngBounds(pts).pad(.3),{maxZoom:16});
}

/* ---------- vistas ---------- */
let lastKey="";
function renderView(){
  if(!DESK.matches&&S.sheet==="peek"){S.dirty=true;return;}
  S.dirty=false;
  const key=S.tab+"|"+(S.sel||"")+"|"+S.q;const keep=key===lastKey?viewEl.scrollTop:0;lastKey=key;
  let h;
  if(S.tab==="rutas")h=S.sel&&S.routes.get(S.sel)?detailHTML():routesHTML();
  else if(S.tab==="buses")h=busesHTML();else if(S.tab==="paradas")h=stopsHTML();else h=alertsHTML();
  viewEl.innerHTML=h;viewEl.scrollTop=keep;
}
function renderAll(){renderKPIs();renderView();}
let softT;function softRender(){clearTimeout(softT);softT=setTimeout(()=>{if(!drag)renderView();},600);}
function renderPane(){renderView();}
function go(tab,keepQ){
  if(tab!==S.tab&&!keepQ){S.q="";qEl.value="";$("clear").hidden=true;}
  S.tab=tab;S.limit=60;if(tab!=="buses")S.onlyLate=false;
  document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===tab));
  qEl.placeholder=PLACEHOLDER[tab];renderView();viewEl.scrollTop=0;
  if(!DESK.matches&&S.sheet==="peek")setSheet("half");
}
function applySys(k){
  S.sys=k||null;S.typeOn=k?new Set([k]):new Set(Object.keys(TYPES));S.limit=60;
  drawNet();syncBuses();renderView();
}

/* ---------- bus ---------- */
function busPopup(v){
  const r=v.route,u=v.tripId&&S.tu.get(v.tripId),nx=u?.stops?.[0],nst=S.stops.get(nx?.stopId||v.stopId),di=delayInfo(v);
  const next=nst?nst.name:(nx?.stopId||v.stopId)?"Parada "+(nx?.stopId||v.stopId):"—";
  const na=(S.alByRoute.get(v.routeId)||[]).length;
  const sp=isFinite(v.speed)?Math.round(v.speed*3.6):(v._spd>.3?Math.round(v._spd*3.6):null);
  return`<div class="pc"><div class="ph"><span class="rb" style="--c:${tvar(r)}">${esc(r?.short||v.routeId||"?")}</span><div><h4>${sysName(r?.type)}</h4><small>${esc(r&&!r.virtual?routeTitle(r):"Bus en circulación")}</small></div></div>
  <div class="plate"><span>${esc(v.plate||v.label||"—")}</span><span class="pill ${di.cls}">${di.txt}</span></div>
  <dl><dt>Próxima parada</dt><dd>${esc(next)}${nx?.time?" · "+fmtT(nx.time):""}</dd>${v.head?`<dt>Hacia</dt><dd>${esc(v.head)}</dd>`:""}${sp!=null?`<dt>Velocidad</dt><dd>${sp} km/h</dd>`:""}<dt>Último reporte</dt><dd>${fmtT(v.ts)}</dd>${na?`<dt>Avisos</dt><dd>${na} en esta ruta</dd>`:""}</dl>
  <div class="acts">${v.routeId?`<button class="btn primary" data-act="route" data-id="${esc(v.routeId)}">Ver ruta</button>`:""}<button class="btn" data-act="follow" data-id="${esc(v.key)}">${S.follow===v.key?"Dejar de seguir":"Seguir"}</button></div></div>`;
}
function focusBus(k){
  const v=S.vehicles.get(k);if(!v)return;
  if(!S.typeOn.has(v.route?.type||"otro"))applySys(null);
  if(S.sel&&v.routeId!==S.sel)selectRoute(null);
  if(!DESK.matches)setSheet("peek");
  syncBuses();const c=curPos(v,performance.now());
  map.flyTo([c.lat,c.lon],Math.max(map.getZoom(),15.5),{duration:.8});setTimeout(()=>openBus(k),850);
}
function speedChip(){syncSettings();}

/* ---------- ajustes ---------- */
const LAYERS=[["streets","Calles y nombres","showStreets"],["stops","Paradas","showStops"],["net","Red de rutas","showNet"],["buses","Buses","showBuses"]];
function buildSettings(){
  $("settings").innerHTML=`<div class="sh"><h2>Ajustes del mapa</h2><button class="fab" style="width:40px;height:40px" data-act="closeSettings" aria-label="Cerrar">${ic("close",20,2)}</button></div>
  <div class="grp"><h3>Capas</h3><div class="box">${LAYERS.map(([k,l,s])=>`<div class="srow"><span>${l}</span><button class="sw" role="switch" data-sw="${k}" aria-label="${l}"></button></div>`).join("")}</div></div>
  <div class="grp"><h3>Color de los buses</h3><div class="seg" style="margin:0" role="group"><button data-color="tipo">Por sistema</button><button data-color="retraso">Por puntualidad</button></div><div class="legend" id="legend"></div></div>
  <div class="grp"><h3>Movimiento</h3><div class="seg" style="margin:0" role="group"><button data-move="pred">Predicción</button><button data-move="rep">Reportado</button><button data-move="cam">Acelerado</button></div><p class="hint" id="moveHint"></p></div>
  <p class="credits">Mapa © colaboradores de OpenStreetMap. Datos en tiempo real de TransMilenio. Localidades y estaciones: datos abiertos de Bogotá.</p>`;
}
function syncSettings(){
  const root=$("settings");if(!root.firstChild)return;
  root.querySelectorAll("[data-sw]").forEach(b=>{const l=LAYERS.find(x=>x[0]===b.dataset.sw);b.setAttribute("aria-checked",!!S[l[2]]);});
  root.querySelectorAll("[data-color]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.color===S.colorBy));
  const mv=S.speedMul>1?"cam":S.est?"pred":"rep";
  root.querySelectorAll("[data-move]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.move===mv));
  $("moveHint").textContent={pred:"Entre un reporte y otro, cada bus sigue su rumbo y se corrige cuando llega el dato real.",rep:"Cada bus va solo hacia la última posición que reportó.",cam:"Efecto de video: los buses recorren su ruta mucho más rápido que en la realidad."}[mv];
  $("legend").innerHTML=S.colorBy==="tipo"?[...KP,"otro"].map(k=>`<span style="--c:var(--${k})"><i></i>${TYPES[k]}</span>`).join(""):
    [["var(--ok)","A tiempo"],["var(--warn)","Hasta 10 min tarde"],["var(--bad)","Más de 10 min tarde"],["var(--early)","Adelantado"],["var(--otro)","Sin dato"]].map(([c,l])=>`<span style="--c:${c}"><i></i>${l}</span>`).join("");
}
function openSettings(){syncSettings();$("settings").classList.add("on");$("scrim").classList.add("on");$("openSettings").setAttribute("aria-pressed","true");}
function closeSettings(){$("settings").classList.remove("on");$("scrim").classList.remove("on");$("openSettings").setAttribute("aria-pressed","false");}
function setMove(m){
  S.est=m==="pred";S.speedMul=m==="cam"?30:1;S.selT0=performance.now();
  for(const v of S.vehicles.values())v._dx=null;
  if(S.speedMul>1)for(const v of S.vehicles.values())if(!v._ex)setupExtrap(v);
  syncSettings();syncBuses();
}

/* ---------- ubicacion del usuario ---------- */
let meMk;
function locate(){
  if(!navigator.geolocation){toast("Tu navegador no permite obtener la ubicación.");return;}
  navigator.geolocation.getCurrentPosition(pos=>{
    const ll=[pos.coords.latitude,pos.coords.longitude];
    if(!L.latLngBounds(URBAN).contains(ll)){toast("Parece que estás fuera de Bogotá.");return;}
    if(meMk)meMk.setLatLng(ll);else meMk=L.marker(ll,{icon:L.divIcon({className:"",html:'<div class="me"></div>',iconSize:[18,18]}),interactive:false,keyboard:false,zIndexOffset:2000}).addTo(map);
    if(!DESK.matches)setSheet("peek");map.flyTo(ll,Math.max(map.getZoom(),15),{duration:.9});
  },()=>toast("No pudimos obtener tu ubicación. Revisa los permisos del navegador."),{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
}

/* ---------- eventos ---------- */
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-tab],[data-route],[data-bus],[data-stop],[data-est],[data-act],[data-sys],[data-dir],[data-alert],[data-sw],[data-color],[data-move]");
  if(!t){return;}
  const d=t.dataset;
  if(d.sw){const l=LAYERS.find(x=>x[0]===d.sw);S[l[2]]=!S[l[2]];({streets:drawStreets,stops:()=>{applyZoom();if(!S.showStops)map.removeLayer(gStops);},net:drawNet,buses:syncBuses})[d.sw]();return syncSettings();}
  if(d.color){S.colorBy=d.color;syncSettings();return syncBuses();}
  if(d.move)return setMove(d.move);
  if(d.tab)return go(d.tab);
  if(d.sys!==undefined)return applySys(d.sys);
  if(d.dir){S.dir=d.dir;drawRouteLayer(true);return renderView();}
  if(d.bus)return focusBus(d.bus);
  if(d.stop&&!d.act){stopFocus(S.stops.get(d.stop));return;}
  if(d.est!==undefined)return estFocus(+d.est);
  if(d.route&&!d.act){e.stopPropagation();map.closePopup();S.tab==="rutas"||go("rutas");document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab==="rutas"));S.tab="rutas";selectRoute(d.route);if(!DESK.matches)setSheet("half");return;}
  if(d.alert!==undefined&&!d.act){const i=+d.alert;S.alOpen=S.alOpen===i?null:i;return renderView();}
  switch(d.act){
    case"back":selectRoute(null);return;
    case"route":map.closePopup();S.tab="rutas";document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab==="rutas"));selectRoute(d.id);if(!DESK.matches)setSheet("half");return;
    case"follow":{S.follow=S.follow===d.id?null:d.id;map.closePopup();const fv=S.vehicles.get(S.follow||"");if(fv){toast("Siguiendo "+(fv.plate||fv.label||"el bus"));if(map.getZoom()<16){const c=curPos(fv,performance.now());map.flyTo([c.lat,c.lon],16,{duration:.8});}}else toast("Dejaste de seguir el bus");return syncBuses();}
    case"more":S.limit+=60;return renderView();
    case"late":S.onlyLate=!S.onlyLate;if(S.tab!=="buses")return go("buses",true);S.limit=60;return renderView();
    case"alstops":return showAlertStops(+d.id);
    case"routeAlerts":{const als=S.alByRoute.get(S.sel)||[];if(als.length){go("avisos");}return;}
    case"closeSettings":return closeSettings();
  }
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){closeSettings();map.closePopup();}
  if((e.key==="Enter"||e.key===" ")&&e.target.matches?.("[data-alert],[data-route][role=button]")){e.preventDefault();e.target.click();}
});
$("openSettings").addEventListener("click",()=>$("settings").classList.contains("on")?closeSettings():openSettings());
$("scrim").addEventListener("click",closeSettings);
$("locate").addEventListener("click",locate);
$("clear").addEventListener("click",()=>{S.q="";qEl.value="";$("clear").hidden=true;S.limit=60;renderView();qEl.focus();});
let qT;qEl.addEventListener("input",()=>{
  S.q=qEl.value;$("clear").hidden=!S.q;S.limit=60;
  if(S.q&&S.tab==="rutas"&&S.sel){selectRoute(null);return;}
  clearTimeout(qT);qT=setTimeout(renderView,110);
});
addEventListener("error",e=>console.warn("TransMi LIVE:",e.message));

/* ---------- arranque ---------- */
function init(){
  buildSettings();syncSettings();
  drawBase();drawStreets();applyZoom();
  setSheet(DESK.matches?"full":"peek",true);
  map.fitBounds([[4.50,-74.19],[4.80,-74.02]],{animate:false});
  renderAll();updateStatus();
  startAuto();loadGtfsLite();
}
init();
