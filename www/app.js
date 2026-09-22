/* Scan / Camera Test Lab — Heatsink Loading
   Compares barcode-recognition + photo-capture methods on-device. */

const $ = (s) => document.querySelector(s);
const P = (window.Capacitor && window.Capacitor.Plugins) || {};
const Camera = P.Camera;
const BScan = P.BarcodeScanner;       // @capacitor-mlkit/barcode-scanning
const CamPrev = P.CameraPreview;      // @capacitor-community/camera-preview
const Filesystem = P.Filesystem;
const Share = P.Share;
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

const CODE = ['CODE_128'];            // format we care about (excludes the QR)

document.getElementById('ver').textContent = 'v-lab ' + new Date().toISOString().slice(0,10);

/* ---------- logging + per-row result ---------- */
function now(){ return new Date().toLocaleTimeString('en-GB'); }
function logAdd(letter, ok, main, extra){
  const el = document.createElement('div');
  el.className = 'e';
  el.innerHTML = `<b>${now()} ${letter}</b> <span class="${ok?'ok':'bad'}">${ok?'✓':'✗'}</span> ${esc(main)}` +
                 (extra ? ` <span style="opacity:.7">${esc(extra)}</span>` : '');
  const log = $('#log'); log.prepend(el);
}
function showRes(method, ok, mainHtml, subText){
  const el = document.getElementById('res-'+method);
  if(!el) return;
  el.className = 'res show ' + (ok?'ok':'bad');
  el.innerHTML = `<div class="v">${ok?'':'✗ '}${mainHtml}</div>` + (subText?`<div class="sub2">${esc(subText)}</div>`:'');
}
function esc(s){ return String(s==null?'':s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function ms(t){ return Math.round(t) + 'ms'; }
function mb(bytes){ return bytes ? (bytes/1048576).toFixed(2)+'MB' : '—'; }

$('#clearLog').onclick = () => { $('#log').innerHTML=''; };

/* ---------- permissions ---------- */
async function ensureCamPerm(){
  try{ if(Camera && Camera.requestPermissions) await Camera.requestPermissions({permissions:['camera']}); }catch(e){}
  try{ if(BScan && BScan.requestPermissions) await BScan.requestPermissions(); }catch(e){}
}

/* ---------- image measurement ---------- */
async function measure(src){
  try{
    const bl = await fetch(src).then(r=>r.blob());
    let w=0,h=0;
    try{ const bmp = await createImageBitmap(bl); w=bmp.width; h=bmp.height; bmp.close && bmp.close(); }
    catch(e){ const d = await imgDims(src); w=d.w; h=d.h; }
    return {w,h,bytes:bl.size};
  }catch(e){ const d = await imgDims(src); return {w:d.w,h:d.h,bytes:0}; }
}
function imgDims(src){ return new Promise(res=>{ const i=new Image();
  i.onload=()=>res({w:i.naturalWidth,h:i.naturalHeight}); i.onerror=()=>res({w:0,h:0}); i.src=src; }); }

/* ---------- last-photo panel ---------- */
let last = { src:null, path:null, dataUrl:null };
async function showPhoto(letter, src, captureMs, pathForDecode, dataUrl){
  $('#photoCard').style.display='block';
  $('#photoPanel').classList.add('show');
  $('#photoImg').src = src;
  last = { src, path: pathForDecode||null, dataUrl: dataUrl||null };
  const info = await measure(src);
  $('#photoInfo').textContent = `${letter} · ${info.w}×${info.h} · ${mb(info.bytes)} · capture ${ms(captureMs)}`;
  return info;
}

/* ================= BARCODE METHODS ================= */

// A. ML Kit live scan (Google code-scanner UI)
async function mlkitLive(){
  if(!BScan) return showRes('mlkitLive', false, 'BarcodeScanner plugin not available');
  await ensureCamPerm();
  try{
    if(BScan.isGoogleBarcodeScannerModuleAvailable){
      const {available} = await BScan.isGoogleBarcodeScannerModuleAvailable();
      if(!available && BScan.installGoogleBarcodeScannerModule){
        showRes('mlkitLive', false, 'Downloading scanner module… 잠시만요');
        await BScan.installGoogleBarcodeScannerModule();
      }
    }
  }catch(e){}
  const t0 = performance.now();
  try{
    const { barcodes } = await BScan.scan({ formats: CODE });
    const t = performance.now()-t0;
    if(barcodes && barcodes.length){
      const b = barcodes[0];
      showRes('mlkitLive', true, esc(b.rawValue), `${b.format} · ${ms(t)}`);
      logAdd('A ML Kit Live', true, b.rawValue, ms(t));
    }else{
      showRes('mlkitLive', false, 'No barcode', ms(t));
      logAdd('A ML Kit Live', false, 'no barcode', ms(t));
    }
  }catch(e){
    showRes('mlkitLive', false, 'Cancelled / error', e.message||String(e));
    logAdd('A ML Kit Live', false, e.message||String(e));
  }
}

// shared: take a still photo, return {path, dataUrl}
async function takeStill(quality=92){
  await ensureCamPerm();
  const uriShot = await Camera.getPhoto({
    quality, resultType:'uri', source:'CAMERA', direction:'REAR',
    correctOrientation:true, saveToGallery:false, width:2400
  });
  return { path: uriShot.path, src: uriShot.webPath };
}

// B. Photo -> ML Kit readBarcodesFromImage
async function mlkitImage(){
  if(!Camera || !BScan) return showRes('mlkitImage', false, 'plugin not available');
  try{
    const shot = await takeStill(92);
    await showPhoto('B', shot.src, 0, shot.path, null);
    const t0 = performance.now();
    const { barcodes } = await BScan.readBarcodesFromImage({ path: shot.path, formats: CODE });
    const t = performance.now()-t0;
    if(barcodes && barcodes.length){
      showRes('mlkitImage', true, esc(barcodes[0].rawValue), `decode ${ms(t)}`);
      logAdd('B Photo→MLKit', true, barcodes[0].rawValue, 'decode '+ms(t));
    }else{
      showRes('mlkitImage', false, 'No barcode in photo', `decode ${ms(t)}`);
      logAdd('B Photo→MLKit', false, 'no barcode', 'decode '+ms(t));
    }
  }catch(e){
    showRes('mlkitImage', false, 'error', e.message||String(e));
    logAdd('B Photo→MLKit', false, e.message||String(e));
  }
}

// C. Photo -> ZXing decode
function zxingReader(){
  const hints = new Map();
  try{
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  }catch(e){}
  return new ZXing.BrowserMultiFormatReader(hints);
}
async function zxingDecode(src){
  const reader = zxingReader();
  const res = await reader.decodeFromImageUrl(src); // throws NotFoundException if none
  return res.getText();
}
async function zxingImage(){
  if(typeof ZXing === 'undefined') return showRes('zxingImage', false, 'ZXing not loaded');
  if(!Camera) return showRes('zxingImage', false, 'Camera plugin not available');
  try{
    const shot = await takeStill(92);
    await showPhoto('C', shot.src, 0, shot.path, null);
    const t0 = performance.now();
    let val=null, err=null;
    try{ val = await zxingDecode(shot.src); }catch(e){ err=e; }
    const t = performance.now()-t0;
    if(val){
      showRes('zxingImage', true, esc(val), `decode ${ms(t)}`);
      logAdd('C Photo→ZXing', true, val, 'decode '+ms(t));
    }else{
      showRes('zxingImage', false, 'No barcode in photo', `decode ${ms(t)}`);
      logAdd('C Photo→ZXing', false, (err&&err.name)||'not found', 'decode '+ms(t));
    }
  }catch(e){
    showRes('zxingImage', false, 'error', e.message||String(e));
    logAdd('C Photo→ZXing', false, e.message||String(e));
  }
}

// D. PDA hardware scanner (keyboard wedge)
let pdaT0 = 0, pdaTimer = null;
function pda(){
  const wrap = $('#pdaWrap'); wrap.classList.add('show');
  const inp = $('#pdaInput'); inp.value=''; inp.focus();
  pdaT0 = performance.now();
  showRes('pda', true, 'Waiting for scan… PDA 트리거를 당기세요', '입력창 포커스 유지');
}
function pdaFinalize(){
  const inp = $('#pdaInput');
  const val = inp.value.trim();
  const t = performance.now()-pdaT0;
  if(val){
    showRes('pda', true, esc(val), `wedge ${ms(t)}`);
    logAdd('D PDA wedge', true, val, ms(t));
  }else{
    showRes('pda', false, 'Empty', '입력이 없었습니다');
  }
  $('#pdaWrap').classList.remove('show');
  inp.blur();
}
(function bindPda(){
  const inp = $('#pdaInput');
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); if(pdaTimer)clearTimeout(pdaTimer); pdaFinalize(); }});
  inp.addEventListener('input', ()=>{ if(pdaTimer)clearTimeout(pdaTimer); pdaTimer=setTimeout(pdaFinalize, 250); });
})();

