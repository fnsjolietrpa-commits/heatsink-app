"use strict";

/* ---------- Capacitor plugins ---------- */
const CAP = window.Capacitor || {};
const P = CAP.Plugins || {};
const Camera = P.Camera, BScan = P.BarcodeScanner, Filesystem = P.Filesystem, Share = P.Share;
const isNative = !!(CAP.isNativePlatform && CAP.isNativePlatform());

/* ---------- seed / helpers ---------- */
function buildSeed(){ const a=[]; for(let n=2115;n<=2144;n++) a.push("CN03722300 MHN00179AA  T2919"+n); return a; }
const $ = s => document.querySelector(s);
const todayStr = () => { const d=new Date(),p=n=>String(n).padStart(2,'0'); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };
const keyOf = s => String(s).replace(/\s+/g,'').toUpperCase().slice(-9);
const last9 = s => String(s).trim().slice(-9);
const fmtId = l => l.length>=7 ? l.slice(0,6)+"-"+l.slice(6) : l;
let toastTimer;
function toast(msg,isErr){ const t=$('#toast'); t.textContent=msg; t.className=isErr?'show err':'show'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className='',2200); }

/* ---------- IndexedDB ---------- */
let DB=null, memMode=false, memStore={};
function openDB(){return new Promise(res=>{ let r; try{ r=indexedDB.open('heatsink',1);}catch(e){memMode=true;return res(null);}
  r.onupgradeneeded=e=>{const db=e.target.result; if(!db.objectStoreNames.contains('boxes')) db.createObjectStore('boxes',{keyPath:'key'});};
  r.onsuccess=e=>res(e.target.result); r.onerror=()=>{memMode=true;res(null);}; });}
function dbGetAll(){ if(memMode) return Promise.resolve(Object.values(memStore));
  return new Promise((res,rej)=>{const r=DB.transaction('boxes').objectStore('boxes').getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error);}); }
function dbPut(v){ if(memMode){memStore[v.key]=v;return Promise.resolve();}
  return new Promise((res,rej)=>{const r=DB.transaction('boxes','readwrite').objectStore('boxes').put(v); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);}); }
function dbDelete(k){ if(memMode){delete memStore[k];return Promise.resolve();}
  return new Promise((res,rej)=>{const r=DB.transaction('boxes','readwrite').objectStore('boxes').delete(k); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);}); }

/* ---------- state ---------- */
let DATE=todayStr(), boxes=[];
function boxKey(fid){ return DATE+"::"+last9(fid); }
function doneCount(b){ return b.photos.filter(Boolean).length; }
function isDone(b){ return doneCount(b)===3; }
function firstEmpty(b){ for(let i=0;i<3;i++) if(!b.photos[i]) return i; return -1; }
function pURL(p){ if(!p) return null; if(!p._url){ try{ p._url=URL.createObjectURL(p.blob);}catch(e){return null;} } return p._url; }
function pDrop(p){ if(p&&p._url){ try{URL.revokeObjectURL(p._url);}catch(e){} p._url=null; } }
function revokeAll(){ for(const b of boxes) for(const p of b.photos) pDrop(p); }

async function loadOrSeed(){
  let all=[]; try{ all=await dbGetAll(); }catch(e){ all=[]; }
  boxes=all.filter(b=>b.date===DATE).map(b=>({key:b.key,date:b.date,fullId:b.fullId,last9:b.last9,photos:b.photos||[null,null,null]}));
  if(boxes.length===0){ boxes=buildSeed().map(fid=>({key:boxKey(fid),date:DATE,fullId:fid,last9:last9(fid),photos:[null,null,null]})); for(const b of boxes){ try{await dbPut(b);}catch(e){} } }
  boxes.sort((a,b)=>a.last9.localeCompare(b.last9));
}
async function replaceList(ids){ try{ const all=await dbGetAll(); for(const b of all) if(b.date===DATE) await dbDelete(b.key);}catch(e){}
  revokeAll(); boxes=ids.map(fid=>({key:DATE+"::"+last9(fid),date:DATE,fullId:fid,last9:last9(fid),photos:[null,null,null]}));
  for(const b of boxes){ try{await dbPut(b);}catch(e){} } boxes.sort((a,b)=>a.last9.localeCompare(b.last9)); }
