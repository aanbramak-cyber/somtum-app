/* ===== BELI MANUAL + DAFTAR BELANJA (frontend, sisip sebelum function renderHome) ===== */
var BLM = { list: [] };

/* apiStock + auto-retry: Apps Script kadang balas UNAUTHORIZED/timeout pas cold start.
   Ulang diam-diam beberapa kali sebelum benar-benar gagal. */
async function blmApi(action, payload){
  var last;
  for(var i=0;i<4;i++){
    try{ return await apiStock(action, payload||{}); }
    catch(e){
      last=e;
      var msg=(e&&e.message)||String(e);
      if(!/UNAUTHORIZED|Failed to fetch|NetworkError|network|timeout|Timeout|503|502/i.test(msg)) throw e;
      await new Promise(function(r){ setTimeout(r, 700*(i+1)); });
    }
  }
  throw last;
}

async function renderBeliManual(){
  var bag = (S.staff && (String(S.staff.divisi||'').toUpperCase().indexOf('FOH')>=0)) ? 'FOH' : 'KITCHEN';
  var L = function(t){ return '<div style="font-size:12px;color:var(--mut,#888);margin:10px 0 3px">'+t+'</div>'; };
  var html = '<div class="card">'
    + L('Nama barang / bahan *') + '<input id="bmNama" type="text" autocomplete="off" placeholder="cth: Tusuk sate bambu">'
    + L('Bagian') + '<select id="bmBag"><option value="KITCHEN"'+(bag==='KITCHEN'?' selected':'')+'>Kitchen</option><option value="FOH"'+(bag==='FOH'?' selected':'')+'>FOH</option></select>'
    + '<div class="row mt"><div style="flex:1">'+L('Jumlah *')+'<input id="bmJml" type="text" inputmode="decimal" placeholder="cth: 5"></div>'
    + '<div style="flex:1">'+L('Satuan')+'<input id="bmSat" type="text" placeholder="pcs / kg / ml"></div></div>'
    + '<div class="row mt"><div style="flex:1">'+L('Kategori')+'<input id="bmKat" type="text" placeholder="cth: Packaging"></div>'
    + '<div style="flex:1">'+L('Estimasi harga')+'<input id="bmHrg" type="text" inputmode="numeric" placeholder="cth: 20000"></div></div>'
    + L('Supplier (opsional)') + '<input id="bmSup" type="text" placeholder="nama supplier">'
    + L('Catatan (opsional)') + '<input id="bmCat" type="text" placeholder="alasan / detail">'
    + '<button class="btn mt" id="blmKirim" onclick="blmKirim()">Tambah ke Daftar Belanja</button>'
    + '</div>'
    + '<div class="muted center mt" style="font-size:12px">Barang manual masuk Daftar Belanja dengan status BARU. Admin konfirmasi saat barang diterima & bisa menambahkannya ke Master.</div>';
  page('Beli Manual', html);
}

async function blmKirim(){
  var g = function(id){ var el=document.getElementById(id); return el? String(el.value||'').trim() : ''; };
  var nama=g('bmNama'), jml=g('bmJml');
  if(!nama){ alert('Nama barang wajib diisi'); return; }
  if(!jml || isNaN(Number(jml)) || Number(jml)<=0){ alert('Jumlah harus angka lebih dari 0'); return; }
  var btn=document.getElementById('blmKirim'); if(btn){ btn.disabled=true; btn.textContent='Mengirim…'; }
  try{
    await blmApi('manual_add', {
      barang: nama, bagian: g('bmBag'), jumlah: jml, satuan: g('bmSat'),
      kategori: g('bmKat'), harga: g('bmHrg'), supplier: g('bmSup'), catatan: g('bmCat'),
      idempotencyKey: 'bm-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)
    });
    alert('Berhasil! "'+nama+'" ditambahkan ke Daftar Belanja.');
    show(renderBelanja);
  }catch(e){
    alert('Gagal: '+((e&&e.message)||e));
    if(btn){ btn.disabled=false; btn.textContent='Tambah ke Daftar Belanja'; }
  }
}

async function renderBelanja(){
  page('Daftar Belanja', '<div class="muted center mt">Memuat…</div>');
  try{ BLM.list = await blmApi('manual_list', {}) || []; }
  catch(e){ return page('Daftar Belanja', '<div class="card"><div class="muted">'+h((e&&e.message)||e)+'</div><button class="btn mt" onclick="renderBelanja()">Coba lagi</button></div>'); }
  drawBelanja();
}

function bmBadgeColor(st){
  if(st==='SUDAH DIORDER') return '#2e7d32';
  if(st==='DIBATALKAN')    return '#b23b3b';
  if(st==='SIAP DIORDER')  return '#c8791f';
  return '#5a3222';
}

