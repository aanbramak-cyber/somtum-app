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