async function resetPhotos(){ revokeAll(); for(const b of boxes){ b.photos=[null,null,null]; try{await dbPut(b);}catch(e){} } }
function matchBox(raw){ const norm=String(raw).replace(/\s+/g,'').toUpperCase();
  return boxes.find(b=>norm.includes(b.last9)) || boxes.find(b=>keyOf(b.fullId)===keyOf(raw)) || boxes.find(b=>b.last9===String(raw).toUpperCase()); }

/* ---------- image helpers ---------- */
function b64toBlob(b64,type){ const bin=atob(b64); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return new Blob([a],{type:type||'image/jpeg'}); }
function imgDims(blob){ return new Promise(res=>{ const u=URL.createObjectURL(blob); const im=new Image();
  im.onload=()=>{res({w:im.naturalWidth,h:im.naturalHeight});URL.revokeObjectURL(u);}; im.onerror=()=>{res({w:0,h:0});URL.revokeObjectURL(u);}; im.src=u; }); }

/* ---------- list ---------- */
const CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
function rowHTML(b){ const c=doneCount(b);
  if(c===3) return '<button class="row done" data-key="'+b.key+'"><span class="row-id mono">'+fmtId(b.last9)+'</span><span class="check">'+CHECK+'</span></button>';
  const right=c>0?'<span class="partial">'+c+'/3</span>':'';
  return '<div class="row static"><span class="row-id mono">'+fmtId(b.last9)+'</span>'+right+'</div>'; }
function render(){
  $('#hdDate').textContent=DATE+" · Today";
  const done=boxes.filter(isDone),pending=boxes.filter(b=>!isDone(b));
  $('#hdDone').textContent=done.length; $('#hdTotal').textContent=boxes.length;
  $('#pdfBtn').disabled=boxes.every(b=>doneCount(b)===0);
  const m=$('#main'); let h='';
  h+='<div class="sec-title">Remaining / Pendientes <span class="count">'+pending.length+'</span></div>';
  h+=pending.length?('<div class="rows">'+pending.map(rowHTML).join('')+'</div>'):'<div class="empty">All boxes done! / ¡Listo!</div>';
  if(done.length){ const col=m.dataset.col==='1';
    h+='<div class="sec-title done-h'+(col?' collapsed':'')+'" id="doneHead"><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>Completed / Completadas <span class="count">'+done.length+'</span></div>';
    h+='<div class="rows"'+(col?' hidden':'')+'>'+done.map(rowHTML).join('')+'</div>'; }
  m.innerHTML=h;
}

/* ---------- barcode scan (ML Kit) ---------- */
async function scanBarcode(){
  if(!BScan){ toast('Scanner not available (run as app)',true); return null; }
  try{
    const perm=await BScan.requestPermissions();
    const cam=perm&&perm.camera;
    if(cam && cam!=='granted' && cam!=='limited'){ toast('Camera permission needed / Permiso de cámara',true); return null; }
    try{ const a=await BScan.isGoogleBarcodeScannerModuleAvailable(); if(a && a.available===false){ toast('Installing scanner… / Instalando…'); await BScan.installGoogleBarcodeScannerModule(); } }catch(e){}
    const res=await BScan.scan({ formats:['CODE_128'] });
    const bcs=res&&res.barcodes;
    if(bcs&&bcs.length){ return bcs[0].rawValue||bcs[0].displayValue||null; }
    return null; // cancelled
  }catch(e){ toast('Scan error / Error',true); return null; }
}

/* ---------- native photo ---------- */
async function takePhoto(){
  if(!Camera){ toast('Camera not available (run as app)',true); return null; }
  try{
    const photo=await Camera.getPhoto({ quality:88, allowEditing:false, resultType:'base64', source:'CAMERA', direction:'REAR', width:2000, correctOrientation:true, saveToGallery:false });
    return photo && photo.base64String ? photo.base64String : null;
  }catch(e){ return null; } // user cancelled camera
}

