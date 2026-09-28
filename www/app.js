/* Heatsink Loading — outbound box photo tool
   Flow: scan barcode (CameraX native) -> 3 photos (camera-preview) -> save -> daily PDF.
   Scan-only mode: no preset list, boxes are whatever you scan today. */

const $ = (s) => document.querySelector(s);
const P = (window.Capacitor && window.Capacitor.Plugins) || {};
const CamX = P.CameraXCam;        // custom native CameraX barcode scanner
const CamPrev = P.CameraPreview;  // camera-preview for photos
const Filesystem = P.Filesystem;
const Share = P.Share;
const Http = P.CapacitorHttp || window.CapacitorHttp;
const APP_VERSION = 'v16';
const PHOTO_MAX = 1500, PHOTO_Q = 0.78;

/* ---------- configurable values (settings) ---------- */
function photosPerBox(){ let n=parseInt(getCfg().photos,10); if(!n||n<1||n>5) n=2; return n; }
function scanFormats(){ const s=(getCfg().barcodeFormats||'CODE_128').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean); return s.length?s:['CODE_128']; }
function filePrefix(){ return ((getCfg().filePrefix||'').trim()) || MODES[mode].fileBase; }

/* ---------- settings (Drive upload + mode) ---------- */
function getCfg(){ try{ return JSON.parse(localStorage.getItem('heatsink_cfg')||'{}'); }catch(e){ return {}; } }
function setCfg(c){ try{ localStorage.setItem('heatsink_cfg', JSON.stringify(c)); }catch(e){} }

/* ---------- mode (Loading / Repacking): fixed per app build (see mode.js) ---------- */
const MODES = {
  loading:   { label:'Loading',   fileBase:'Heatsink_Loading_'   },   // Heatsink_Loading_2026-09-28.pdf
  repacking: { label:'Repacking', fileBase:'Heatsink_Repacking_' }    // Heatsink_Repacking_2026-09-28.pdf
};
const mode = (window.APP_MODE==='repacking') ? 'repacking' : 'loading';

/* ---------- helpers ---------- */
function pad(n){ return String(n).padStart(2,'0'); }
function today(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function nowTime(){ const d=new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),1900); }
function busy(txt){ $('#busyTxt').textContent=txt||'Working...'; $('#busy').classList.add('show'); }
function unbusy(){ $('#busy').classList.remove('show'); }

let viewDate = today();   // which day's boxes the list shows (new scans always go to today)
function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }

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
async function boxesFor(date){ return (await allBoxes()).filter(b=>b.date===date && (b.mode||'loading')===mode).sort((a,b)=>a.serial<b.serial?-1:(a.serial>b.serial?1:0)); }
async function todayBoxes(){ return boxesFor(today()); }

// Auto-delete boxes older than the retention window (default 7 days, incl. today).
async function pruneOld(){
  let keep = parseInt(getCfg().keepDays, 10); if(!keep || keep < 1) keep = 7;
  const cutoff = ymd(new Date(Date.now() - (keep-1)*86400000));  // oldest day to keep
  const all = await allBoxes();
  let n = 0;
  for(const b of all){ if(b.date < cutoff){ await delBox(b.key); n++; } }
  return n;
}

/* ---------- render ---------- */
function renderDateBar(){
  const isToday = viewDate===today();
  const el=$('#dateSel'); if(el) el.textContent = viewDate + (isToday?'  -  Today':'');
  const nx=$('#dateNext'); if(nx) nx.disabled = isToday;
}
async function render(){
  renderDateBar();
  const boxes = await boxesFor(viewDate);
  $('#doneCount').textContent = boxes.length;
  const list = $('#list');
  if(!boxes.length){ list.innerHTML = '<div class="empty">No boxes &middot; No hay cajas</div>'; return; }
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
      scanHandles.push(await CamX.addListener('closed', ev=>{
        if(ev && ev.barcode){ vibrate(70); finish({ barcode:ev.barcode, photo:ev.photo||null, w:ev.width||0, h:ev.height||0 }); }
        else { finish(null); }
      }));
      await CamX.open({ scanOnly:true, formats: scanFormats() });
    }catch(e){ toast('Scan error'); finish(null); }
  });
}
function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }

