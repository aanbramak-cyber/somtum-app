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

var BLM_SEND = { key: null, sig: null, busy: false };
async function blmKirim(){
  if (BLM_SEND.busy) return;
  var g = function(id){ var el=document.getElementById(id); return el? String(el.value||'').trim() : ''; };
  var nama=g('bmNama'), jml=g('bmJml');
  if(!nama){ alert('Nama barang wajib diisi'); return; }
  if(!jml || isNaN(Number(jml)) || Number(jml)<=0){ alert('Jumlah harus angka lebih dari 0'); return; }
  // Kunci dibuat SEKALI per isian ini, dipakai ulang kalau gagal/diulang (klik lagi) —
  // supaya server bisa tahu ini submit yang SAMA, bukan barang baru (anti-dobel).
  // Kalau isian berubah (nama/jumlah/dll diedit), kunci direset — dianggap submit baru.
  var sig = JSON.stringify([nama, g('bmBag'), jml, g('bmSat'), g('bmKat'), g('bmHrg'), g('bmSup'), g('bmCat')]);
  if (BLM_SEND.sig !== sig) { BLM_SEND.key = null; BLM_SEND.sig = sig; }
  if (!BLM_SEND.key) BLM_SEND.key = 'bm-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  BLM_SEND.busy = true;
  var btn=document.getElementById('blmKirim'); if(btn){ btn.disabled=true; btn.textContent='Mengirim… (bisa beberapa detik)'; }
  try{
    await blmApi('manual_add', {
      barang: nama, bagian: g('bmBag'), jumlah: jml, satuan: g('bmSat'),
      kategori: g('bmKat'), harga: g('bmHrg'), supplier: g('bmSup'), catatan: g('bmCat'),
      idempotencyKey: BLM_SEND.key
    });
    BLM_SEND.key = null; BLM_SEND.busy = false;
    alert('Berhasil! "'+nama+'" ditambahkan ke Daftar Belanja.');
    show(renderBelanja);
  }catch(e){
    BLM_SEND.busy = false;
    alert('Gagal: '+((e&&e.message)||e)+'\n\nAman untuk tekan "Tambah" lagi — tidak akan dobel.');
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

/* ===== LAPORAN STOK (LEDGER) — Fase 2 ===== */
var LSF = { data:null, bagian:'SEMUA', periode:'30', kategori:'', cari:'' };

function lsfPeriodDates(){
  var today = new Date();
  var d = new Date(today.getTime());
  if(LSF.periode==='7')       d.setDate(d.getDate()-7);
  else if(LSF.periode==='30') d.setDate(d.getDate()-30);
  else if(LSF.periode==='bulan') d = new Date(today.getFullYear(), today.getMonth(), 1);
  else return { dari:'', sampai:'' }; // semua
  var iso = function(x){ return x.getFullYear()+'-'+('0'+(x.getMonth()+1)).slice(-2)+'-'+('0'+x.getDate()).slice(-2); };
  return { dari: iso(d), sampai: iso(today) };
}
function lsfStatusColor(st){
  st = String(st||'').toLowerCase();
  if(st.indexOf('habis')>=0)   return '#b23b3b';
  if(st.indexOf('menipis')>=0) return '#c8791f';
  if(st.indexOf('aman')>=0)    return '#2e7d32';
  return '#8a8a8a';
}
function lsfNum(n){ n = Number(n)||0; return (Math.round(n*100)/100).toLocaleString('id-ID'); }
function lsfSet(k,v){ LSF[k]=v; lsfRender(); }

async function lsfRender(){
  page('Laporan Stok', '<div class="muted center mt">Memuat…</div>');
  var pd = lsfPeriodDates();
  try{
    var r = await blmApi('stok_ledger', { bagian:LSF.bagian, dari:pd.dari, sampai:pd.sampai, kategori:LSF.kategori });
    LSF.data = (r && r.data) ? r.data : r;
  }catch(e){
    return page('Laporan Stok', '<div class="card"><div class="muted">'+h((e&&e.message)||e)+'</div><button class="btn mt" onclick="lsfRender()">Coba lagi</button></div>');
  }
  drawLaporanStok();
}

function drawLaporanStok(){
  var d = LSF.data || { rows:[], summary:{} };
  var s = d.summary || {};
  var chip = function(txt,active,onclick){ return '<button class="btn sm '+(active?'':'ghost')+'" onclick="'+onclick+'">'+txt+'</button>'; };
  var bagBar = '<div class="row" style="gap:6px;flex-wrap:wrap">'
    + chip('Semua',  LSF.bagian==='SEMUA',  "lsfSet('bagian','SEMUA')")
    + chip('Kitchen',LSF.bagian==='KITCHEN',"lsfSet('bagian','KITCHEN')")
    + chip('FOH',    LSF.bagian==='FOH',    "lsfSet('bagian','FOH')")
    + '</div>';
  var perBar = '<div class="row mt" style="gap:6px;flex-wrap:wrap">'
    + chip('7 hari',   LSF.periode==='7',    "lsfSet('periode','7')")
    + chip('30 hari',  LSF.periode==='30',   "lsfSet('periode','30')")
    + chip('Bulan ini',LSF.periode==='bulan',"lsfSet('periode','bulan')")
    + chip('Semua',    LSF.periode==='semua',"lsfSet('periode','semua')")
    + '</div>';
  var stat = function(lbl,val,col){ return '<div style="flex:1;min-width:78px;background:var(--card,#fff);border:1px solid var(--line,#eee);border-radius:10px;padding:8px 10px"><div style="font-size:11px;color:var(--mut,#888)">'+lbl+'</div><div style="font-size:16px;font-weight:600'+(col?';color:'+col:'')+'">'+val+'</div></div>'; };
  var sumBar = '<div class="row mt" style="gap:6px;flex-wrap:wrap">'
    + stat('Jumlah barang', s.jumlahBarang||0)
    + stat('Stok saat ini', lsfNum(s.stokSaatIni))
    + stat('Menipis', s.menipis||0, '#c8791f')
    + stat('Habis', s.habis||0, '#b23b3b')
    + '</div>';
  var cari = '<input id="lsfCari" type="text" placeholder="cari barang / kategori…" value="'+h(LSF.cari)+'" oninput="LSF.cari=this.value; drawLaporanStokBody()" class="mt">';
  page('Laporan Stok', '<div class="card">'+bagBar+perBar+sumBar+cari+'</div><div id="lsfBody"></div>');
  drawLaporanStokBody();
}

function drawLaporanStokBody(){
  var d = LSF.data || { rows:[] };
  var rows = (d.rows||[]);
  var q = String(LSF.cari||'').toLowerCase();
  if(q) rows = rows.filter(function(r){ return String(r.barang).toLowerCase().indexOf(q)>=0 || String(r.kategori).toLowerCase().indexOf(q)>=0; });
  var el = document.getElementById('lsfBody'); if(!el) return;
  if(!rows.length){ el.innerHTML = '<div class="muted center mt">Tidak ada barang.</div>'; return; }
  var pill = function(txt,bg){ return '<span style="font-size:10px;padding:2px 7px;border-radius:999px;color:#fff;background:'+bg+'">'+h(txt)+'</span>'; };
  var mv = function(lbl,val){ return '<div style="text-align:center;flex:1"><div style="font-size:10px;color:var(--mut,#888)">'+lbl+'</div><div style="font-size:13px;font-weight:600">'+val+'</div></div>'; };
  var html = rows.map(function(r){
    var stCol = lsfStatusColor(r.status);
    var bagPill = pill(r.bagian, r.bagian==='FOH'?'#3a5c7a':'#5a3222');
    var stPill = r.status ? (' '+pill(r.status, stCol)) : '';
    var keluarTxt = lsfNum(r.keluar); if(Number(r.keluar)<0) keluarTxt = '<span style="color:#b23b3b">'+keluarTxt+'</span>';
    var subline = (r.kategori?h(r.kategori):'') + (r.kategori&&r.kadaluarsa?' · ':'') + (r.kadaluarsa?'exp '+h(r.kadaluarsa):'');
    return '<div class="rowcard">'
      + '<div class="rh"><span><b>'+h(r.barang)+'</b> '+bagPill+stPill+'</span><span style="font-weight:700">'+lsfNum(r.stokAkhir)+' '+h(r.satuan||'')+'</span></div>'
      + (subline?'<div class="muted" style="font-size:11px;margin-top:2px">'+subline+'</div>':'')
      + '<div class="row mt" style="background:var(--bg,#f7f7f7);border-radius:8px;padding:6px 4px">'
        + mv('Awal', lsfNum(r.stokAwal)) + mv('Masuk', lsfNum(r.masuk)) + mv('Keluar', keluarTxt) + mv('Penyesuaian', lsfNum(r.penyesuaian)) + mv('Akhir', lsfNum(r.stokAkhir))
      + '</div></div>';
  }).join('');
  var note = '<div class="muted mt" style="font-size:11px;line-height:1.6">'
    + '<b>Cara baca:</b> <b>Stok Akhir</b> = sisa terakhir dari Cek Stock (yang paling akurat). '
    + '<b>Keluar</b> (terpakai) = Awal + Masuk + Penyesuaian − Akhir, dihitung otomatis. '
    + '<b>Masuk</b> diambil dari Barang Masuk (terisi saat Beli Manual → Terima / order diterima). '
    + 'Kalau Keluar berwarna merah (negatif): stok awal belum tercatat di periode ini — butuh minimal 2× cek stok biar akurat.'
    + '</div>';
  el.innerHTML = html + note;
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
    // Ganti menu "Laporan Stok" lama dengan ledger baru (tanpa edit index.html)
    try{ if(typeof window.lsfRender==='function'){ window.renderLaporanStok = window.lsfRender; } }catch(e){}
    // Jadwal Shift: SEMUA staf boleh LIHAT; EDIT/simpan cuma Manager & Owner
    try{
      if(typeof window.renderJadwal==='function' && !window.renderJadwal.__gated){
        var _rj = window.renderJadwal;
        window.renderJadwal = function(){
          var r = _rj.apply(this, arguments);
          if(typeof roleAtLeast==='function' && !roleAtLeast('manager')){
            var lock = function(){
              try{
                var btns = document.querySelectorAll('button');
                for(var i=0;i<btns.length;i++){ var b=btns[i]; if(/simpan/i.test(b.textContent||'') || /simpanJadwal/i.test(b.getAttribute('onclick')||'')) b.style.display='none'; }
                var flds = document.querySelectorAll('select, input, textarea');
                for(var j=0;j<flds.length;j++){ var f=flds[j]; var ty=(f.type||'').toLowerCase(); if(ty!=='button'&&ty!=='search'&&ty!=='submit') f.disabled=true; }
                if(!document.getElementById('jdwViewNote')){
                  var host=document.querySelector('.card')||document.body;
                  var n=document.createElement('div'); n.id='jdwViewNote'; n.className='muted center mt'; n.style.fontSize='12px';
                  n.innerHTML='&#128065; Mode lihat saja. Hanya Manager &amp; Owner yang bisa mengubah jadwal.';
                  host.parentNode ? host.parentNode.insertBefore(n, host.nextSibling) : host.appendChild(n);
                }
              }catch(e){}
            };
            setTimeout(lock,150); setTimeout(lock,500); setTimeout(lock,1200);
          }
          return r;
        };
        window.renderJadwal.__gated = true;
      }
    }catch(e){}
    // Simpan jadwal: hard-block untuk selain Manager & Owner
    try{
      if(typeof window.simpanJadwal==='function' && !window.simpanJadwal.__gated){
        var _sj = window.simpanJadwal;
        window.simpanJadwal = function(){
          if(typeof roleAtLeast!=='function' || !roleAtLeast('manager')){ alert('Hanya Manager & Owner yang bisa mengubah jadwal shift.'); return; }
          return _sj.apply(this, arguments);
        };
        window.simpanJadwal.__gated = true;
      }
    }catch(e){}
    inject();
  }
  if(document.readyState==='complete') patch();
  else window.addEventListener('load', patch);
  setTimeout(patch, 800); setTimeout(patch, 2000); setTimeout(patch, 4000);
})();