/* ---------- new box flow ---------- */
let cap=null, busy=false;
async function startNewBox(){
  if(busy) return; busy=true;
  const val=await scanBarcode(); busy=false;
  if(!val) return;
  const hit=matchBox(val);
  if(!hit){ toast('Not in list / No en lista: '+keyOf(val),true); return; }
  if(isDone(hit)){ confirmModal('Already done / Ya completada', fmtId(hit.last9)+' already has 3 photos. Retake? / ¿Repetir?','Retake / Repetir',true,async()=>{ for(const p of hit.photos) pDrop(p); hit.photos=[null,null,null]; try{await dbPut(hit);}catch(e){} openCapture(hit); }); return; }
  openCapture(hit);
}
function openCapture(b){
  cap=b;
  const ov=document.createElement('div'); ov.className='overlay'; ov.id='overlay';
  ov.innerHTML='<div class="ov-head"><button class="ov-back" id="ovBack">‹</button><div class="ov-id mono">'+fmtId(b.last9)+'</div><span class="ov-count" id="capCount">0 / 3</span></div>'
    +'<div class="cap-body"><div class="cap-strip" id="capStrip"></div><div class="cap-hint" id="capHint"></div></div>'
    +'<div class="cam-bar" id="capBar"></div>';
  document.body.appendChild(ov);
  $('#ovBack').onclick=closeCapture;
  renderCap();
}
function renderCap(){
  const b=cap; if(!b) return; const c=doneCount(b);
  const strip=$('#capStrip'); let h='';
  for(let i=0;i<3;i++){ const p=b.photos[i]; if(p) h+='<div class="t filled" data-view="'+i+'"><img src="'+pURL(p)+'"><span class="mini">'+(i+1)+'</span></div>'; else h+='<div class="t"><span class="num">'+(i+1)+'</span></div>'; }
  strip.innerHTML=h;
  const cc=$('#capCount'); if(cc){ if(c===3){cc.textContent='3 / 3 ✓';cc.className='ov-count done';} else {cc.textContent=c+' / 3';cc.className='ov-count';} }
  const hint=$('#capHint'); if(hint) hint.textContent = c===3 ? 'Tap a photo to retake, or Done. / Toque para repetir, o Listo.' : 'Take photo '+(firstEmpty(b)+1)+' of 3. / Foto '+(firstEmpty(b)+1)+' de 3.';
  const bar=$('#capBar');
  if(c===3){ bar.innerHTML='<button class="cam-done" id="capDone">Done / Listo</button>'; $('#capDone').onclick=closeCapture; }
  else { bar.innerHTML='<button class="cam-shoot" id="shootBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Take photo '+(firstEmpty(b)+1)+' / Tomar foto</button>'; $('#shootBtn').onclick=shoot; }
}
async function shoot(){
  if(busy||!cap) return; const b=cap; const slot=firstEmpty(b); if(slot<0) return;
  busy=true; const btn=$('#shootBtn'); if(btn) btn.disabled=true;
  const b64=await takePhoto();
  if(b64){ try{ const blob=b64toBlob(b64,'image/jpeg'); const d=await imgDims(blob);
    if(b.photos[slot]) pDrop(b.photos[slot]);
    b.photos[slot]={blob,w:d.w||2000,h:d.h||1500,ts:Date.now()}; await dbPut(b); renderCap();
    if(isDone(b)) toast('✓ '+fmtId(b.last9)+' done'); }catch(e){ toast('Photo failed',true); } }
  busy=false; const b2=$('#shootBtn'); if(b2) b2.disabled=false;
}
function closeCapture(){ const ov=$('#overlay'); if(ov) ov.remove(); cap=null; render(); }