/* ================= PHOTO METHODS ================= */

// E. CameraX in-app preview (@capacitor-community/camera-preview)
let pvResolve = null;
function stopPreview(){
  const ov = $('#previewOverlay');
  return (CamPrev && CamPrev.stop ? CamPrev.stop().catch(()=>{}) : Promise.resolve())
    .then(()=>{ document.body.classList.remove('previewing'); ov.classList.remove('show'); });
}
async function cameraX(){
  if(!CamPrev) return showRes('cameraX', false, 'CameraPreview plugin not available');
  await ensureCamPerm();
  const ov = $('#previewOverlay');
  document.body.classList.add('previewing');
  ov.classList.add('show');
  try{
    await CamPrev.start({
      position:'rear', toBack:true, disableAudio:true,
      x:0, y:0, width: window.innerWidth, height: window.innerHeight,
      enableHighResolution:true, storeToFile:false, enableZoom:true, lockAndroidOrientation:true
    });
  }catch(e){
    await stopPreview();
    showRes('cameraX', false, 'start failed', e.message||String(e));
    logAdd('E CameraX', false, e.message||String(e));
    return;
  }
  // wait for shoot / cancel
  const action = await new Promise(res=>{ pvResolve = res; });
  if(action === 'cancel'){ await stopPreview(); return; }
  try{
    const t0 = performance.now();
    const r = await CamPrev.capture({ quality: 92 });
    const t = performance.now()-t0;
    await stopPreview();
    const dataUrl = 'data:image/jpeg;base64,' + r.value;
    const info = await showPhoto('E', dataUrl, t, null, dataUrl);
    showRes('cameraX', true, `${info.w}×${info.h}`, `${mb(info.bytes)} · capture ${ms(t)}`);
    logAdd('E CameraX', true, `${info.w}×${info.h}`, `${mb(info.bytes)} · ${ms(t)}`);
  }catch(e){
    await stopPreview();
    showRes('cameraX', false, 'capture failed', e.message||String(e));
    logAdd('E CameraX', false, e.message||String(e));
  }
}
$('#pvShoot').onclick = ()=>{ if(pvResolve){ const r=pvResolve; pvResolve=null; r('shoot'); } };
$('#pvCancel').onclick = ()=>{ if(pvResolve){ const r=pvResolve; pvResolve=null; r('cancel'); } };