/* ===== LAPORAN & MASUKAN: kritik/saran customer, komplain, masalah operasional, masalah app =====
   Backend Somtum App: masukan_add (semua staf), masukan_list (staf: miliknya; kepala+: semua),
   masukan_set (kepala+; hapus = owner). Data di tab "Laporan & Masukan". */
(function(){
  if (window.__mskLoaded) return;
  window.__mskLoaded = true;

  var JENIS = [
    { v: 'Kritik & saran customer', s: 'Kritik & saran', cust: true,
      info: 'Masukan dari customer: rasa, porsi, harga, pelayanan, ide menu.',
      ph: 'Contoh: customer bilang somtum kurang asam, minta ada pilihan level pedas' },
    { v: 'Komplain customer', s: 'Komplain', cust: true,
      info: 'Customer tidak puas, minta ganti atau refund.',
      ph: 'Contoh: pesanan GoFood telat 40 menit, ayam kurang matang' },
    { v: 'Masalah operasional', s: 'Masalah operasional', cust: false,
      info: 'Alat rusak, bahan habis, listrik / air / gas, kebersihan, kendala kerja.',
      ph: 'Contoh: kompor 2 apinya kecil, freezer bunyi, gas tinggal sedikit' },
    { v: 'Masalah app', s: 'Masalah app', cust: false,
      info: 'Error atau tidak bisa dipakai di app Somtum: absen, nota, stok, jadwal, dll.',
      ph: 'Contoh: foto nota gagal upload, tombol absen tidak muncul' }
  ];
  var OUTLETS = ['Somtum Bali', 'Little Pratunam'];
  var FILTERS = [['aktif', 'Belum selesai'], ['Baru', 'Baru'], ['Diproses', 'Diproses'], ['Selesai', 'Selesai'], ['semua', 'Semua']];
  var TILE_SB = 'Kritik customer · komplain · masalah';
  var ICON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 8h8M8 12h5"/></svg>';
  var M = window.MSK = { jenis: '', outlet: '', tanggal: '', detail: '', customer: '', tindakan: '',
                         filter: 'aktif', list: null, nonce: String(Date.now()), busy: false };
  var CNT = { t: 0, n: null };

  function jenisOf(v){ for (var i = 0; i < JENIS.length; i++) if (JENIS[i].v === v) return JENIS[i]; return null; }
  function defOutlet(){ var o = S.staff && S.staff.outlet; return OUTLETS.indexOf(o) >= 0 ? o : OUTLETS[0]; }
  function safeId(id){ return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, ''); }
  function hash(s){ var x = 5381; for (var i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); }
  function findRow(id){ var L = M.list || []; for (var i = 0; i < L.length; i++) if (safeId(L[i].id) === id) return L[i]; return null; }
  function badgeCls(s){ return s === 'Selesai' ? 'b-ok' : s === 'Diproses' ? 'b-warn' : 'b-bad'; }
  function countBaru(){ return (M.list || []).filter(function(r){ return r.status === 'Baru'; }).length; }
  function saveFields(){
    var a = $('mskTgl'), b = $('mskDetail'), c = $('mskCust'), d = $('mskTindak');
    if (a) M.tanggal = a.value;
    if (b) M.detail = b.value;
    if (c) M.customer = c.value;
    if (d) M.tindakan = d.value;
  }

  /* ---------- halaman ---------- */
  window.renderMasukan = function(){
    if (!M.outlet) M.outlet = defOutlet();
    if (!M.tanggal) M.tanggal = todayStr();
    page('Laporan & Masukan', '<div class="card" id="mskForm"></div><div id="mskList"><div class="muted center">Memuat…</div></div>');
    drawForm();
    if (M.list) drawList();
    loadList();
  };

  function drawForm(){
    var el = $('mskForm'); if (!el) return;
    var j = jenisOf(M.jenis);
    el.innerHTML = '<h3>Buat laporan</h3>'
      + '<div class="muted">Catat kritik / saran dan komplain customer, atau masalah di outlet dan app. Kepala dan owner yang menindaklanjuti.</div>'
      + '<label class="f">Jenis <span class="req">*</span></label><div class="chips">'
      + JENIS.map(function(x, i){ return '<button class="chipb' + (M.jenis === x.v ? ' on' : '') + '" onclick="mskJenis(' + i + ')">' + h(x.s) + '</button>'; }).join('')
      + '</div>'
      + (j ? '<div class="help" style="margin:8px 0 0">' + h(j.info) + '</div>' : '')
      + '<label class="f">Outlet</label><div class="chips">'
      + OUTLETS.map(function(o, i){ return '<button class="chipb' + (M.outlet === o ? ' on' : '') + '" onclick="mskOutlet(' + i + ')">' + h(o) + '</button>'; }).join('')
      + '</div>'
      + '<label class="f">Tanggal kejadian</label><input type="date" id="mskTgl" max="' + todayStr() + '" value="' + h(M.tanggal) + '">'
      + '<label class="f">Detail <span class="req">*</span></label><textarea id="mskDetail" placeholder="' + h(j ? j.ph : 'Pilih jenis dulu, lalu ceritakan apa yang terjadi') + '">' + h(M.detail) + '</textarea>'
      + (j && j.cust ? '<label class="f">Customer / meja / no. order</label><input type="text" id="mskCust" autocomplete="off" placeholder="Contoh: meja 4 / GoFood F-123 / Bu Rina" value="' + h(M.customer) + '">' : '')
      + '<label class="f">Tindakan yang sudah dilakukan</label><textarea id="mskTindak" style="min-height:60px" placeholder="Contoh: sudah minta maaf dan ganti menu baru">' + h(M.tindakan) + '</textarea>'
      + '<button class="btn primary mt" onclick="mskKirim()">Kirim laporan</button>';
    ['mskTgl', 'mskDetail', 'mskCust', 'mskTindak'].forEach(function(id){ var x = $(id); if (x) x.addEventListener('input', saveFields); });
  }

  async function loadList(){
    try {
      var list = await api('masukan_list');
      M.list = Array.isArray(list) ? list : [];
      CNT.n = countBaru(); CNT.t = Date.now();
      drawList();
    } catch (e) {
      var el = $('mskList'); if (!el) return;
      el.innerHTML = '<div class="card"><div class="muted">' + h(e.message) + '</div><button class="btn sm mt" onclick="mskReload()">Coba lagi</button></div>';
    }
  }

  function drawList(){
    var el = $('mskList'); if (!el || !M.list) return;
    var L = M.list;
    var n = { aktif: 0, Baru: 0, Diproses: 0, Selesai: 0, semua: L.length };
    L.forEach(function(r){ n[r.status] = (n[r.status] || 0) + 1; if (r.status !== 'Selesai') n.aktif++; });
    var arr = L.filter(function(r){ return M.filter === 'semua' ? true : M.filter === 'aktif' ? r.status !== 'Selesai' : r.status === M.filter; });
    el.innerHTML = '<h3 style="font-size:14px;color:var(--mut);margin:14px 0 8px">' + (roleAtLeast('kepala') ? 'Semua laporan' : 'Laporan saya') + '</h3>'
      + '<div class="chips mb">' + FILTERS.map(function(f){
          return '<button class="chipb' + (M.filter === f[0] ? ' on' : '') + '" style="padding:7px 12px;font-size:13px" onclick="mskFilter(\'' + f[0] + '\')">' + f[1] + ' (' + (n[f[0]] || 0) + ')</button>';
        }).join('') + '</div>'
      + (arr.length ? arr.map(cardHtml).join('')
                    : '<div class="muted center mt">' + (L.length ? 'Tidak ada laporan di filter ini.' : 'Belum ada laporan.') + '</div>');
  }

  function cardHtml(r){
    var id = safeId(r.id), st = r.status || 'Baru';
    var acts = '';
    if (roleAtLeast('kepala')) {
      var b = [];
      if (st === 'Baru') b.push('<button class="btn sm grow" style="margin-top:0" onclick="mskSet(\'' + id + '\',\'Diproses\')">Proses</button>');
      if (st !== 'Selesai') b.push('<button class="btn sm ok grow" style="margin-top:0" onclick="mskSelesai(\'' + id + '\')">Selesai</button>');
      else b.push('<button class="btn sm grow" style="margin-top:0" onclick="mskSet(\'' + id + '\',\'Diproses\')">Buka lagi</button>');
      if (roleAtLeast('owner')) b.push('<button class="btn sm ghost" style="margin-top:0" onclick="mskHapus(\'' + id + '\')">Hapus</button>');
      acts = '<div class="row mt">' + b.join('') + '</div>';
    }
    var meta = [r.outlet ? h(r.outlet) : '', r.tanggal ? h(tglCantik(r.tanggal)) : ''].filter(Boolean).join(' · ');
    return '<div class="card">'
      + '<div class="row" style="align-items:flex-start"><div class="grow"><b>' + h(r.jenis) + '</b><div class="muted">' + meta + '</div></div>'
      + '<span class="badge ' + badgeCls(st) + '">' + h(st) + '</span></div>'
      + '<div style="margin-top:8px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word">' + h(r.detail) + '</div>'
      + (r.customer ? '<div class="muted" style="margin-top:6px">Customer: ' + h(r.customer) + '</div>' : '')
      + (r.tindakan ? '<div class="muted" style="margin-top:4px">Tindakan awal: ' + h(r.tindakan) + '</div>' : '')
      + (r.catatan
          ? '<div style="margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--bg);font-size:13px;white-space:pre-wrap;word-break:break-word"><b>Tindak lanjut' + (r.oleh ? ' · ' + h(r.oleh) : '') + ':</b> ' + h(r.catatan) + '</div>'
          : (r.oleh && st !== 'Baru' ? '<div class="muted" style="margin-top:4px">Ditangani: ' + h(r.oleh) + '</div>' : ''))
      + '<div class="muted" style="font-size:12px;margin-top:8px">Dilaporkan ' + h(r.pelapor || '') + (r.waktu ? ' · ' + h(r.waktu) : '') + '</div>'
      + acts + '</div>';
  }

  /* ---------- aksi ---------- */
  window.mskJenis = function(i){ saveFields(); if (JENIS[i]) M.jenis = JENIS[i].v; drawForm(); };
  window.mskOutlet = function(i){ saveFields(); if (OUTLETS[i]) M.outlet = OUTLETS[i]; drawForm(); };
  window.mskFilter = function(f){ M.filter = f; drawList(); };
  window.mskReload = function(){ var el = $('mskList'); if (el) el.innerHTML = '<div class="muted center">Memuat…</div>'; loadList(); };

  window.mskKirim = async function(){
    if (M.busy) return;
    saveFields();
    var j = jenisOf(M.jenis);
    if (!j) return toast('Pilih jenis laporan dulu.');
    var detail = String(M.detail || '').trim();
    if (detail.length < 5) return toast('Isi detail laporannya (minimal 5 huruf).');
    var tgl = M.tanggal || todayStr();
    if (tgl > todayStr()) return toast('Tanggal kejadian tidak boleh melewati hari ini.');
    var p = { jenis: j.v, outlet: M.outlet || defOutlet(), tanggal: tgl, detail: detail,
              customer: j.cust ? String(M.customer || '').trim() : '', tindakan: String(M.tindakan || '').trim() };
    // kunci sama untuk isi yang sama → kirim ulang (sinyal putus) tidak bikin data dobel
    p.idempotencyKey = 'msk-' + safeId(S.staff && S.staff.id) + '-' + M.nonce + '-' + hash(JSON.stringify(p));
    M.busy = true;
    loading(true, 'Mengirim laporan…');
    try {
      await api('masukan_add', p);
      loading(false);
      M.jenis = ''; M.detail = ''; M.customer = ''; M.tindakan = ''; M.tanggal = todayStr(); M.nonce = String(Date.now());
      M.filter = 'aktif';
      toast('Laporan terkirim. Terima kasih 🙏');
      drawForm();
      loadList();
    } catch (e) { loading(false); toast(e.message, 4000); }
    finally { M.busy = false; }
  };

  async function setStatus(id, status, catatan){
    loading(true, 'Menyimpan…');
    try {
      await api('masukan_set', { id: id, status: status, catatan: catatan == null ? null : catatan });
      loading(false);
      if (status === 'Dihapus') M.list = (M.list || []).filter(function(r){ return safeId(r.id) !== id; });
      else { var r = findRow(id); if (r) { r.status = status; r.oleh = (S.staff && S.staff.panggilan) || r.oleh; if (catatan != null) r.catatan = catatan; } }
      CNT.n = countBaru();
      drawList();
      toast(status === 'Dihapus' ? 'Laporan dihapus.' : 'Status: ' + status);
      loadList();
    } catch (e) { loading(false); toast(e.message, 4000); }
  }

  window.mskSet = function(id, status){ setStatus(safeId(id), status, null); };

  window.mskSelesai = async function(id, draft){
    id = safeId(id);
    var r = findRow(id);
    var val = draft != null ? draft : ((r && r.catatan) || '');
    var det = r ? String(r.detail || '') : '';
    var p = ask('Tandai selesai',
      (r ? '<div class="muted">' + h(r.jenis) + ' · ' + h(r.outlet || '') + '</div><div style="margin:6px 0 2px;font-size:14px;white-space:pre-wrap;word-break:break-word">' + h(det.slice(0, 160)) + (det.length > 160 ? '…' : '') + '</div>' : '')
      + '<label class="f">Tindak lanjut / solusinya <span class="req">*</span></label><textarea id="mskCat" placeholder="Contoh: kompor sudah diservis / customer sudah dihubungi dan diberi voucher">' + h(val) + '</textarea>',
      [{ label: 'Batal', value: false }, { label: 'Tandai selesai', value: true, cls: 'primary' }]);
    var ta = $('mskCat');
    if (ta) ta.addEventListener('input', function(){ val = ta.value; });
    var ok = await p;
    if (!ok) return;
    val = String(val || '').trim();
    if (val.length < 3) { toast('Tulis dulu tindak lanjutnya.'); return window.mskSelesai(id, val); }
    setStatus(id, 'Selesai', val);
  };

  window.mskHapus = async function(id){
    var ok = await ask('Hapus laporan ini?', '<div class="muted">Laporan disembunyikan dari daftar, tapi tetap tersimpan di sheet.</div>',
      [{ label: 'Batal', value: false }, { label: 'Hapus', value: true, cls: 'primary' }]);
    if (ok) setStatus(safeId(id), 'Dihapus', null);
  };

  /* ---------- tile di beranda (+ jumlah laporan baru untuk kepala ke atas) ---------- */
  function setTileSb(){
    var sb = document.getElementById('mskTileSb'); if (!sb) return;
    sb.innerHTML = (roleAtLeast('kepala') && CNT.n)
      ? '<span class="badge b-bad" style="font-size:11px;padding:2px 8px">' + CNT.n + ' baru</span> perlu dicek'
      : TILE_SB;
  }
  function refreshCount(){
    if (!roleAtLeast('kepala') || Date.now() - CNT.t < 120000) return;
    CNT.t = Date.now();
    api('masukan_list').then(function(list){
      M.list = Array.isArray(list) ? list : [];
      CNT.n = countBaru();
      setTileSb();
    }).catch(function(){ CNT.t = 0; });
  }
  function inject(){
    try {
      if (!S || !S.staff) return;
      var main = document.querySelector('#app main.homemain');
      var grid = main && main.querySelector('.grid');
      if (!grid) return;
      if (!document.getElementById('mskTile')) {
        var w = document.createElement('div');
        w.innerHTML = '<div class="tile" id="mskTile" onclick="show(renderMasukan)"><div class="ic">' + ICON + '</div><div class="lb">Laporan &amp; masukan</div><div class="sb" id="mskTileSb">' + TILE_SB + '</div></div>';
        var tile = w.firstChild;
        var tiles = grid.querySelectorAll('.tile'), after = null;
        for (var i = 0; i < tiles.length; i++) if (/renderJadwal/.test(tiles[i].getAttribute('onclick') || '')) after = tiles[i];
        if (after && after.nextSibling) grid.insertBefore(tile, after.nextSibling); else grid.appendChild(tile);
      }
      setTileSb();
      refreshCount();
    } catch (e) {}
  }
  function watch(){
    try {
      var app = document.getElementById('app');
      if (app && !app.__mskObs) {
        app.__mskObs = true;
        new MutationObserver(function(){ inject(); }).observe(app, { childList: true });
      }
    } catch (e) {}
    inject();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  window.addEventListener('load', watch);
  setTimeout(watch, 1500);
})();