/* retake / view */
document.addEventListener('click',e=>{ const v=e.target.closest('#capStrip [data-view]'); if(v&&cap){ openViewer(cap,+v.dataset.view); } });
function openViewer(b,slot){ const u=pURL(b.photos[slot]); if(!u) return;
  const v=document.createElement('div'); v.className='viewer'; v.id='viewer';
  v.innerHTML='<div class="vcap">'+fmtId(b.last9)+' · '+(slot+1)+' / 3</div><img src="'+u+'"><div class="vbar"><button class="vretake" id="vR">↺ Retake / Repetir</button><button class="vclose-b" id="vC">Close / Cerrar</button></div>';
  document.body.appendChild(v);
  $('#vC').onclick=()=>v.remove();
  $('#vR').onclick=async()=>{ v.remove(); pDrop(b.photos[slot]); b.photos[slot]=null; try{await dbPut(b);}catch(e){} renderCap(); };
}
function reviewBox(b){
  const ov=document.createElement('div'); ov.className='overlay'; ov.id='overlay';
  let g=''; for(let i=0;i<3;i++){ const p=b.photos[i]; g+= p?'<button class="rv-t" data-rv="'+i+'"><img src="'+pURL(p)+'"><span>'+(i+1)+'</span></button>':'<div class="rv-t empty">—</div>'; }
  ov.innerHTML='<div class="ov-head"><button class="ov-back" id="ovBack">‹</button><div class="ov-id mono">'+fmtId(b.last9)+'</div><span class="ov-count done">done</span></div>'
    +'<div class="cap-body"><div class="rv-grid">'+g+'</div><div class="rv-note">To retake, scan the barcode again from the main screen.<br>Para repetir, escanee el código otra vez.</div></div>';
  document.body.appendChild(ov);
  $('#ovBack').onclick=()=>ov.remove();
  ov.querySelectorAll('[data-rv]').forEach(el=>el.onclick=()=>{ const s=+el.dataset.rv; const u=pURL(b.photos[s]); if(!u) return;
    const v=document.createElement('div'); v.className='viewer'; v.innerHTML='<div class="vcap">'+fmtId(b.last9)+' · '+(s+1)+' / 3</div><img src="'+u+'"><div class="vbar"><button class="vclose-b">Close / Cerrar</button></div>';
    document.body.appendChild(v); v.querySelector('button').onclick=()=>v.remove(); });
}

/* ---------- modals ---------- */
function confirmModal(title,msg,ok,danger,onOk){ const m=document.createElement('div'); m.className='modal';
  m.innerHTML='<div class="modal-card"><h3>'+title+'</h3><p>'+msg+'</p><div class="modal-row"><button data-x>Cancel / Cancelar</button><button class="'+(danger?'d':'p')+'" data-ok>'+ok+'</button></div></div>';
  document.body.appendChild(m); m.addEventListener('click',e=>{ if(e.target===m||e.target.hasAttribute('data-x')) m.remove(); else if(e.target.hasAttribute('data-ok')){ m.remove(); onOk(); } }); }
function openSettings(){ const m=document.createElement('div'); m.className='modal';
  m.innerHTML='<div class="modal-card"><h3>Settings / Ajustes</h3><div class="set-block"><label>Replace box list / Reemplazar lista</label><textarea id="idsTA" placeholder="One box ID per line"></textarea><div class="rv-note" style="text-align:left;margin-top:6px">Now: <b>'+boxes.length+'</b>. Paste IDs and replace (photos reset).</div></div><div class="set-actions"><button id="applyIds" style="background:var(--primary);color:var(--primary-ink)">Replace list / Reemplazar</button><button class="d" id="resetPh">Reset all photos / Borrar fotos</button></div><button class="set-close" data-x>Close / Cerrar</button></div>';
  document.body.appendChild(m); m.addEventListener('click',e=>{ if(e.target===m||e.target.hasAttribute('data-x')) m.remove(); });
  m.querySelector('#applyIds').onclick=()=>{ const raw=m.querySelector('#idsTA').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); if(!raw.length){toast('Enter IDs',true);return;} m.remove();
    confirmModal('Replace list','Replace with '+raw.length+' boxes and clear photos?','Replace',true,async()=>{ await replaceList(raw); render(); toast(raw.length+' boxes'); }); };
  m.querySelector('#resetPh').onclick=()=>{ m.remove(); confirmModal('Reset photos','Delete all photos today?','Delete all',true,async()=>{ await resetPhotos(); render(); toast('Photos cleared'); }); };
}

