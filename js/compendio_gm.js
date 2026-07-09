// ══════════════════════════════════════
// LOAD EXTERNAL JSON DATA
// ══════════════════════════════════════



document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-'+tab.dataset.tab).classList.add('active');
  });
});

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtAbility(ab) {
  const parts = (ab||'').split('/');
  const names = ['STR','DEX','CON','INT','WIS','CHA'];
  return names.map((n,i) => {
    const v = parseInt(parts[i]);
    const m = isNaN(v) ? '-' : Math.floor((v-10)/2);
    const mstr = isNaN(v) ? '' : (m>=0?'+'+m:m);
    return `<div class="ability-box"><div class="ability-val">${isNaN(v)?'-':v}</div><div style="font-size:10px;color:var(--cream-dim)">${mstr}</div><div class="ability-name">${n}</div></div>`;
  }).join('');
}

// ---------- MONSTERS ----------
const crSet = new Set(), typeSet = new Set();
DATA.monsters.forEach(m => { if(m.cr) crSet.add(m.cr); if(m.ty) typeSet.add(m.ty.split(',')[0].split('(')[0].trim()); });
const crOrder = ['0','1/8','1/4','1/2','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30'];
[...crSet].sort((a,b)=>crOrder.indexOf(a)-crOrder.indexOf(b)).forEach(cr => {
  const o = document.createElement('option'); o.value=cr; o.textContent='CR '+cr;
  document.getElementById('filter-cr').appendChild(o);
});
[...typeSet].sort().forEach(t => {
  const o = document.createElement('option'); o.value=t; o.textContent=t.charAt(0).toUpperCase()+t.slice(1);
  document.getElementById('filter-type').appendChild(o);
});

function renderMonsters() {
  const q = document.getElementById('search-monsters').value.toLowerCase();
  const crf = document.getElementById('filter-cr').value;
  const tyf = document.getElementById('filter-type').value;
  let results = DATA.monsters.filter(m => {
    if(q && !m.n.toLowerCase().includes(q)) return false;
    if(crf && m.cr !== crf) return false;
    if(tyf && !(m.ty||'').toLowerCase().includes(tyf.toLowerCase())) return false;
    return true;
  });
  document.getElementById('count-monsters').textContent = results.length + ' resultados';
  if(!results.length) { document.getElementById('list-monsters').innerHTML = '<div class="empty-state">Ningun monstruo encontrado.</div>'; return; }
  results = results.slice(0,150);
  document.getElementById('list-monsters').innerHTML = results.map((m,i) => `
    <div class="card" onclick="this.classList.toggle('open')">
      <div class="card-name">${esc(m.n)}</div>
      <div class="card-meta">${esc(m.sz||'')} ${esc(m.ty||'')} &middot; CR ${esc(m.cr||'?')} &middot; AC ${esc(m.ac||'?')} &middot; HP ${esc(m.hp||'?')}</div>
      <div class="card-body">
        <div class="stat-line"><span class="stat-label">ALINEAMIENTO</span> ${esc(m.al||'-')}</div>
        <div class="stat-line"><span class="stat-label">VELOCIDAD</span> ${esc(m.sp||'-')}</div>
        <div class="ability-grid">${fmtAbility(m.ab)}</div>
        ${m.sv?`<div class="stat-line"><span class="stat-label">SALVACIONES</span> ${esc(m.sv)}</div>`:''}
        ${m.sk?`<div class="stat-line"><span class="stat-label">HABILIDADES</span> ${esc(m.sk)}</div>`:''}
        ${m.res?`<div class="stat-line"><span class="stat-label">RESISTENCIAS</span> ${esc(m.res)}</div>`:''}
        ${m.vul?`<div class="stat-line"><span class="stat-label">VULNERABILIDADES</span> ${esc(m.vul)}</div>`:''}
        ${m.imm?`<div class="stat-line"><span class="stat-label">INMUNIDADES</span> ${esc(m.imm)}</div>`:''}
        ${m.ci?`<div class="stat-line"><span class="stat-label">INMUNE A CONDICIONES</span> ${esc(m.ci)}</div>`:''}
        ${m.se?`<div class="stat-line"><span class="stat-label">SENTIDOS</span> ${esc(m.se)}</div>`:''}
        ${m.la?`<div class="stat-line"><span class="stat-label">IDIOMAS</span> ${esc(m.la)}</div>`:''}
        ${(m.tr||[]).length?'<div class="divider"></div>'+m.tr.map(t=>`<div class="trait-block"><div class="trait-name">${esc(t[0])}</div><div class="trait-text">${esc(t[1])}</div></div>`).join(''):''}
        ${(m.ac2||[]).length?'<div class="divider"></div><div class="trait-name" style="color:var(--gold)">ACCIONES</div>'+m.ac2.map(t=>`<div class="trait-block"><div class="trait-name">${esc(t[0])}</div><div class="trait-text">${esc(t[1])}</div></div>`).join(''):''}
        ${(m.lg||[]).length?'<div class="divider"></div><div class="trait-name" style="color:var(--gold)">ACCIONES LEGENDARIAS</div>'+m.lg.map(t=>`<div class="trait-block"><div class="trait-name">${esc(t[0])}</div><div class="trait-text">${esc(t[1])}</div></div>`).join(''):''}
      </div>
    </div>`).join('') + (results.length===150?'<div class="empty-state">Mostrando los primeros 150. Refina tu busqueda para ver mas.</div>':'');
}
['search-monsters','filter-cr','filter-type'].forEach(id => document.getElementById(id).addEventListener('input', renderMonsters));
renderMonsters();