/* ---------- capture 3 photos (camera-preview) ---------- */
let photoBuf=[], photoResolve=null, photoBusy=false;
let MAXP = 2;   // total photos per box (barcode photo + extras); set from settings
function setPhotoTitle(){ const n=photoBuf.length; $('#pvTitle').textContent = n>=MAXP ? ('Done '+MAXP+' / '+MAXP) : ('Photo '+(n+1)+' / '+MAXP+'  ('+(MAXP-n)+' left)'); }
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
  // Return to the app UI immediately, then stop the camera in the background,
  // so Cancel always brings the previous screen back even if stop() is slow.
  document.documentElement.classList.remove('previewing');
  document.body.classList.remove('previewing');
  $('#previewOverlay').classList.remove('show');
  $('#pvThumbs').innerHTML='';
  try{ if(CamPrev && CamPrev.stop) CamPrev.stop().catch(()=>{}); }catch(e){}
  return Promise.resolve();
}
// startPhotos: photos already taken (e.g. the barcode shot as photo 1).
function capturePhotos(startPhotos){
  return new Promise(async resolve=>{
    if(!CamPrev){ toast('Camera not available'); return resolve(startPhotos&&startPhotos.length?startPhotos:null); }
    photoBuf = (startPhotos||[]).slice();
    photoResolve=resolve; photoBusy=false;
    renderThumbs(); setPhotoTitle(); $('#pvShoot').disabled=false;
    if(photoBuf.length>=MAXP){ setTimeout(()=>finishPhotos(photoBuf.slice()), 200); return; }
    document.documentElement.classList.add('previewing');
    document.body.classList.add('previewing');
    $('#previewOverlay').classList.add('show');
    try{
      await CamPrev.start({ position:'rear', toBack:true, disableAudio:true, x:0, y:0,
        width:window.innerWidth, height:window.innerHeight, enableHighResolution:true,
        storeToFile:false, lockAndroidOrientation:true });
    }catch(e){ closePreview(); toast('Camera failed'); finishPhotos(startPhotos&&startPhotos.length?startPhotos.slice():null); }
  });
}
async function finishPhotos(result){ await closePreview(); const r=photoResolve; photoResolve=null; if(r) r(result); }
async function pvShoot(){
  if(photoBusy || photoBuf.length>=MAXP) return;
  photoBusy=true; $('#pvShoot').disabled=true;
  try{
    const r=await CamPrev.capture({ quality:92 });
    vibrate(45);
    const scaled=await downscale('data:image/jpeg;base64,'+r.value, PHOTO_MAX, PHOTO_Q);
    photoBuf.push(scaled); renderThumbs(); setPhotoTitle();
    if(photoBuf.length>=MAXP){ setTimeout(()=>finishPhotos(photoBuf.slice()), 450); return; }
  }catch(e){ toast('Capture failed'); }
  finally{ photoBusy=false; if(photoBuf.length<MAXP) $('#pvShoot').disabled=false; }
}
$('#pvShoot').onclick = pvShoot;
$('#pvCancel').onclick = ()=>{ finishPhotos(null); };

/* ---------- new box flow ---------- */
async function newBox(){
  if(viewDate!==today()){ viewDate=today(); await render(); }  // scans always go to today
  const res = await scanBarcode();
  if(!res){ return; }
  const { full, serial, short } = parseBox(res.barcode);
  const key = mode+'::'+today()+'::'+serial;
  const existing = await getBox(key);
  if(existing){ if(!confirm(short+' already scanned today. Re-shoot? / Ya escaneada. Rehacer?')) return; }
  // Photo 1 = the barcode frame captured by the scanner (focus-locked, sharp).
  const startPhotos = [];
  if(res.photo){ startPhotos.push(await downscale('data:image/jpeg;base64,'+res.photo, PHOTO_MAX, PHOTO_Q)); }
  toast('Box '+short+' - '+(3-startPhotos.length)+' more photos');
  const photos = await capturePhotos(startPhotos);
  if(!photos || !photos.length){ return; }
  await putBox({ key, mode, date:today(), full, serial, short, photos, ts:Date.now() });
  toast('Saved '+short+' ('+photos.length+' photos)');
  await render();
  scheduleAuto();
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
  await delBox(viewKey); closeView(); await render(); scheduleAuto(); toast('Deleted');
};
$('#reshootBtn').onclick = async ()=>{
  if(!viewKey) return;
  const b = await getBox(viewKey); if(!b) return;
  closeView();
  toast('Re-shoot '+b.short);
  const photos = await capturePhotos();
  if(!photos || !photos.length) return;
  b.photos = photos; b.ts = Date.now();
  await putBox(b); await render(); scheduleAuto(); toast('Updated '+b.short);
};

