/* Heatsink Loading — outbound box photo tool
   Flow: scan barcode (CameraX native) -> 3 photos (camera-preview) -> save -> daily PDF.
   Scan-only mode: no preset list, boxes are whatever you scan today. */

const $ = (s) => document.querySelector(s);
const P = (window.Capacitor && window.Capacitor.Plugins) || {};
const CamX = P.CameraXCam;        // custom native CameraX barcode scanner
const CamPrev = P.CameraPreview;  // camera-preview for photos
const Filesystem = P.Filesystem;
const Share = P.Share;
const CODE = ['CODE_128'];

/* ---------- helpers ---------- */
function pad(n){ return String(n).padStart(2,'0'); }
function today(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function nowTime(){ const d=new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),1900); }
function busy(txt){ $('#busyTxt').textContent=txt||'Working...'; $('#busy').classList.add('show'); }
function unbusy(){ $('#busy').classList.remove('show'); }

$('#dateLbl').textContent = today();

function parseBox(raw){
  const full = String(raw||'').trim().replace(/\s+/g,' ');
  const tokens = full.split(' ');
  let serial = tokens.find(t=>/^[A-Z]\d{6,}$/i.test(t)) || tokens[tokens.length-1] || full;
  serial = serial.toUpperCase();
  let short = serial;
  const m = serial.match(/^([A-Z]\d{5})(\d+)$/);
  if(m) short = m[1]+'-'+m[2];
  return { full, serial, short };
}

/* ---------- IndexedDB ---------- */
let db;
function openDB(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open('heatsink', 1);
    r.onupgradeneeded = e=>{ const d=e.target.result; if(!d.objectStoreNames.contains('boxes')) d.createObjectStore('boxes',{keyPath:'key'}); };
    r.onsuccess = e=>{ db=e.target.result; res(); };
    r.onerror = e=>rej(e);
  });
}
function tx(mode, fn){
  return new Promise((res,rej)=>{
    const t=db.transaction('boxes',mode), s=t.objectStore('boxes');
    let req; try{ req=fn(s); }catch(e){ rej(e); return; }
    t.oncomplete=()=>res(req&&req.result); t.onerror=()=>rej(t.error);
  });
}
function getBox(key){ return new Promise(res=>{ const s=db.transaction('boxes').objectStore('boxes'); const r=s.get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); }); }
function putBox(rec){ return tx('readwrite', s=>s.put(rec)); }
function delBox(key){ return tx('readwrite', s=>s.delete(key)); }
function allBoxes(){ return new Promise(res=>{ const out=[]; const s=db.transaction('boxes').objectStore('boxes'); s.openCursor().onsuccess=e=>{ const c=e.target.result; if(c){ out.push(c.value); c.continue(); } else res(out); }; }); }
async function todayBoxes(){ return (await allBoxes()).filter(b=>b.date===today()).sort((a,b)=>a.serial<b.serial?-1:(a.serial>b.serial?1:0)); }

/* ---------- render ---------- */
async function render(){
  const boxes = await todayBoxes();
  $('#doneCount').textContent = boxes.length;
  const list = $('#list');
  if(!boxes.length){ list.innerHTML = '<div class="empty">No boxes yet &middot; A&uacute;n no hay cajas</div>'; return; }
  list.innerHTML = boxes.map(b=>`
    <div class="box" data-key="${esc(b.key)}">
      <div class="chk">&#10003;</div>
      <div class="bid"><div class="s">${esc(b.short)}</div><div class="f">${esc(b.full)}</div></div>
      <div class="bt">${esc(new Date(b.ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}</div>
    </div>`).join('');
  list.querySelectorAll('.box').forEach(el=>el.addEventListener('click',()=>openView(el.dataset.key)));
}