// ---------- SPELLS ----------
const lvlSet = new Set(), schSet = new Set();
const schoolNames = {A:'Abjuracion',C:'Conjuracion',D:'Adivinacion',E:'Encantamiento',V:'Evocacion',I:'Ilusion',N:'Nigromancia',T:'Transmutacion'};
DATA.spells.forEach(s => { if(s.lv!==undefined) lvlSet.add(s.lv); if(s.sc) schSet.add(s.sc); });
[...lvlSet].sort((a,b)=>(+a)-(+b)).forEach(lv => {
  const o = document.createElement('option'); o.value=lv; o.textContent = lv==='0'?'Truco':'Nivel '+lv;
  document.getElementById('filter-level').appendChild(o);
});
[...schSet].sort().forEach(sc => {
  const o = document.createElement('option'); o.value=sc; o.textContent = schoolNames[sc]||sc;
  document.getElementById('filter-school').appendChild(o);
});

function renderSpells() {
  const q = document.getElementById('search-spells').value.toLowerCase();
  const lvf = document.getElementById('filter-level').value;
  const scf = document.getElementById('filter-school').value;
  let results = DATA.spells.filter(s => {
    if(q && !s.n.toLowerCase().includes(q)) return false;
    if(lvf!=='' && s.lv !== lvf) return false;
    if(scf && s.sc !== scf) return false;
    return true;
  });
  document.getElementById('count-spells').textContent = results.length + ' resultados';
  if(!results.length) { document.getElementById('list-spells').innerHTML = '<div class="empty-state">Ningun hechizo encontrado.</div>'; return; }
  results = results.slice(0,150);
  document.getElementById('list-spells').innerHTML = results.map(s => `
    <div class="card" onclick="this.classList.toggle('open')">
      <div class="card-name">${esc(s.n)}</div>
      <div class="card-meta">${s.lv==='0'?'Truco':'Nivel '+esc(s.lv)} &middot; ${esc(schoolNames[s.sc]||s.sc||'')} ${s.ri?'&middot; <span class="badge">Ritual</span>':''}</div>
      <div class="card-body">
        <div class="stat-line"><span class="stat-label">TIEMPO DE LANZAMIENTO</span> ${esc(s.ti||'-')}</div>
        <div class="stat-line"><span class="stat-label">ALCANCE</span> ${esc(s.ra||'-')}</div>
        <div class="stat-line"><span class="stat-label">COMPONENTES</span> ${esc(s.co||'-')}</div>
        <div class="stat-line"><span class="stat-label">DURACION</span> ${esc(s.du||'-')}</div>
        <div class="stat-line"><span class="stat-label">CLASES</span> ${esc(s.cl||'-')}</div>
        <div class="divider"></div>
        <div class="trait-text">${esc(s.tx||'')}</div>
      </div>
    </div>`).join('') + (results.length===150?'<div class="empty-state">Mostrando los primeros 150. Refina tu busqueda para ver mas.</div>':'');
}
['search-spells','filter-level','filter-school'].forEach(id => document.getElementById(id).addEventListener('input', renderSpells));
renderSpells();