/* ---------- PDF build (landscape page, photos side by side) ---------- */
async function buildPdfBlob(date){
  date = date || today();
  const boxes = await boxesFor(date);
  if(!boxes.length) return null;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'a4', orientation:'landscape' });
  const pw = doc.internal.pageSize.getWidth();   // ~842
  const ph = doc.internal.pageSize.getHeight();  // ~595
  const margin = 30;
  boxes.forEach((box,i)=>{
    if(i>0) doc.addPage();
    doc.setFont('helvetica','bold'); doc.setFontSize(14);
    doc.text(box.full, margin, 34, { maxWidth: pw-margin*2 });
    const top=48, availH=ph-top-margin, gap=12;
    const cols=Math.max(1, MAXP);
    const slotW=(pw-margin*2-gap*(cols-1))/cols;
    (box.photos||[]).slice(0,MAXP).forEach((p,idx)=>{
      const s=Math.min(slotW/p.w, availH/p.h);
      const w=p.w*s, h=p.h*s;
      const x=margin + idx*(slotW+gap) + (slotW-w)/2;
      const y=top + (availH-h)/2;
      try{ doc.addImage(p.data,'JPEG',x,y,w,h); }catch(e){}
    });
  });
  const fname = filePrefix() + date + '.pdf';
  const b64 = doc.output('datauristring').split(',')[1];
  try{ await Filesystem.writeFile({ path:fname, data:b64, directory:'DOCUMENTS' }); }catch(e){}
  return { fname, b64, count: boxes.length };
}

async function exportPDF(){
  busy('Building PDF...');
  let r; try{ r = await buildPdfBlob(viewDate); }catch(e){ unbusy(); toast('PDF error: '+(e.message||e)); return; }
  if(!r){ unbusy(); toast('No boxes to export'); return; }
  let uri=null; try{ uri=(await Filesystem.getUri({ path:r.fname, directory:'DOCUMENTS' })).uri; }catch(e){}
  const cfg = getCfg();
  if(cfg.uploadUrl){
    busy('Uploading to Drive...');
    const up = await uploadToDrive(cfg, r.fname, r.b64);
    recordUpload(up.ok, r.fname);
    unbusy();
    if(up.ok){ updateSync('synced'); toast('Uploaded to Drive: '+r.fname); return; }
    toast('Upload failed: '+up.error+' - opening share');
    if(uri && Share){ try{ await Share.share({ title:r.fname, text:r.fname, url:uri }); }catch(e){} }
    return;
  }
  unbusy();
  if(uri && Share){ try{ await Share.share({ title:r.fname, text:r.fname, url:uri }); return; }catch(e){} }
  toast('Saved to Documents: '+r.fname);
}
$('#pdfBtn').onclick = exportPDF;