/* ---------- scan barcode (CameraX native, scanOnly) ---------- */
let scanHandles = [];
async function removeScanListeners(){ for(const h of scanHandles){ try{ await h.remove(); }catch(e){} } scanHandles=[]; }
function scanBarcode(){
  return new Promise(async resolve=>{
    if(!CamX){ toast('Scanner not available'); return resolve(null); }
    let done=false;
    const finish = async (val)=>{ if(done) return; done=true; await removeScanListeners(); resolve(val); };
    try{
      scanHandles.push(await CamX.addListener('closed', ev=>{ finish(ev && ev.barcode ? ev.barcode : null); }));
      await CamX.open({ scanOnly:true, formats:CODE });
    }catch(e){ toast('Scan error'); finish(null); }
  });
}

/* ---------- capture 3 photos (camera-preview) ---------- */
let photoBuf=[], photoResolve=null, photoBusy=false;
const MAXP = 3;
function setPhotoTitle(){ const n=photoBuf.length; $('#pvTitle').textContent = n>=MAXP ? (MAXP+' / '+MAXP+' done') : ('Photo '+(n+1)+' / '+MAXP); }
function renderThumbs(){ $('#pvThumbs').innerHTML = photoBuf.map(p=>`<img src="${p.data}">`).join(''); }
function downscale(dataUrl, max, q){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{ let w=img.naturalWidth,h=img.naturalHeight; const s=Math.min(1,max/Math.max(w,h));
      const cw=Math.round(w*s),ch=Math.round(h*s); const c=document.createElement('canvas'); c.width=cw; c.height=ch;
      c.getContext('2d').drawImage(img,0,0,cw,ch); res({data:c.toDataURL('image/jpeg',q),w:cw,h:ch}); };
    img.onerror=()=>res({data:dataUrl,w:1200,h:1600}); img.src=dataUrl;
  });
}
function closePreview(){
  return (CamPrev&&CamPrev.stop?CamPrev.stop().catch(()=>{}):Promise.resolve()).then(()=>{
    document.documentElement.classList.remove('previewing');
    document.body.classList.remove('previewing');
    $('#previewOverlay').classList.remove('show');
    $('#pvThumbs').innerHTML=''; $('#pvDone').style.display='none';
  });
}
function capturePhotos(){
  return new Promise(async resolve=>{
    if(!CamPrev){ toast('Camera not available'); return resolve(null); }
    photoBuf=[]; photoResolve=resolve; photoBusy=false;
    renderThumbs(); setPhotoTitle(); $('#pvShoot').disabled=false; $('#pvDone').style.display='none';
    document.documentElement.classList.add('previewing');
    document.body.classList.add('previewing');
    $('#previewOverlay').classList.add('show');
    try{
      await CamPrev.start({ position:'rear', toBack:true, disableAudio:true, x:0, y:0,
        width:window.innerWidth, height:window.innerHeight, enableHighResolution:true,
        storeToFile:false, lockAndroidOrientation:true });
    }catch(e){ await closePreview(); toast('Camera failed'); finishPhotos(null); }
  });
}
async function finishPhotos(result){ await closePreview(); const r=photoResolve; photoResolve=null; if(r) r(result); }
async function pvShoot(){
  if(photoBusy || photoBuf.length>=MAXP) return;
  photoBusy=true; $('#pvShoot').disabled=true;
  try{
    const r=await CamPrev.capture({ quality:92 });
    const scaled=await downscale('data:image/jpeg;base64,'+r.value, 1600, 0.82);
    photoBuf.push(scaled); renderThumbs(); setPhotoTitle();
    if(photoBuf.length>=1) $('#pvDone').style.display='inline-block';
    if(photoBuf.length>=MAXP){ setTimeout(()=>finishPhotos(photoBuf.slice()), 400); return; }
  }catch(e){ toast('Capture failed'); }
  finally{ photoBusy=false; if(photoBuf.length<MAXP) $('#pvShoot').disabled=false; }
}
$('#pvShoot').onclick = pvShoot;
$('#pvDone').onclick = ()=>{ if(photoBuf.length>0) finishPhotos(photoBuf.slice()); };
$('#pvCancel').onclick = ()=>{ finishPhotos(null); };