/* ===== WAJIB LAPORAN & MASUKAN SEBELUM CLOSING (bahan evaluasi bulanan) =====
   Buka form Closing → cek laporan hari ini untuk outlet itu (semua staf).
   Belum ada → isi dulu di menu Laporan & masukan, atau nyatakan "tidak ada" (tercatat atas nama pengisi). */
(function(){
  if (window.__mskGateLoaded) return;
  window.__mskGateLoaded = true;
  var NIHIL = 'Tidak ada laporan';
  var LOLOS = {};   // "key|tanggal" yang sudah lolos cek
  var G = null;     // closing yang sedang ditahan

  function tglBisnis(){  // lewat tengah malam (sebelum jam 5 pagi) masih dihitung hari kemarin
    var d = new Date();
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function outletForm(key){
    try {
      var f = (S.cfg.forms || []).filter(function(x){ return x.key === key; })[0];
      if (f && f.sumber) return f.sumber === 'Cashflow LP' ? 'Little Pratunam' : 'Somtum Bali';
    } catch (e) {}
    return /LP$/i.test(String(key)) ? 'Little Pratunam' : 'Somtum Bali';
  }
  function navTop(){ try { return nav[nav.length - 1]; } catch (e) { return null; } }

  function bungkus(orig){
    var g = function(key, title){
      var self = this, args = arguments;
      if (!/^closing/i.test(String(key))) return orig.apply(self, args);
      var tgl = tglBisnis(), outlet = outletForm(key), k = key + '|' + tgl;
      if (LOLOS[k]) return orig.apply(self, args);
      var top = navTop();
      page(title, '<div class="muted center mt">Cek laporan &amp; masukan hari ini…</div>');
      return api('masukan_list', { cek: 1, outlet: outlet, tanggal: tgl }).then(function(r){
        if (navTop() !== top) return;
        var valid = r && typeof r.laporan === 'number';
        if (!valid || r.laporan > 0 || r.nihil) {   // backend lama / sudah ada laporan → lanjut closing
          if (valid) { LOLOS[k] = true; G = null; if (window.MSK) window.MSK.balikKe = null; }
          return orig.apply(self, args);
        }
        G = { key: key, title: title, outlet: outlet, tgl: tgl };
        tampilGate();
      }, function(){ if (navTop() === top) return orig.apply(self, args); });   // gagal cek (sinyal) → closing tetap bisa
    };
    g.__mskGate = true;
    return g;
  }

  function tampilGate(){
    if (!G) return;
    page(G.title, '<div class="card">'
      + '<h3>Sebelum closing</h3>'
      + '<div class="muted">Isi dulu <b>laporan hari ini</b> untuk ' + h(G.outlet) + ': kritik / saran customer, komplain, atau masalah. Wajib setiap hari, untuk evaluasi bulanan.</div>'
      + '<button class="btn primary mt" onclick="mskGateIsi()">Isi laporan &amp; masukan</button>'
      + '<button class="btn" onclick="mskGateNihil()">Tidak ada kritik / komplain / masalah hari ini</button>'
      + '</div>');
  }

  window.mskGateIsi = function(){
    if (!G) return;
    var M = window.MSK;
    if (M) { M.outlet = G.outlet; M.tanggal = G.tgl; M.balikKe = G; }
    show(window.renderMasukan);
  };

  window.mskGateNihil = async function(){
    if (!G) return;
    var g = G;
    var ok = await ask('Tidak ada laporan hari ini?',
      '<div class="muted">Kamu menyatakan hari ini di <b>' + h(g.outlet) + '</b> tidak ada kritik, saran, komplain, atau masalah. Tercatat atas namamu.</div>',
      [{ label: 'Batal', value: false }, { label: 'Ya, tidak ada', value: true, cls: 'primary' }]);
    if (!ok) return;
    loading(true, 'Mencatat…');
    try {
      await api('masukan_add', { jenis: NIHIL, outlet: g.outlet, tanggal: g.tgl, detail: '-', idempotencyKey: 'nihil-' + g.outlet + '-' + g.tgl });
      loading(false);
      LOLOS[g.key + '|' + g.tgl] = true;
      G = null;
      if (window.MSK) window.MSK.balikKe = null;
      window.renderForm(g.key, g.title);
    } catch (e) { loading(false); toast(e.message, 4000); }
  };

  window.mskLanjutClosing = function(){ back(); };

  function bannerBalik(){
    try {
      var M = window.MSK;
      if (!M || !M.balikKe || document.getElementById('mskBalik')) return;
      var main = document.querySelector('#app main');
      if (!main) return;
      var d = document.createElement('div');
      d.id = 'mskBalik'; d.className = 'banner';
      d.innerHTML = 'Untuk closing ' + h(M.balikKe.outlet) + '. Kalau laporan hari ini sudah terkirim, tekan:'
        + '<button class="btn primary" style="margin-top:8px" onclick="mskLanjutClosing()">Lanjut ke Closing ›</button>';
      main.insertBefore(d, main.firstChild);
    } catch (e) {}
  }

  function patch(){
    try { if (typeof window.renderForm === 'function' && !window.renderForm.__mskGate) window.renderForm = bungkus(window.renderForm); } catch (e) {}
    try {
      if (typeof window.renderMasukan === 'function' && !window.renderMasukan.__mskGate) {
        var _rm = window.renderMasukan;
        var rm = function(){ var r = _rm.apply(this, arguments); bannerBalik(); return r; };
        rm.__mskGate = true;
        window.renderMasukan = rm;
      }
    } catch (e) {}
    try {
      var app = document.getElementById('app');
      if (app && !app.__mskGateObs) {
        app.__mskGateObs = true;
        new MutationObserver(function(){
          if (document.querySelector('#app main.homemain')) { G = null; if (window.MSK) window.MSK.balikKe = null; }
        }).observe(app, { childList: true });
      }
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch); else patch();
  window.addEventListener('load', patch);
  setTimeout(patch, 800); setTimeout(patch, 2000); setTimeout(patch, 4000);
})();