/* ---------- continuous auto-upload (debounced; runs when scanning pauses) ---------- */
let autoTimer=null, autoBusy=false, autoQueued=false;
const AUTO_DELAY = 25000;   // wait 25s after the last change, so it never runs mid-scan
function autoEnabled(){ return !!getCfg().uploadUrl; }
function scheduleAuto(){
  if(!autoEnabled()) return;
  autoQueued = true; updateSync('pending');
  clearTimeout(autoTimer);
  autoTimer = setTimeout(runAuto, AUTO_DELAY);
}
async function runAuto(){
  if(!autoEnabled()) return;
  if(autoBusy){ autoQueued = true; return; }   // never overlap uploads
  autoBusy = true; autoQueued = false; updateSync('syncing');
  try{
    const r = await buildPdfBlob(today());   // auto always targets today's file
    if(!r){ updateSync('idle'); autoBusy=false; return; }
    const up = await uploadToDrive(getCfg(), r.fname, r.b64);
    recordUpload(up.ok, r.fname);
    if(up.ok){ updateSync('synced'); }
    else { updateSync('error'); setTimeout(scheduleAuto, 60000); }   // retry in 60s
  }catch(e){ updateSync('error'); setTimeout(scheduleAuto, 60000); }
  autoBusy = false;
  if(autoQueued) scheduleAuto();
}
function recordUpload(ok, name){ const c=getCfg(); c.lastUploadAt=Date.now(); c.lastUploadOk=!!ok; c.lastUploadName=name||''; setCfg(c); }
let syncSince='';
function updateSync(state){
  const el = $('#syncStatus'); if(!el) return;
  if(!autoEnabled()){ el.textContent = 'Auto-upload off - set Drive URL in settings'; el.className='syncst off'; return; }
  if(state==='synced') syncSince = nowTime();
  const map = {
    pending: ['Waiting to upload...', 'p'],
    syncing: ['Uploading to Drive...', 's'],
    synced:  ['Auto-uploaded ' + syncSince, 'ok'],
    error:   ['Upload failed - retrying', 'e'],
    idle:    ['Up to date', 'ok']
  };
  const m = map[state] || ['', ''];
  el.textContent = m[0]; el.className = 'syncst ' + m[1];
}

/* ---------- Drive upload (native HTTP, avoids CORS) ---------- */
async function uploadToDrive(cfg, fname, b64){
  try{
    if(!Http){ return { ok:false, error:'no http' }; }
    const resp = await Http.post({
      url: cfg.uploadUrl,
      headers: { 'Content-Type':'application/json' },
      connectTimeout: 30000, readTimeout: 180000,
      data: { token: cfg.uploadToken||'', filename: fname, mimeType:'application/pdf', data: b64 }
    });
    let body = resp && resp.data;
    if(typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){} }
    if(body && body.ok){ return { ok:true, url: body.url }; }
    return { ok:false, error: (body && body.error) || ('HTTP '+(resp&&resp.status)) };
  }catch(e){ return { ok:false, error: (e && e.message) || String(e) }; }
}

/* ---------- settings UI ---------- */
function openSettings(){
  const c=getCfg();
  $('#setUrl').value=c.uploadUrl||''; $('#setToken').value=c.uploadToken||'';
  $('#setKeep').value = c.keepDays || '7';
  $('#setPhotos').value = c.photos || '2';
  $('#setPrefix').value = c.filePrefix || '';
  $('#setBarcode').value = c.barcodeFormats || 'CODE_128';
  $('#setPrefix').placeholder = 'default: ' + MODES[mode].fileBase;
  $('#setModal').classList.add('show');
  renderDiagnostics();
}
$('#gearBtn').onclick = openSettings;
$('#setClose').onclick = ()=>$('#setModal').classList.remove('show');
$('#setSave').onclick = async ()=>{
  const c=getCfg();
  c.uploadUrl=$('#setUrl').value.trim(); c.uploadToken=$('#setToken').value.trim();
  let k=parseInt($('#setKeep').value,10); if(!k||k<1) k=7; c.keepDays=k;
  let p=parseInt($('#setPhotos').value,10); if(!p||p<1||p>5) p=2; c.photos=p;
  c.filePrefix=$('#setPrefix').value.trim();
  c.barcodeFormats=($('#setBarcode').value.trim().toUpperCase()) || 'CODE_128';
  setCfg(c); MAXP = photosPerBox();
  $('#setModal').classList.remove('show');
  const removed = await pruneOld(); await render(); updateSync('idle');
  toast((c.uploadUrl?'Saved - upload ON':'Saved - upload OFF') + (removed?(' - cleared '+removed+' old'):''));
};