// ---------- ITEMS ----------
const rarSet = new Set();
DATA.items.forEach(i => { if(i.rr) rarSet.add(i.rr); });
[...rarSet].sort().forEach(r => {
  const o = document.createElement('option'); o.value=r; o.textContent=r;
  document.getElementById('filter-rarity').appendChild(o);
});

function renderItems() {
  const q = document.getElementById('search-items').value.toLowerCase();
  const rf = document.getElementById('filter-rarity').value;
  const mf = document.getElementById('filter-magic').value;
  let results = DATA.items.filter(i => {
    if(q && !i.n.toLowerCase().includes(q)) return false;
    if(rf && i.rr !== rf) return false;
    if(mf && i.mg !== mf) return false;
    return true;
  });
  document.getElementById('count-items').textContent = results.length + ' resultados';
  if(!results.length) { document.getElementById('list-items').innerHTML = '<div class="empty-state">Ningun objeto encontrado.</div>'; return; }
  results = results.slice(0,150);
  document.getElementById('list-items').innerHTML = results.map(i => `
    <div class="card" onclick="this.classList.toggle('open')">
      <div class="card-name">${esc(i.n)} ${i.mg==='YES'?'<span class="badge">Magico</span>':''}</div>
      <div class="card-meta">${esc(i.ty||'')} ${i.rr?'&middot; '+esc(i.rr):''} ${i.vl?'&middot; '+esc(i.vl)+' po':''}</div>
      <div class="card-body">
        ${i.wt?`<div class="stat-line"><span class="stat-label">PESO</span> ${esc(i.wt)} lb</div>`:''}
        ${i.ac?`<div class="stat-line"><span class="stat-label">CA</span> ${esc(i.ac)}</div>`:''}
        ${i.d1?`<div class="stat-line"><span class="stat-label">DANO</span> ${esc(i.d1)} ${esc(i.dt||'')}</div>`:''}
        ${i.d2?`<div class="stat-line"><span class="stat-label">DANO (2 MANOS)</span> ${esc(i.d2)}</div>`:''}
        ${i.pr?`<div class="stat-line"><span class="stat-label">PROPIEDADES</span> ${esc(i.pr)}</div>`:''}
        ${i.ra?`<div class="stat-line"><span class="stat-label">ALCANCE</span> ${esc(i.ra)}</div>`:''}
        ${i.tx?'<div class="divider"></div><div class="trait-text">'+esc(i.tx)+'</div>':''}
      </div>
    </div>`).join('') + (results.length===150?'<div class="empty-state">Mostrando los primeros 150. Refina tu busqueda para ver mas.</div>':'');
}
['search-items','filter-rarity','filter-magic'].forEach(id => document.getElementById(id).addEventListener('input', renderItems));
renderItems();

// ---------- RACES ----------
function renderRaces() {
  const q = document.getElementById('search-races').value.toLowerCase();
  let results = DATA.races.filter(r => !q || r.n.toLowerCase().includes(q));
  document.getElementById('count-races').textContent = results.length + ' resultados';
  if(!results.length) { document.getElementById('list-races').innerHTML = '<div class="empty-state">Ninguna raza encontrada.</div>'; return; }
  document.getElementById('list-races').innerHTML = results.map(r => `
    <div class="card" onclick="this.classList.toggle('open')">
      <div class="card-name">${esc(r.n)}</div>
      <div class="card-meta">${esc(r.ab||'')} &middot; Tamano ${esc(r.sz||'')} &middot; Velocidad ${esc(r.sp||'')} ft</div>
      <div class="card-body">
        ${(r.tr||[]).map(t=>`<div class="trait-block"><div class="trait-name">${esc(t[0])}</div><div class="trait-text">${esc(t[1])}</div></div>`).join('')}
      </div>
    </div>`).join('');
}
document.getElementById('search-races').addEventListener('input', renderRaces);
renderRaces();