// F. Capacitor Camera (system camera app)
async function capCamera(){
  if(!Camera) return showRes('capCamera', false, 'Camera plugin not available');
  try{
    const shot = await takeStill(92);
    const info = await showPhoto('F', shot.src, 0, shot.path, null);
    showRes('capCamera', true, `${info.w}×${info.h}`, `${mb(info.bytes)}`);
    logAdd('F Cap Camera', true, `${info.w}×${info.h}`, mb(info.bytes));
  }catch(e){
    showRes('capCamera', false, 'error / cancelled', e.message||String(e));
    logAdd('F Cap Camera', false, e.message||String(e));
  }
}

/* ---------- re-decode last photo + share ---------- */
$('#decBBtn').onclick = async ()=>{
  if(!last.path && !last.dataUrl) return;
  try{
    let barcodes;
    if(last.path){ ({barcodes} = await BScan.readBarcodesFromImage({path:last.path, formats:CODE})); }
    else { // dataUrl -> write temp then decode
      const p = await writeTmp(last.dataUrl);
      ({barcodes} = await BScan.readBarcodesFromImage({path:p, formats:CODE}));
    }
    const ok = barcodes && barcodes.length;
    logAdd('↻ MLKit', ok, ok?barcodes[0].rawValue:'no barcode');
    alert(ok ? ('ML Kit: '+barcodes[0].rawValue) : 'ML Kit: no barcode');
  }catch(e){ alert('ML Kit error: '+(e.message||e)); }
};
$('#decZBtn').onclick = async ()=>{
  const src = last.src || last.dataUrl; if(!src) return;
  try{ const v = await zxingDecode(src); logAdd('↻ ZXing', true, v); alert('ZXing: '+v); }
  catch(e){ logAdd('↻ ZXing', false, 'not found'); alert('ZXing: no barcode'); }
};
async function writeTmp(dataUrl){
  const b64 = dataUrl.split(',')[1];
  const res = await Filesystem.writeFile({ path:'lab_tmp.jpg', data:b64, directory:'CACHE' });
  return res.uri.replace('file://','');
}
$('#shareBtn').onclick = async ()=>{
  try{
    let url = last.path ? (last.path.startsWith('file')?last.path:('file://'+last.path)) : null;
    if(!url && last.dataUrl){
      const b64 = last.dataUrl.split(',')[1];
      const res = await Filesystem.writeFile({ path:'lab_share.jpg', data:b64, directory:'CACHE' });
      url = res.uri;
    }
    if(!url && last.src){ url = last.src; }
    await Share.share({ title:'Test capture', url });
  }catch(e){ alert('Share failed: '+(e.message||e)); }
};

/* ---------- dispatch ---------- */
const HANDLERS = { mlkitLive, mlkitImage, zxingImage, pda, cameraX, capCamera };
document.querySelectorAll('.run').forEach(btn=>{
  btn.addEventListener('click', ()=>{ const h = HANDLERS[btn.dataset.m]; if(h) h(); });
});

if(!native){
  logAdd('env', false, 'Not running as native app — plugins limited. Install the APK to test.');
}