/* ---------- diagnostics ---------- */
async function renderDiagnostics(){
  const el=$('#diag'); if(!el) return;
  el.textContent='...';
  let boxes=[]; try{ boxes=await allBoxes(); }catch(e){}
  let bytes=0; const dates={};
  boxes.forEach(b=>{ (b.photos||[]).forEach(p=>{ if(p&&p.data){ const i=p.data.indexOf(','); bytes+=(p.data.length-(i+1))*0.75; } }); dates[b.date]=1; });
  const estMB=(bytes/1048576).toFixed(1);
  let realMB='';
  try{ if(navigator.storage&&navigator.storage.estimate){ const e=await navigator.storage.estimate(); realMB=' | device '+((e.usage||0)/1048576).toFixed(0)+'MB'; } }catch(e){}
  const c=getCfg();
  const last = c.lastUploadAt ? (new Date(c.lastUploadAt).toLocaleString('en-GB')+' - '+(c.lastUploadOk?'OK':'FAILED')+(c.lastUploadName?(' '+c.lastUploadName):'')) : 'never';
  const cam = (CamX?'CameraX OK':'CameraX MISSING')+' / '+(CamPrev?'Preview OK':'Preview MISSING');
  el.textContent = [
    'Version:     '+APP_VERSION+'  ('+MODES[mode].label+')',
    'Today:       '+today(),
    'Stored:      '+boxes.length+' boxes, '+Object.keys(dates).length+' day(s), ~'+estMB+'MB'+realMB,
    'Keep days:   '+(c.keepDays||7),
    'Photos/box:  '+photosPerBox(),
    'Barcode:     '+scanFormats().join(', '),
    'File prefix: '+filePrefix(),
    'Auto-upload: '+(c.uploadUrl?'ON':'OFF'),
    'Last upload: '+last,
    'Camera:      '+cam,
    'Device:      '+navigator.userAgent
  ].join('\n');
}
$('#diagRefresh').onclick = renderDiagnostics;
$('#setTest').onclick = async ()=>{
  const url=$('#setUrl').value.trim(); if(!url){ toast('Enter URL first'); return; }
  busy('Testing...');
  try{
    const resp = await Http.get({ url, connectTimeout:20000, readTimeout:30000 });
    unbusy();
    let body=resp&&resp.data; if(typeof body==='string'){ try{ body=JSON.parse(body); }catch(e){} }
    toast(body && body.ok ? 'Connection OK' : ('Response: '+(resp&&resp.status)));
  }catch(e){ unbusy(); toast('Test failed: '+((e&&e.message)||e)); }
};

/* ---------- clear day (the currently viewed date) ---------- */
$('#resetBtn').onclick = async ()=>{
  const boxes = await boxesFor(viewDate);
  if(!boxes.length){ toast('Nothing to clear'); return; }
  if(!confirm('Clear all '+boxes.length+' boxes of '+viewDate+'? / Borrar?')) return;
  for(const b of boxes){ await delBox(b.key); }
  await render();
  if(viewDate===today()) scheduleAuto();
  toast('Cleared '+viewDate);
};

/* ---------- date navigation ---------- */
function shiftDate(delta){
  const d = new Date(viewDate+'T00:00:00'); d.setDate(d.getDate()+delta);
  const ns = ymd(d);
  if(ns > today()) return;   // never go to the future
  viewDate = ns; render();
}
$('#datePrev').onclick = ()=>shiftDate(-1);
$('#dateNext').onclick = ()=>shiftDate(1);
$('#dateToday').onclick = ()=>{ viewDate = today(); render(); };

/* ---------- init ---------- */
$('#brand').textContent = 'Heatsink ' + MODES[mode].label;
{ const vl=$('#verLabel'); if(vl) vl.textContent = 'Heatsink '+MODES[mode].label+'  ·  '+APP_VERSION; }
MAXP = photosPerBox();
updateSync('idle');
(async ()=>{ try{ await openDB(); await pruneOld(); await render(); }catch(e){ toast('DB error'); } })();