function drawBelanja(){
  var isAdmin = (typeof roleAtLeast==='function') ? roleAtLeast('kepala') : false;
  var items = BLM.list || [];
  var body = '<div class="row mb"><button class="btn sm" onclick="show(renderBeliManual)">+ Beli Manual</button>'
           + '<button class="btn sm ghost" onclick="renderBelanja()">&#8635; Refresh</button></div>';
  if(!items.length){ body += '<div class="muted center mt">Belum ada item di daftar belanja.</div>'; }
  else {
    body += items.map(function(it){
      var pill = function(txt,bg){ return '<span style="font-size:10px;padding:2px 7px;border-radius:999px;color:#fff;background:'+bg+'">'+h(txt)+'</span>'; };
      var man = it.manual ? ' '+pill('manual','#7a5c3a') : '';
      var meta = h(it.bagian)+' &middot; '+h(it.jumlah)+' '+h(it.satuan||'')
               + (it.kategori?' &middot; '+h(it.kategori):'')
               + (it.harga?' &middot; Rp'+h(it.harga):'')
               + (it.supplier?' &middot; '+h(it.supplier):'')
               + (it.diterima?' &middot; <span style="color:#2e7d32">diterima</span>':'');
      var ctl = '';
      // Status order: SEMUA orang boleh ubah (siap order / sudah order)
      if(it.status!=='DIBATALKAN'){
        if(it.status==='BARU')         ctl += '<button class="btn sm ghost" onclick="bmAct(\''+it.id+'\',\'belanja_set_ready\')">Siap order</button>';
        if(it.status!=='SUDAH DIORDER') ctl += '<button class="btn sm ghost" onclick="bmAct(\''+it.id+'\',\'belanja_mark_ordered\')">Sudah diorder</button>';
      }
      // Konfirmasi terima, promote ke master, batal: khusus admin (kepala+)
      if(isAdmin){
        if(!it.diterima && it.status!=='DIBATALKAN') ctl += '<button class="btn sm" onclick="bmRecv(\''+it.id+'\')">Terima</button>';
        if(it.manual && !it.promoted) ctl += '<button class="btn sm ghost" onclick="bmProm(\''+it.id+'\')">+ Master</button>';
        if(it.status!=='DIBATALKAN' && it.status!=='SUDAH DIORDER') ctl += '<button class="btn sm ghost" onclick="bmAct(\''+it.id+'\',\'belanja_cancel\')">Batal</button>';
      }
      return '<div class="rowcard"><div class="rh"><span><b>'+h(it.barang)+'</b>'+man+'</span>'+pill(it.status, bmBadgeColor(it.status))+'</div>'
           + '<div class="muted" style="font-size:12px;margin-top:2px">'+meta+'</div>'
           + (it.catatan?'<div class="muted" style="font-size:12px">'+h(it.catatan)+'</div>':'')
           + (ctl?'<div class="row mt" style="flex-wrap:wrap;gap:6px">'+ctl+'</div>':'')
           + '</div>';
    }).join('');
  }
  page('Daftar Belanja', body);
}

async function bmAct(id, action){
  try{ await blmApi(action, {id:id}); renderBelanja(); }
  catch(e){ alert('Gagal: '+((e&&e.message)||e)); }
}
async function bmRecv(id){
  if(!confirm('Tandai barang ini DITERIMA & catat ke Barang Masuk?')) return;
  try{ await blmApi('manual_receive', {id:id}); alert('Barang diterima & dicatat ke Barang Masuk.'); renderBelanja(); }
  catch(e){ alert('Gagal: '+((e&&e.message)||e)); }
}
async function bmProm(id){
  if(!confirm('Tambahkan barang ini ke Master (jadi barang tetap)?')) return;
  try{ var r=await blmApi('manual_promote', {id:id}); alert('Ditambahkan ke Master.'); renderBelanja(); }
  catch(e){ alert('Gagal: '+((e&&e.message)||e)); }
}

/* ===== SELF-INSTALL: sisipkan 2 tile ke Home tanpa mengubah renderHome ===== */
(function(){
  function inject(){
    try{
      var anyTile = document.querySelector('.tile');
      if(anyTile && !document.getElementById('bmTileBM')){
        var grid = anyTile.parentNode;
        var wrap = document.createElement('div');
        wrap.innerHTML =
          '<div class="tile" id="bmTileBM" onclick="show(renderBeliManual)"><div class="ic">🛒</div><div class="lb">Beli Manual</div><div class="sb">Tambah barang di luar master</div></div>'
        + '<div class="tile" id="bmTileDB" onclick="show(renderBelanja)"><div class="ic">🧾</div><div class="lb">Daftar Belanja</div><div class="sb">Lihat &amp; kelola item belanja</div></div>';
        while(wrap.firstChild) grid.appendChild(wrap.firstChild);
      }
    }catch(e){}
  }
  function patch(){
    try{
      if(typeof window.renderHome==='function' && !window.renderHome.__bmPatched){
        var _rh = window.renderHome;
        window.renderHome = function(){ var r=_rh.apply(this,arguments); setTimeout(inject,0); return r; };
        window.renderHome.__bmPatched = true;
      }
    }catch(e){}
    inject();
  }
  if(document.readyState==='complete') patch();
  else window.addEventListener('load', patch);
  setTimeout(patch, 800); setTimeout(patch, 2000); setTimeout(patch, 4000);
})();
