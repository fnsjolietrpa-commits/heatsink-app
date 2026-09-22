/* Scan / Camera Test Lab — Heatsink Loading
   Compares: A) ML Kit live (module-free)  E) camera-preview  G) CameraX native */

const $ = (s) => document.querySelector(s);
const P = (window.Capacitor && window.Capacitor.Plugins) || {};
const Camera = P.Camera;
const BScan = P.BarcodeScanner;       // @capacitor-mlkit/barcode-scanning
const CamPrev = P.CameraPreview;      // @capacitor-community/camera-preview
const CamX = P.CameraXCam;            // custom native CameraX plugin
const Filesystem = P.Filesystem;
const Share = P.Share;
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const CODE = ['CODE_128'];

document.getElementById('ver').textContent = 'v-lab2 ' + new Date().toISOString().slice(0,10);

/* ---------- logging + per-row result ---------- */
function now(){ return new Date().toLocaleTimeString('en-GB'); }
function logAdd(letter, ok, main, extra){
  const el = document.createElement('div');
  el.className = 'e';
  el.innerHTML = `<b>${now()} ${esc(letter)}</b> <span class="${ok?'ok':'bad'}">${ok?'✓':'✗'}</span> ${esc(main)}` +
                 (extra ? ` <span style="opacity:.7">${esc(extra)}</span>` : '');
  $('#log').prepend(el);
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

/* ---------- image measurement + last-photo panel ---------- */
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

let last = { src:null, path:null, dataUrl:null };
async function showPhoto(letter, src, captureMs, pathForDecode, dataUrl){
  $('#photoCard').style.display='block';
  $('#photoPanel').classList.add('show');
  $('#photoImg').src = src;
  last = { src, path: pathForDecode||null, dataUrl: dataUrl||null };
  const info = await measure(src);
  $('#photoInfo').textContent = `${letter} · ${info.w}×${info.h} · ${mb(info.bytes)}` + (captureMs?` · capture ${ms(captureMs)}`:'');
  return info;
}

/* ================= A. ML Kit LIVE (module-free, startScan) ================= */
let mlkitHandle = null, mlkitErrHandle = null;
async function stopMlkitLive(){
  try{ await BScan.stopScan(); }catch(e){}
  try{ mlkitHandle && await mlkitHandle.remove(); }catch(e){} mlkitHandle=null;
  try{ mlkitErrHandle && await mlkitErrHandle.remove(); }catch(e){} mlkitErrHandle=null;
  document.documentElement.classList.remove('scanning');
  document.body.classList.remove('scanning');
}
async function mlkitLive(){
  if(!BScan) return showRes('mlkitLive', false, 'BarcodeScanner plugin not available');
  await ensureCamPerm();
  try{
    if(BScan.isSupported){ const s = await BScan.isSupported(); if(s && s.supported===false){ return showRes('mlkitLive', false, 'Not supported on this device'); } }
  }catch(e){}
  try{
    mlkitHandle = await BScan.addListener('barcodesScanned', async ev=>{
      const bc = ev && ev.barcodes && ev.barcodes[0];
      if(!bc) return;
      await stopMlkitLive();
      showRes('mlkitLive', true, esc(bc.rawValue), (bc.format||'') );
      logAdd('A MLKit live', true, bc.rawValue, bc.format);
    });
    mlkitErrHandle = await BScan.addListener('scanError', async ev=>{
      await stopMlkitLive();
      showRes('mlkitLive', false, 'scan error', ev && ev.message);
      logAdd('A MLKit live', false, (ev&&ev.message)||'error');
    });
    document.documentElement.classList.add('scanning');
    document.body.classList.add('scanning');
    await BScan.startScan({ formats: CODE });
  }catch(e){
    await stopMlkitLive();
    showRes('mlkitLive', false, 'error', e.message||String(e));
    logAdd('A MLKit live', false, e.message||String(e));
  }
}
$('#scanCancel').onclick = ()=>{ stopMlkitLive(); };

/* ================= E. camera-preview (Camera1) ================= */
let pvResolve = null;
function stopPreview(){
  const ov = $('#previewOverlay');
  return (CamPrev && CamPrev.stop ? CamPrev.stop().catch(()=>{}) : Promise.resolve())
    .then(()=>{ document.documentElement.classList.remove('previewing');
                document.body.classList.remove('previewing'); ov.classList.remove('show'); });
}
async function camPreview(){
  if(!CamPrev) return showRes('camPreview', false, 'CameraPreview plugin not available');
  await ensureCamPerm();
  const ov = $('#previewOverlay');
  document.documentElement.classList.add('previewing');
  document.body.classList.add('previewing');
  ov.classList.add('show');
  try{
    await CamPrev.start({
      position:'rear', toBack:true, disableAudio:true,
      x:0, y:0, width: window.innerWidth, height: window.innerHeight,
      enableHighResolution:true, storeToFile:false, lockAndroidOrientation:true
    });
  }catch(e){
    await stopPreview();
    showRes('camPreview', false, 'start failed', e.message||String(e));
    logAdd('E camera-preview', false, e.message||String(e));
    return;
  }
  const action = await new Promise(res=>{ pvResolve = res; });
  if(action === 'cancel'){ await stopPreview(); return; }
  try{
    const t0 = performance.now();
    const r = await CamPrev.capture({ quality: 92 });
    const t = performance.now()-t0;
    await stopPreview();
    const dataUrl = 'data:image/jpeg;base64,' + r.value;
    const info = await showPhoto('E', dataUrl, t, null, dataUrl);
    showRes('camPreview', true, `${info.w}×${info.h}`, `${mb(info.bytes)} · capture ${ms(t)}`);
    logAdd('E camera-preview', true, `${info.w}×${info.h}`, `${mb(info.bytes)} · ${ms(t)}`);
  }catch(e){
    await stopPreview();
    showRes('camPreview', false, 'capture failed', e.message||String(e));
    logAdd('E camera-preview', false, e.message||String(e));
  }
}
$('#pvShoot').onclick = ()=>{ if(pvResolve){ const r=pvResolve; pvResolve=null; r('shoot'); } };
$('#pvCancel').onclick = ()=>{ if(pvResolve){ const r=pvResolve; pvResolve=null; r('cancel'); } };

/* ================= G. CameraX native (custom plugin) ================= */
let camxListeners = [];
async function removeCamxListeners(){
  for(const h of camxListeners){ try{ await h.remove(); }catch(e){} }
  camxListeners = [];
}
async function camNative(){
  if(!CamX){ return showRes('camNative', false, 'CameraXCam not available', '이 빌드에 네이티브 플러그인 미포함 — 재빌드 필요'); }
  await removeCamxListeners();
  let shots = 0, lastBc = '';
  camxListeners.push(await CamX.addListener('barcode', ev=>{
    lastBc = ev.value || '';
    logAdd('G live barcode', true, lastBc);
  }));
  camxListeners.push(await CamX.addListener('captured', async ev=>{
    shots++;
    const dataUrl = 'data:image/jpeg;base64,' + ev.base64;
    await showPhoto('G #'+shots, dataUrl, 0, null, dataUrl);
    showRes('camNative', true, `${ev.width}×${ev.height} (shot ${shots})`, `${mb(ev.bytes)} · barcode: ${ev.barcode||'—'}`);
    logAdd('G CameraX shot', true, `${ev.width}×${ev.height}`, `${mb(ev.bytes)}${ev.barcode?(' · '+ev.barcode):''}`);
  }));
  camxListeners.push(await CamX.addListener('closed', async ev=>{
    logAdd('G CameraX', true, `closed · ${ev.count} shot(s)`, ev.barcode?('barcode '+ev.barcode):'');
    await removeCamxListeners();
  }));
  try{
    await CamX.open({ formats: CODE });
    showRes('camNative', true, '카메라 열림 — 촬영/닫기는 화면 버튼', '연속 촬영 후 ✕ Close');
  }catch(e){
    showRes('camNative', false, 'open failed', e.message||String(e));
    logAdd('G CameraX', false, e.message||String(e));
    await removeCamxListeners();
  }
}

/* ---------- re-decode last photo + share ---------- */
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
  const res = await reader.decodeFromImageUrl(src);
  return res.getText();
}
async function writeTmp(dataUrl){
  const b64 = dataUrl.split(',')[1];
  const res = await Filesystem.writeFile({ path:'lab_tmp.jpg', data:b64, directory:'CACHE' });
  return res.uri.replace('file://','');
}
$('#decBBtn').onclick = async ()=>{
  if(!BScan){ alert('ML Kit not available'); return; }
  if(!last.path && !last.dataUrl){ alert('No photo yet'); return; }
  try{
    let path = last.path;
    if(!path && last.dataUrl){ path = await writeTmp(last.dataUrl); }
    const { barcodes } = await BScan.readBarcodesFromImage({ path, formats: CODE });
    const ok = barcodes && barcodes.length;
    logAdd('↻ MLKit img', ok, ok?barcodes[0].rawValue:'no barcode');
    showRes('mlkitLive', ok, ok?esc(barcodes[0].rawValue):'no barcode (from photo)', 'ML Kit image decode');
  }catch(e){ alert('ML Kit error: '+(e.message||e)); }
};
$('#decZBtn').onclick = async ()=>{
  const src = last.src || last.dataUrl; if(!src){ alert('No photo yet'); return; }
  try{ const v = await zxingDecode(src); logAdd('↻ ZXing img', true, v); alert('ZXing: '+v); }
  catch(e){ logAdd('↻ ZXing img', false, 'not found'); alert('ZXing: no barcode'); }
};
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
const HANDLERS = { mlkitLive, camPreview, camNative };
document.querySelectorAll('.run').forEach(btn=>{
  btn.addEventListener('click', ()=>{ const h = HANDLERS[btn.dataset.m]; if(h) h(); });
});

if(!native){ logAdd('env', false, 'Not native — install the APK to test the camera methods.'); }