/* ---------- PDF ---------- */
function blobToDataURL(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(blob);});}
async function makePDF(){
  const withP=boxes.filter(b=>doneCount(b)>0);
  if(!withP.length){ toast('No photos yet',true); return; }
  const jsPDF=(window.jspdf&&window.jspdf.jsPDF)||null; if(!jsPDF){ toast('PDF module missing',true); return; }
  const prog=document.createElement('div'); prog.id='pdfProg'; prog.innerHTML='<div class="box"><div style="font-weight:700">Creating PDF…</div><div class="bar"><i id="pdfBar"></i></div></div>'; document.body.appendChild(prog);
  await new Promise(r=>setTimeout(r,20));
  try{
    const doc=new jsPDF({unit:'mm',format:'a4',compress:true}); const PW=210,PH=297,M=12;
    for(let i=0;i<withP.length;i++){ const b=withP[i]; if(i>0) doc.addPage();
      doc.setTextColor(20,20,20); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text(b.fullId.replace(/\s+/g,' ').trim(),M,M+5);
      doc.setDrawColor(210,210,210); doc.line(M,M+9,PW-M,M+9);
      const top=M+13,availH=PH-top-M,gap=5,cellH=(availH-2*gap)/3,cellW=PW-2*M;
      for(let s=0;s<3;s++){ const y=top+s*(cellH+gap),p=b.photos[s];
        if(p){ const data=await blobToDataURL(p.blob); const r=Math.min(cellW/(p.w||1),cellH/(p.h||1)),iw=(p.w||1)*r,ih=(p.h||1)*r; try{ doc.addImage(data,'JPEG',M+(cellW-iw)/2,y+(cellH-ih)/2,iw,ih);}catch(e){} }
        else { doc.setFillColor(244,244,244); doc.rect(M,y,cellW,cellH,'F'); doc.setTextColor(150,150,150); doc.setFontSize(10); doc.text("(no photo)",PW/2,y+cellH/2,{align:'center'}); } }
      const bar=$('#pdfBar'); if(bar) bar.style.width=Math.round((i+1)/withP.length*100)+'%';
      await new Promise(r=>setTimeout(r,0));
    }
    prog.remove();
    const filename="Heatsink_Loading"+DATE+".pdf";
    await savePDF(doc,filename);
  }catch(e){ if($('#pdfProg'))$('#pdfProg').remove(); toast('PDF failed',true); }
}
async function savePDF(doc,filename){
  const dataUri=doc.output('datauristring'); const b64=dataUri.substring(dataUri.indexOf(',')+1);
  if(Filesystem){ try{ const w=await Filesystem.writeFile({ path:filename, data:b64, directory:'DOCUMENTS' });
      toast('Saved to Documents / Guardado');
      if(Share){ try{ await Share.share({ title:filename, url:w.uri }); }catch(e){} }
      return; }catch(e){} }
  // browser fallback (dev)
  try{ const blob=doc.output('blob'); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1500); toast('PDF downloaded'); }catch(e){ toast('Save failed',true); }
}

/* ---------- events ---------- */
$('#newBoxBtn').addEventListener('click',startNewBox);
$('#pdfBtn').addEventListener('click',makePDF);
$('#setBtn').addEventListener('click',openSettings);
$('#main').addEventListener('click',e=>{ const head=e.target.closest('#doneHead'); if(head){ const m=$('#main'); m.dataset.col=m.dataset.col==='1'?'0':'1'; render(); return; }
  const row=e.target.closest('.row.done'); if(row){ const b=boxes.find(x=>x.key===row.dataset.key); if(b) reviewBox(b); } });

/* ---------- boot ---------- */
(async function(){ DB=await openDB(); await loadOrSeed(); render(); })();