// ---------- CLASSES ----------
function renderClasses() {
  const q = document.getElementById('search-classes').value.toLowerCase();
  let results = DATA.classes.filter(c => !q || c.n.toLowerCase().includes(q));
  document.getElementById('count-classes').textContent = results.length + ' resultados';
  if(!results.length) { document.getElementById('list-classes').innerHTML = '<div class="empty-state">Ninguna clase encontrada.</div>'; return; }
  document.getElementById('list-classes').innerHTML = results.map(c => `
    <div class="card" onclick="this.classList.toggle('open')">
      <div class="card-name">${esc(c.n)}</div>
      <div class="card-meta">Dado de golpe ${esc(c.hd||'')} ${c.sa?'&middot; Conjuro: '+esc(c.sa):''}</div>
      <div class="card-body">
        ${c.pf?`<div class="stat-line"><span class="stat-label">COMPETENCIAS</span> ${esc(c.pf)}</div><div class="divider"></div>`:''}
        ${(c.lv||[]).map(lv => `<div class="trait-block"><div class="trait-name">Nivel ${esc(lv[0])}</div>` + lv[1].map(f=>`<div class="trait-text" style="margin-bottom:6px"><b style="color:var(--cream)">${esc(f[0])}:</b> ${esc(f[1]).slice(0,300)}${esc(f[1]).length>300?'...':''}</div>`).join('') + `</div>`).join('')}
      </div>
    </div>`).join('');
}
document.getElementById('search-classes').addEventListener('input', renderClasses);
renderClasses();

// ---------- BACKGROUNDS ----------
function renderBackgrounds() {
  const q = document.getElementById('search-backgrounds').value.toLowerCase();
  let results = DATA.backgrounds.filter(b => !q || b.n.toLowerCase().includes(q));
  document.getElementById('count-backgrounds').textContent = results.length + ' resultados';
  if(!results.length) { document.getElementById('list-backgrounds').innerHTML = '<div class="empty-state">Ningun trasfondo encontrado.</div>'; return; }
  document.getElementById('list-backgrounds').innerHTML = results.map(b => `
    <div class="card" onclick="this.classList.toggle('open')">
      <div class="card-name">${esc(b.n)}</div>
      <div class="card-meta">${esc(b.pf||'')}</div>
      <div class="card-body">
        ${(b.tr||[]).map(t=>`<div class="trait-block"><div class="trait-name">${esc(t[0])}</div><div class="trait-text">${esc(t[1])}</div></div>`).join('')}
      </div>
    </div>`).join('');
}
document.getElementById('search-backgrounds').addEventListener('input', renderBackgrounds);
renderBackgrounds();

// ---------- FEATS ----------
function renderFeats() {
  const q = document.getElementById('search-feats').value.toLowerCase();
  let results = DATA.feats.filter(f => !q || f.n.toLowerCase().includes(q));
  document.getElementById('count-feats').textContent = results.length + ' resultados';
  if(!results.length) { document.getElementById('list-feats').innerHTML = '<div class="empty-state">Ninguna dote encontrada.</div>'; return; }
  document.getElementById('list-feats').innerHTML = results.map(f => `
    <div class="card" onclick="this.classList.toggle('open')">
      <div class="card-name">${esc(f.n)}</div>
      <div class="card-meta">${f.pr?'Prerrequisito: '+esc(f.pr):'Sin prerrequisitos'}</div>
      <div class="card-body"><div class="trait-text">${esc(f.tx||'')}</div></div>
    </div>`).join('');
}
document.getElementById('search-feats').addEventListener('input', renderFeats);
renderFeats();