/* ---------- new box flow ---------- */
async function newBox(){
  const raw = await scanBarcode();
  if(!raw){ return; }
  const { full, serial, short } = parseBox(raw);
  const key = today()+'::'+serial;
  const existing = await getBox(key);
  if(existing){ if(!confirm(short+' already scanned today. Re-shoot? / Ya escaneada. Rehacer?')) return; }
  toast('Box '+short+' - take 3 photos');
  const photos = await capturePhotos();
  if(!photos || !photos.length){ return; }
  await putBox({ key, date:today(), full, serial, short, photos, ts:Date.now() });
  toast('Saved '+short+' ('+photos.length+' photos)');
  await render();
}
$('#newBox').onclick = newBox;

/* ---------- view / re-shoot / delete ---------- */
let viewKey=null;
async function openView(key){
  const b = await getBox(key); if(!b) return;
  viewKey=key;
  $('#viewShort').textContent = b.short;
  $('#viewFull').textContent = b.full;
  $('#viewPhotos').innerHTML = (b.photos||[]).map(p=>`<img src="${p.data}">`).join('');
  $('#viewModal').classList.add('show');
}
function closeView(){ $('#viewModal').classList.remove('show'); viewKey=null; }
$('#viewClose').onclick = closeView;
$('#deleteBtn').onclick = async ()=>{
  if(!viewKey) return;
  if(!confirm('Delete this box? / Eliminar esta caja?')) return;
  await delBox(viewKey); closeView(); await render(); toast('Deleted');
};
$('#reshootBtn').onclick = async ()=>{
  if(!viewKey) return;
  const b = await getBox(viewKey); if(!b) return;
  closeView();
  toast('Re-shoot '+b.short);
  const photos = await capturePhotos();
  if(!photos || !photos.length) return;
  b.photos = photos; b.ts = Date.now();
  await putBox(b); await render(); toast('Updated '+b.short);
};

/* ---------- PDF ---------- */
async function exportPDF(){
  const boxes = await todayBoxes();
  if(!boxes.length){ toast('No boxes to export'); return; }
  busy('Building PDF... '+boxes.length+' boxes');
  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const margin = 36;
    boxes.forEach((box,i)=>{
      if(i>0) doc.addPage();
      doc.setFont('helvetica','bold'); doc.setFontSize(14);
      doc.text(box.full, margin, 44, { maxWidth: pw-margin*2 });
      const top=62, avail=ph-top-margin, slotH=avail/3;
      let y=top;
      (box.photos||[]).slice(0,3).forEach(p=>{
        const maxW=pw-margin*2, maxH=slotH-8;
        const s=Math.min(maxW/p.w, maxH/p.h);
        const w=p.w*s, h=p.h*s, x=margin+(maxW-w)/2;
        try{ doc.addImage(p.data,'JPEG',x,y,w,h); }catch(e){}
        y+=slotH;
      });
    });
    const fname = 'Heatsink_Loading'+today()+'.pdf';
    const b64 = doc.output('datauristring').split(',')[1];
    await Filesystem.writeFile({ path:fname, data:b64, directory:'DOCUMENTS' });
    let uri=null; try{ uri=(await Filesystem.getUri({ path:fname, directory:'DOCUMENTS' })).uri; }catch(e){}
    unbusy();
    if(uri && Share){ try{ await Share.share({ title:fname, text:fname, url:uri }); return; }catch(e){} }
    toast('Saved to Documents: '+fname);
  }catch(e){ unbusy(); toast('PDF error: '+(e.message||e)); }
}
$('#pdfBtn').onclick = exportPDF;

/* ---------- clear day ---------- */
$('#resetBtn').onclick = async ()=>{
  const boxes = await todayBoxes();
  if(!boxes.length){ toast('Nothing to clear'); return; }
  if(!confirm('Clear all '+boxes.length+" of today's boxes? / Borrar todas?")) return;
  for(const b of boxes){ await delBox(b.key); }
  await render(); toast('Cleared');
};

/* ---------- init ---------- */
(async ()=>{ try{ await openDB(); await render(); }catch(e){ toast('DB error'); } })();
