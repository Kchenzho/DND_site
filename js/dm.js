const SUPABASE_URL = 'https://dgbgdymdtdhajztqdedb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnYmdkeW1kdGRoYWp6dHFkZWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODQwODksImV4cCI6MjA5ODM2MDA4OX0.iHsEAVVlxD5DxuHgHKHBPJKuPy73k98c8UkHF8hodZg';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let campaignId = null, campaignCode = null, dmPin = null;
let pcs = [], combatants = [], shopItems = [], loreItems = [], locations = [];
let localState = { notas: [], npcs: [] };
let combatRound = 1, combatTurn = 0;
let editingStatsPC = null; // id del PC cuyas estadísticas se están editando actualmente

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for(let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}

function setSyncDot(live) {
  document.getElementById('sync-dot').classList.toggle('live', live);
}

// ---------- AUTH / CAMPAIGN ----------
async function createCampaign() {
  const code = genCode();
  const pin = prompt('Crea un PIN de DM (lo usarás para volver a entrar):');
  if(!pin) return;
  const { data, error } = await sb.from('campaigns').insert({ code, dm_pin: pin }).select().single();
  if(error) { document.getElementById('lock-error').textContent = 'Error: ' + error.message; return; }
  campaignId = data.id; campaignCode = code; dmPin = pin;
  localStorage.setItem('dm_campaign', JSON.stringify({ id: campaignId, code, pin }));
  startApp();
}

async function enterCampaign() {
  const code = document.getElementById('lock-code').value.trim().toUpperCase();
  const pin = document.getElementById('lock-pin').value.trim();
  if(!code || !pin) { document.getElementById('lock-error').textContent = 'Ingresa código y PIN.'; return; }
  const { data, error } = await sb.from('campaigns').select('*').eq('code', code).single();
  if(error || !data) { document.getElementById('lock-error').textContent = 'Campaña no encontrada.'; return; }
  if(data.dm_pin !== pin) { document.getElementById('lock-error').textContent = 'PIN incorrecto.'; return; }
  campaignId = data.id; campaignCode = code; dmPin = pin;
  localStorage.setItem('dm_campaign', JSON.stringify({ id: campaignId, code, pin }));
  startApp();
}


// ══════════════════════════════════════
// DM AUTH — Supabase Auth
// ══════════════════════════════════════
let _dmAuthUser = null;

async function dmAuthLogin() {
  const email = document.getElementById('dm-email').value.trim();
  const pass  = document.getElementById('dm-pass').value;
  const errEl = document.getElementById('dm-lock-error');
  if(!email||!pass) { errEl.textContent='Ingresa correo y contraseña.'; return; }
  errEl.textContent = '';
  const {data, error} = await sb.auth.signInWithPassword({email, password:pass});
  if(error) { errEl.textContent = error.message; return; }
  _dmAuthUser = data.user;
  await dmShowCampaignPicker();
}

async function dmAuthLogout() {
  await sb.auth.signOut();
  _dmAuthUser = null;
  localStorage.removeItem('dm_session');
  document.getElementById('dm-auth-state').style.display = 'block';
  document.getElementById('dm-campaign-state').style.display = 'none';
}

async function dmShowCampaignPicker() {
  if(!_dmAuthUser) return;
  document.getElementById('dm-auth-state').style.display = 'none';
  document.getElementById('dm-campaign-state').style.display = 'block';
  const name = _dmAuthUser.user_metadata?.display_name || _dmAuthUser.email?.split('@')[0] || 'DM';
  document.getElementById('dm-user-name').textContent = name;

  const {data:camps} = await sb.from('campaigns').select('*')
    .eq('owner_id', _dmAuthUser.id).order('last_played', {ascending:false});

  const el = document.getElementById('dm-camp-list');
  if(!camps||!camps.length) {
    el.innerHTML = '<div style="text-align:center;padding:14px;color:var(--cream-muted);font-size:13px;font-style:italic">Sin campañas. Crea la primera arriba.</div>';
    return;
  }
  el.innerHTML = camps.map(c => {
    const date = c.last_played
      ? new Date(c.last_played).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
      : '';
    const cid = c.id, ccode = c.code, cname = c.name||c.code;
    return '<div onclick="dmEnterCampaign(\'' + cid + '\',\'' + ccode + '\')" '
      + 'style="background:var(--parchment-3);border:1px solid var(--leather);border-radius:3px;'
      + 'padding:11px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:border-color .15s" '
      + 'onmouseover="this.style.borderColor=\'var(--gold-dim)\'" '
      + 'onmouseout="this.style.borderColor=\'var(--leather)\'">'
      + '<div style="flex:1">'
      + '<div style="font-family:Cinzel,serif;font-size:13px;color:var(--cream)">' + cname + '</div>'
      + '<div style="font-family:Cinzel,serif;font-size:9px;color:var(--gold-dim);letter-spacing:1px;margin-top:3px">'
      + ccode + (date ? ' &middot; ' + date : '') + '</div>'
      + '</div>'
      + '<span style="color:var(--gold-dim);font-size:14px">→</span>'
      + '</div>';
  }).join('');
}

async function dmEnterCampaign(campId, campCode) {
  campaignId = campId; campaignCode = campCode;
  localStorage.setItem('dm_session', JSON.stringify({campaignId, campaignCode}));
  await sb.from('campaigns').update({last_played: new Date().toISOString()}).eq('id', campId);
  await startApp();
}

async function dmCreateCampaignFromLock() {
  const name = prompt('Nombre de la campaña:', 'Nueva Campaña');
  if(!name) return;
  const code = Math.random().toString(36).slice(2,8).toUpperCase();
  const {data, error} = await sb.from('campaigns').insert({
    code, owner_id: _dmAuthUser.id, name,
    dm_pin: Math.floor(1000+Math.random()*9000).toString(),
    created_at: new Date().toISOString(),
    last_played: new Date().toISOString()
  }).select().single();
  if(error) { document.getElementById('dm-lock-error-2').textContent='Error: '+error.message; return; }
  await sb.from('campaign_members').insert({campaign_id:data.id, user_id:_dmAuthUser.id, role:'dm'});
  await dmEnterCampaign(data.id, data.code);
}


// ══════════════════════════════════════
// LOAD EXTERNAL JSON DATA (via data_adapter.js)
// ══════════════════════════════════════
async function loadGameData() {
  if(MONSTERS && COMP_DATA) return;
  try {
    const data = await loadAndAdaptData(['monsters','spells','items','feats']);
    MONSTERS  = data.monsters;
    COMP_DATA = { spells: data.spells, items: data.items, feats: data.feats };
    console.log('[Data] Loaded:', MONSTERS.length, 'monsters,',
      COMP_DATA.spells.length, 'spells,', COMP_DATA.items.length, 'items');
  } catch(e) {
    console.error('[Data] Failed to load game data:', e);
    if(typeof showToast === 'function') showToast('Error cargando datos del compendio');
  }
}

async function tryAutoLogin() {
  // Priority 1: session passed from login.html dashboard
  const fromDash = sessionStorage.getItem('dm_campaign');
  if(fromDash) {
    try {
      const d = JSON.parse(fromDash);
      sessionStorage.removeItem('dm_campaign');
      campaignId = d.campaignId; campaignCode = d.code;
      localStorage.setItem('dm_session', JSON.stringify({campaignId, campaignCode}));
      await startApp(); return true;
    } catch(e) { console.warn('Dashboard session error:', e); }
  }
  // Priority 2: saved campaign in localStorage
  const saved = localStorage.getItem('dm_session');
  if(saved) {
    try {
      const d = JSON.parse(saved);
      if(d.campaignId) {
        campaignId = d.campaignId; campaignCode = d.campaignCode;
        await startApp(); return true;
      }
    } catch(e) { localStorage.removeItem('dm_session'); }
  }
  // Priority 3: Supabase Auth session exists — show campaign picker
  const {data:{session}} = await sb.auth.getSession();
  if(session?.user) {
    _dmAuthUser = session.user;
    await dmShowCampaignPicker();
    return false;
  }
  // No session at all — show login form
  document.getElementById('dm-auth-state').style.display = 'block';
  document.getElementById('dm-campaign-state').style.display = 'none';
  return false;
}

async function startApp() {
  await loadGameData();
  document.getElementById('lock-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('campaign-code-display').textContent = '· ' + campaignCode;
  document.getElementById('invite-code').textContent = campaignCode;
  loadLocalState();
  await loadAll();
  subscribeRealtime();
  subscribeDiceRolls();
  loadDiceRolls();
}

// ---------- LOCAL-ONLY STATE (notes/npcs/maps stay on DM's device) ----------
function loadLocalState() {
  try {
    const raw = localStorage.getItem('dm_local_' + campaignId);
    if(raw) localState = JSON.parse(raw);
  } catch(e) {}
  renderNotas(); renderNPCs();
}
function saveLocalState() {
  localStorage.setItem('dm_local_' + campaignId, JSON.stringify(localState));
}

function addNota() {
  const text = document.getElementById('nota-input').value.trim();
  if(!text) return;
  const tag = document.getElementById('nota-tag').value;
  const now = new Date();
  const ts = now.toLocaleDateString('es-ES',{day:'2-digit',month:'short'})+' '+now.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
  localState.notas.push({text,tag,ts});
  document.getElementById('nota-input').value = '';
  saveLocalState(); renderNotas();
}
function deleteNota(i) { localState.notas.splice(i,1); saveLocalState(); renderNotas(); }
function clearNotas() { if(confirm('¿Borrar todas las notas?')) { localState.notas=[]; saveLocalState(); renderNotas(); } }
document.getElementById('nota-input').addEventListener('keydown', e => { if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); addNota(); } });

function renderNotas() {
  const el = document.getElementById('notas-list');
  if(!localState.notas.length) { el.innerHTML = '<div class="empty-state">No hay notas aún.</div>'; return; }
  const tagColors = {general:'gray',secreto:'red',importante:'gold',recordatorio:'blue',plot:'green'};
  el.innerHTML = [...localState.notas].reverse().map((n,i) => {
    const ri = localState.notas.length-1-i;
    return `<div class="card">
      <div class="card-header">
        <div style="display:flex;gap:6px;align-items:center"><span class="badge badge-${tagColors[n.tag]||'gray'}">${n.tag.toUpperCase()}</span><span class="card-detail">${n.ts}</span></div>
        <button class="btn small danger" onclick="deleteNota(${ri})">?</button>
      </div>
      <div style="margin-top:6px;white-space:pre-wrap">${n.text}</div>
    </div>`;
  }).join('');
}

function addNPC() {
  const n = { nombre: document.getElementById('npc-nombre').value.trim(), rol: document.getElementById('npc-rol').value.trim(),
    lugar: document.getElementById('npc-lugar').value.trim(), actitud: document.getElementById('npc-actitud').value,
    desc: document.getElementById('npc-desc').value.trim() };
  if(!n.nombre) return;
  localState.npcs.push(n);
  ['nombre','rol','lugar','desc'].forEach(f=>{const el=document.getElementById('npc-'+f); if(el) el.value='';});
  toggleForm('npc-form'); saveLocalState(); renderNPCs();
}
function deleteNPC(i) { localState.npcs.splice(i,1); saveLocalState(); renderNPCs(); }
function renderNPCs() {
  const el = document.getElementById('npcs-list');
  const q = document.getElementById('npc-search').value.toLowerCase();
  const filtered = localState.npcs.filter(n => !q || n.nombre.toLowerCase().includes(q));
  if(!filtered.length) { el.innerHTML = '<div class="empty-state">No hay NPCs.</div>'; return; }
  const attColors = {aliado:'green',amistoso:'blue',neutral:'gray',hostil:'red',enemigo:'red',misterioso:'gold'};
  el.innerHTML = filtered.map((n) => {
    const ri = localState.npcs.indexOf(n);
    return `<div class="card">
      <div class="card-header">
        <div><div class="card-name">${n.nombre}</div><div class="card-detail">${n.rol||''} ${n.lugar?'· '+n.lugar:''}</div>
        ${n.desc?`<div class="card-detail" style="margin-top:4px;font-style:italic">${n.desc}</div>`:''}</div>
        <div class="actions"><span class="badge badge-${attColors[n.actitud]||'gray'}">${n.actitud.toUpperCase()}</span><button class="btn small danger" onclick="deleteNPC(${ri})">?</button></div>
      </div>
    </div>`;
  }).join('');
}

const MAPA_TIPO_LABELS = { ciudad:'Ciudad/Pueblo', mazmorra:'Mazmorra', bosque:'Bosque', castillo:'Castillo', region:'Región', tienda:'Tienda/Comercio', otro:'Otro' };

function onMapaTipoChange() {
  const wrap = document.getElementById('mapa-abierta-wrap');
  wrap.style.display = document.getElementById('mapa-tipo').value === 'tienda' ? 'block' : 'none';
}

async function addMapa() {
  const m = {
    campaign_id: campaignId,
    nombre: document.getElementById('mapa-nombre').value.trim(),
    tipo: document.getElementById('mapa-tipo').value,
    desc: document.getElementById('mapa-desc').value.trim(),
    url: document.getElementById('mapa-url').value.trim(),
    abierta: document.getElementById('mapa-abierta').checked
  };
  if(!m.nombre) return;
  const { error } = await sb.from('locations').insert(m);
  if(error) {
    alert('Error al guardar el lugar: ' + error.message + '\n\nSi el mensaje menciona "locations" o "abierta", falta crear/actualizar esa tabla en Supabase.');
    console.error(error);
    return;
  }
  ['nombre','desc','url'].forEach(f=>{const el=document.getElementById('mapa-'+f); if(el) el.value='';});
  document.getElementById('mapa-abierta').checked = true;
  onMapaTipoChange();
  toggleForm('mapa-form'); showToast('Lugar añadido ?'); await loadAll();
}
async function deleteMapa(id) {
  if(!confirm('¿Borrar este lugar? Los artículos de tienda que lo referencian quedarán sin tienda asignada.')) return;
  await sb.from('locations').delete().eq('id', id);
  await loadAll();
}
async function toggleMapaAbierta(id, val) {
  await sb.from('locations').update({ abierta: val }).eq('id', id);
  await loadAll();
}
function renderMapas() {
  const el = document.getElementById('mapas-list');
  if(!locations.length) { el.innerHTML = '<div class="empty-state">No hay mapas.</div>'; return; }
  el.innerHTML = locations.map((m) => {
    const isShop = m.tipo === 'tienda';
    return `<div class="card">
      <div class="card-header">
        <div><div class="card-name">${m.nombre}</div><div class="card-detail">${MAPA_TIPO_LABELS[m.tipo]||m.tipo}${isShop?` · <span class="badge ${m.abierta?'badge-green':'badge-red'}">${m.abierta?'ABIERTA':'CERRADA'}</span>`:''}</div></div>
        <div class="actions">
          ${isShop?`<label class="toggle-row"><input type="checkbox" ${m.abierta?'checked':''} onchange="toggleMapaAbierta('${m.id}',this.checked)"> Abierta</label>`:''}
          ${m.url?`<a href="${m.url}" target="_blank" style="color:var(--gold);font-size:12px">?</a>`:''}
          <button class="btn small danger" onclick="deleteMapa('${m.id}')">?</button>
        </div>
      </div>
      ${m.desc?`<div class="card-detail" style="margin-top:6px">${m.desc}</div>`:''}
    </div>`;
  }).join('');
}

// ---------- SUPABASE-SYNCED DATA ----------
async function loadAll() {
  setSyncDot(false);
  // Show loading state in all list containers
  ['pcs-list','combat-list','shop-list','lore-list','mapas-list'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="empty-state" style="opacity:0.5">Cargando...</div>';
  });
  const [pcRes, combRes, shopRes, loreRes, stateRes, locRes] = await Promise.all([
    sb.from('characters').select('*').eq('campaign_id', campaignId).order('updated_at'),
    sb.from('combatants').select('*').eq('campaign_id', campaignId).order('created_at'),
    sb.from('shop_items').select('*').eq('campaign_id', campaignId).order('created_at'),
    sb.from('lore').select('*').eq('campaign_id', campaignId).order('created_at'),
    sb.from('combat_state').select('*').eq('campaign_id', campaignId).maybeSingle(),
    sb.from('locations').select('*').eq('campaign_id', campaignId).order('created_at')
  ]);
  if(pcRes.error) console.error('characters error:', pcRes.error);
  if(combRes.error) console.error('combatants error:', combRes.error);
  if(shopRes.error) console.error('shop_items error:', shopRes.error);
  if(loreRes.error) console.error('lore error:', loreRes.error);
  if(locRes.error) console.error('locations error:', locRes.error);
  console.log('Loaded PCs:', pcRes.data?.length, 'campaign_id:', campaignId);
  pcs = pcRes.data || [];
  pcs.forEach(pc => { pc.equipo = normalizeEquipo(pc.equipo); pc.dinero = pc.dinero || 0; });
  combatants = combRes.data || [];
  shopItems = shopRes.data || [];
  loreItems = loreRes.data || [];
  locations = locRes.data || [];
  if(stateRes.data) {
    combatRound = stateRes.data.round;
    combatTurn = stateRes.data.turn;
  } else {
    await sb.from('combat_state').insert({ campaign_id: campaignId, round: 1, turn: 0 });
    combatRound = 1; combatTurn = 0;
  }
  renderPCs(); renderCombat(); renderShop(); renderLore(); renderMapas(); populateShopLocationSelect();
  setSyncDot(true);
  if(typeof refreshCompPCSelects==="function") refreshCompPCSelects();
  if(typeof refreshDMPCSelect==="function") refreshDMPCSelect();
  if(vttLoaded) { vttSyncHPFromCombat().then(()=>{ if(document.getElementById("tab-vtt").classList.contains("active")) vttRender(); vttRenderTokenList(); }); }
}

function subscribeRealtime() {
  sb.channel('dm-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'characters', filter: `campaign_id=eq.${campaignId}` }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combatants', filter: `campaign_id=eq.${campaignId}` }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_items', filter: `campaign_id=eq.${campaignId}` }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lore', filter: `campaign_id=eq.${campaignId}` }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations', filter: `campaign_id=eq.${campaignId}` }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combat_state', filter: `campaign_id=eq.${campaignId}` }, (payload) => {
      if(payload.new) { combatRound = payload.new.round; combatTurn = payload.new.turn; renderCombat(); }
    })
    .subscribe();
}

// Patched: vtt tokens also subscribe (done in vttSubscribe())

function mod(v) { return Math.floor(((+v||10) - 10)/2); }
function modStr(v) { const m = mod(v); return (m>=0?'+':'')+m; }
function hpColor(pct) { if(pct>0.6) return '#3a8a3a'; if(pct>0.3) return '#c9a227'; return '#8b1a1a'; }
function xpForLevel(lv) { return lv*1000; } // simple curve: 1000xp per level threshold

// ---- Equipment helpers (equip/unequip system) ----
function uid() { return 'itm_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// Ranuras de equipo disponibles en el personaje (deben coincidir con player_screen.html)
const SLOT_DEFS = [
  { id:'weapon_main', label:'Arma principal' },
  { id:'weapon_off',  label:'Arma secundaria / Escudo' },
  { id:'armor',       label:'Armadura (torso)' },
  { id:'head',        label:'Casco/Cabeza' },
  { id:'hands',       label:'Guantes/Manos' },
  { id:'feet',        label:'Botas/Pies' },
  { id:'cape',        label:'Capa/Espalda' },
  { id:'belt',        label:'Cinturón' },
  { id:'ring1',       label:'Anillo 1' },
  { id:'ring2',       label:'Anillo 2' },
  { id:'amulet',      label:'Amuleto/Collar' },
  { id:'earring1',    label:'Arete 1' },
  { id:'earring2',    label:'Arete 2' },
];
const SLOT_LABELS = Object.fromEntries(SLOT_DEFS.map(s=>[s.id,s.label]));

const ITEM_CATEGORIES = [
  { id:'arma_1m',  label:'Arma (una mano)',        slotGroup:['weapon_main'] },
  { id:'arma_2m',  label:'Arma (dos manos)',        slotGroup:['weapon_main','weapon_off'], twoHanded:true },
  { id:'escudo',   label:'Escudo / Secundaria',     slotGroup:['weapon_off'] },
  { id:'armadura', label:'Armadura',                slotGroup:['armor'] },
  { id:'casco',    label:'Casco',                   slotGroup:['head'] },
  { id:'guantes',  label:'Guantes',                 slotGroup:['hands'] },
  { id:'botas',    label:'Botas',                   slotGroup:['feet'] },
  { id:'capa',     label:'Capa',                    slotGroup:['cape'] },
  { id:'cinturon', label:'Cinturón',                slotGroup:['belt'] },
  { id:'anillo',   label:'Anillo',                  slotGroup:['ring1','ring2'], flexible:true },
  { id:'amuleto',  label:'Amuleto',                 slotGroup:['amulet'] },
  { id:'arete',    label:'Arete',                   slotGroup:['earring1','earring2'], flexible:true },
  { id:'otro',     label:'Otro (sin ranura)',       slotGroup:[] },
];
const CAT_MAP = Object.fromEntries(ITEM_CATEGORIES.map(c=>[c.id,c]));
function catLabel(id) { return (CAT_MAP[id]||CAT_MAP.otro).label; }

function normalizeItem(it) {
  if(typeof it === 'string') return { id: uid(), nombre: it, tipo:'', categoria:'otro', mod_stats:{}, equipped:false, precio:0, slots:[] };
  return {
    id: it.id || uid(), nombre: it.nombre||'', tipo: it.tipo||'',
    categoria: it.categoria || 'otro', mod_stats: it.mod_stats||{},
    equipped: !!it.equipped, precio: it.precio||0, slots: it.slots||[]
  };
}
function normalizeEquipo(arr) { return (arr||[]).map(normalizeItem); }
// Suma los mod_stats de los objetos EQUIPADOS a las estadísticas base. Los objetos guardados
// pero no equipados no afectan nada.
function effectiveStats(pc) {
  const base = { str:+pc.str||10, dex:+pc.dex||10, con:+pc.con||10, int_:+pc.int_||10, wis:+pc.wis||10, cha:+pc.cha||10 };
  (pc.equipo||[]).forEach(item => {
    if(item.equipped && item.mod_stats) {
      Object.entries(item.mod_stats).forEach(([k,v]) => { if(base[k]!==undefined) base[k] += (+v||0); });
    }
  });
  return base;
}
// El HP máximo depende del modificador de CON; si un objeto equipado sube/baja la CON,
// el HP máximo mostrado se ajusta en vivo (sin tocar el hp_max guardado en la base de datos).
function effectiveHpMax(pc) {
  const eff = effectiveStats(pc);
  const baseConMod = mod(pc.con);
  const effConMod = mod(eff.con);
  const delta = (effConMod - baseConMod) * (pc.nivel||1);
  return Math.max(1, (pc.hp_max||0) + delta);
}

// Busca el dado de golpe (hit die) de la clase del PC a partir del texto guardado en pc.clase
// (ej: "Human Fighter" -> encuentra "Fighter" en PC_DATA.classes). Si no encuentra nada, usa d8.
function getHitDie(claseStr) {
  if(!claseStr) return 8;
  const found = PC_DATA.classes.find(c => claseStr.toLowerCase().includes(c.n.toLowerCase()));
  return found ? (+found.hd || 8) : 8;
}

// ---- PCs ----
async function addPC(wizardData = null) {
  const pin = document.getElementById('pc-pin').value.trim();
  if(!pin) { alert('Asigna un PIN al jugador.'); return; }
  const pc = {
    campaign_id: campaignId, player_pin: pin,
    nombre: document.getElementById('pc-nombre').value.trim(),
    clase: document.getElementById('pc-clase').value.trim(),
    nivel: +document.getElementById('pc-nivel').value || 1,
    xp: 0,
    hp_max: +document.getElementById('pc-hp').value || 10,
    hp_curr: +document.getElementById('pc-hp').value || 10,
    ca: +document.getElementById('pc-ca').value || 10,
    str: wizardData?.str ?? (+document.getElementById('pc-str').value || 10),
    dex: wizardData?.dex ?? (+document.getElementById('pc-dex').value || 10),
    con: wizardData?.con ?? (+document.getElementById('pc-con').value || 10),
    int_: wizardData?.int ?? (+document.getElementById('pc-int').value || 10),
    wis: wizardData?.wis ?? (+document.getElementById('pc-wis').value || 10),
    cha: wizardData?.cha ?? (+document.getElementById('pc-cha').value || 10),

    equipo: [], habilidades: [], dinero: 0
  };
  if(!pc.nombre) { alert('El personaje necesita un nombre.'); return; }
  
  console.log("Datos finales PC:", pc);

  const { data, error } = await sb.from('characters').insert(pc).select();
  if(error) { alert('Error al guardar: ' + error.message + '\n\nDetalles: ' + JSON.stringify(error)); console.error(error); return; }
  console.log('PC saved:', data);
  ['nombre','clase','nivel','hp','ca','str','dex','con','int','wis','cha','pin'].forEach(f=>{const el=document.getElementById('pc-'+f); if(el) el.value = f==='nivel'?1:(['str','dex','con','int','wis','cha'].includes(f)?10:'');});
  toggleForm('pc-form');
  showToast('Personaje creado ?');
  await loadAll();
}

async function updatePC(id, field, value) {
  await sb.from('characters').update({ [field]: value }).eq('id', id);
}

async function addXP(id) {
  const pc = pcs.find(p=>p.id===id);
  const amt = parseInt(prompt('XP a otorgar a '+pc.nombre+':')||'0');
  if(!amt) return;
  const newXp = (pc.xp||0) + amt;
  await sb.from('characters').update({ xp: newXp }).eq('id', id);
  showToast(`+${amt} XP para ${pc.nombre}`);
}

async function levelUp(id) {
  const pc = pcs.find(p=>p.id===id);
  if(!confirm(`¿Subir a ${pc.nombre} a nivel ${pc.nivel+1}?`)) return;

  // HP ganado en el nuevo nivel = promedio del dado de golpe + modificador de CON (mínimo 1)
  const conMod = mod(pc.con);
  const hitDie = getHitDie(pc.clase);
  const avgRoll = Math.ceil(hitDie / 2) + 1;
  const hpGain = Math.max(1, avgRoll + conMod);

  const newNivel = pc.nivel + 1;
  const newHpMax = (pc.hp_max || 0) + hpGain;
  const newHpCurr = (pc.hp_curr || 0) + hpGain; // también cura ese HP extra al subir de nivel

  await sb.from('characters').update({ nivel: newNivel, hp_max: newHpMax, hp_curr: newHpCurr }).eq('id', id);
  showToast(`${pc.nombre} ahora es nivel ${newNivel} · +${hpGain} HP`);
}

// ---- Edición de estadísticas (ASI / mejoras de característica) ----
function openStatEdit(id) {
  editingStatsPC = id;
  renderPCs();
}

function cancelStatEdit() {
  editingStatsPC = null;
  renderPCs();
}

async function saveStatEdit(id) {
  const pc = pcs.find(p=>p.id===id);
  if(!pc) return;

  const fields = { str:'str', dex:'dex', con:'con', int_:'int_', wis:'wis', cha:'cha' };
  const newStats = {};
  for(const key in fields) {
    const el = document.getElementById('statedit-'+key);
    newStats[key] = Math.max(1, Math.min(30, +el.value || 10));
  }

  const update = { ...newStats };

  // Si cambió la CON, ajustamos el HP retroactivamente:
  // cada nivel ya ganado se ve afectado por el cambio en el modificador de CON.
  const oldConMod = mod(pc.con);
  const newConMod = mod(newStats.con);
  if(newConMod !== oldConMod) {
    const hpDelta = (newConMod - oldConMod) * (pc.nivel || 1);
    const newHpMax = Math.max(1, (pc.hp_max || 0) + hpDelta);
    const newHpCurr = Math.max(0, Math.min(newHpMax, (pc.hp_curr || 0) + hpDelta));
    update.hp_max = newHpMax;
    update.hp_curr = newHpCurr;
  }

  await sb.from('characters').update(update).eq('id', id);
  editingStatsPC = null;
  showToast(`Estadísticas de ${pc.nombre} actualizadas ?`);
  await loadAll();
}

async function deletePC(id) {
  if(!confirm('¿Eliminar este personaje?')) return;
  await sb.from('characters').delete().eq('id', id);
}

async function changePCHP(id, dir) {
  const pc = pcs.find(p=>p.id===id);
  const amt = parseInt(prompt(dir>0?'Curar HP:':'Daño recibido:')||'0');
  if(isNaN(amt)) return;
  const newHp = Math.max(0, Math.min(pc.hp_max, pc.hp_curr + (dir>0?amt:-amt)));
  await sb.from('characters').update({ hp_curr: newHp }).eq('id', id);
}

// ---- Dinero (gestionado exclusivamente por el DM) ----
async function adjustDinero(id) {
  const pc = pcs.find(p=>p.id===id);
  if(!pc) return;
  const amt = parseInt(prompt(`Ajustar dinero de ${pc.nombre} (actual: ${pc.dinero||0} po).\nEscribe un número positivo para dar oro, negativo para quitar:`)||'0');
  if(!amt) return;
  const newDinero = Math.max(0, (pc.dinero||0) + amt);
  await sb.from('characters').update({ dinero: newDinero }).eq('id', id);
  showToast(`${amt>0?'+':''}${amt} po para ${pc.nombre} (ahora tiene ${newDinero} po)`);
}

// ---- Inventario (el DM puede eliminar objetos; equipar/desequipar lo hace el jugador) ----
async function removePCItem(pcId, idx) {
  const pc = pcs.find(p=>p.id===pcId);
  if(!pc) return;
  const equipo = [...(pc.equipo||[])];
  const item = equipo[idx];
  if(!item) return;
  if(!confirm(`¿Quitar "${item.nombre}" del inventario de ${pc.nombre}?`)) return;
  equipo.splice(idx,1);
  await sb.from('characters').update({ equipo }).eq('id', pcId);
  showToast('Objeto eliminado del inventario');
}

function renderPCs() {
  const el = document.getElementById('pcs-list');
  const errEl = document.getElementById('pc-error');
  if(!campaignId) {
    if(errEl) { errEl.style.display='block'; errEl.textContent='Error: no hay campaña activa. Recarga la página.'; }
    return;
  }
  if(errEl) errEl.style.display='none';
  if(!pcs.length) { el.innerHTML = '<div class="empty-state">No hay personajes. ¡Crea el primero!</div>'; return; }
  const stats = ['str','dex','con','int_','wis','cha'];
  const statNames = ['STR','DEX','CON','INT','WIS','CHA'];
  el.innerHTML = pcs.map(pc => {
    const hpMax = effectiveHpMax(pc);
    const hpCurr = Math.min(pc.hp_curr, hpMax);
    const hpPct = Math.max(0, hpCurr/hpMax);
    const xpThreshold = xpForLevel(pc.nivel);
    const xpPct = Math.min(1, (pc.xp||0)/xpThreshold);
    const isEditing = editingStatsPC === pc.id;
    const eff = effectiveStats(pc);
    const statsHtml = isEditing
      ? stats.map((s,i) => `<div class="stat-box">
          <input class="input" id="statedit-${s}" type="number" min="1" max="30" value="${pc[s]||10}" style="text-align:center;padding:4px;font-size:13px">
          <div class="stat-name" style="margin-top:4px">${statNames[i]}</div>
        </div>`).join('')
      : stats.map((s,i) => {
          const baseVal = pc[s]||10, effVal = eff[s], boosted = effVal!==baseVal;
          return `<div class="stat-box"><div class="stat-val" style="${boosted?'color:var(--gold-bright)':''}">${effVal}</div><div class="stat-mod">${modStr(effVal)}</div><div class="stat-name">${statNames[i]}${boosted?' *':''}</div></div>`;
        }).join('');
    const equipo = pc.equipo || [];
    const invHtml = equipo.length ? `
      <div style="margin-top:8px">
        <div class="form-label" style="margin-bottom:4px">INVENTARIO (${equipo.filter(it=>it.equipped).length} equipado${equipo.filter(it=>it.equipped).length===1?'':'s'} de ${equipo.length})</div>
        ${equipo.map((item,ii) => {
          const hasMods = item.mod_stats && Object.keys(item.mod_stats).length;
          const modsTxt = hasMods ? Object.entries(item.mod_stats).map(([k,v])=>`${STAT_LABELS[k]||k} ${v>=0?'+':''}${v}`).join(' ') : '';
          const slotTxt = item.equipped && item.slots && item.slots.length ? item.slots.map(s=>SLOT_LABELS[s]||s).join(' + ') : '';
          return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:3px 0;font-size:12px;border-bottom:1px solid var(--leather)">
            <span>${item.nombre} <span class="badge badge-gray">${catLabel(item.categoria)}</span> ${item.equipped?'<span class="badge badge-green">EQUIPADO</span>':'<span class="badge badge-gray">GUARDADO</span>'} ${slotTxt?`<span class="card-detail">${slotTxt}</span>`:''} ${modsTxt?`<span class="card-detail">${modsTxt}</span>`:''}</span>
            <button class="btn small danger" onclick="removePCItem('${pc.id}',${ii})">?</button>
          </div>`;
        }).join('')}
      </div>` : '';
    return `<div class="card">
      <div class="card-header">
        <div style="flex:1">
          <div class="card-name">${pc.nombre}</div>
          <div class="card-detail">${pc.clase||''} — Nivel ${pc.nivel} · PIN: ${pc.player_pin}</div>
          <div class="card-detail" style="margin-top:6px">HP ${hpCurr}/${hpMax}</div>
          <div class="hp-bar"><div class="hp-fill" style="width:${Math.round(hpPct*100)}%;background:${hpColor(hpPct)}"></div></div>
          <div class="card-detail" style="margin-top:6px">XP ${pc.xp||0} / ${xpThreshold}</div>
          <div class="xp-bar"><div class="xp-fill" style="width:${Math.round(xpPct*100)}%"></div></div>
        </div>
        <div class="actions" style="flex-direction:column">
          <span class="badge badge-gold">CA ${pc.ca}</span>
          <button class="btn small danger" onclick="deletePC('${pc.id}')">?</button>
        </div>
      </div>
      <div class="grid-3" style="margin-top:8px">${statsHtml}</div>
      <div class="card-detail" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
        <span>Dinero: <b class="gold-text">${pc.dinero||0} po</b></span>
        <button class="btn small" onclick="adjustDinero('${pc.id}')">Ajustar dinero</button>
      </div>
      ${invHtml}
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        ${isEditing ? `
          <button class="btn small gold" onclick="saveStatEdit('${pc.id}')">? Guardar stats</button>
          <button class="btn small" onclick="cancelStatEdit()">Cancelar</button>
        ` : `
          <button class="btn small" onclick="changePCHP('${pc.id}',-1)">? Daño</button>
          <button class="btn small" onclick="changePCHP('${pc.id}',1)">+ Curar</button>
          <button class="btn small gold" onclick="addXP('${pc.id}')">+ Dar XP</button>
          <button class="btn small gold" onclick="levelUp('${pc.id}')">? Subir nivel</button>
          <button class="btn small" onclick="openStatEdit('${pc.id}')">? Editar stats</button>
        `}
      </div>
    </div>`;
  }).join('');
}

// ---- COMBAT ----
async function addCombatant() {
  const c = {
    campaign_id: campaignId,
    nombre: document.getElementById('comb-nombre').value.trim(),
    init: +document.getElementById('comb-init').value || 0,
    tipo: document.getElementById('comb-tipo').value,
    hp_max: +document.getElementById('comb-hp').value || 10,
    hp_curr: +document.getElementById('comb-hp').value || 10,
    ca: +document.getElementById('comb-ca').value || 10,
    visible_to_players: document.getElementById('comb-visible').checked,
    show_stats_to_players: document.getElementById('comb-showstats').checked,
    conditions: []
  };
  if(!c.nombre) return;
  await sb.from('combatants').insert(c);
  ['nombre','init','hp','ca'].forEach(f=>{const el=document.getElementById('comb-'+f); if(el) el.value='';});
}

// ── Add a PC to combat ──
function dexMod(pc) { return Math.floor(((pc.dex||10)-10)/2); }

async function addPCToCombat(pcId) {
  const pc = pcs.find(p=>p.id===pcId);
  if(!pc) return;
  // Check if already in combat
  const already = combatants.find(c=>c.character_id===pcId || c.nombre===pc.nombre);
  if(already) { showToast(pc.nombre+' ya está en combate'); return; }
  const initOverride = document.getElementById('pc-init-override').value;
  const init = initOverride !== '' ? +initOverride : rollDie(20) + dexMod(pc);
  await sb.from('combatants').insert({
    campaign_id: campaignId,
    character_id: pcId,
    nombre: pc.nombre,
    init,
    tipo: 'player',
    hp_max: pc.hp_max || 10,
    hp_curr: pc.hp_curr || pc.hp_max || 10,
    ca: pc.ca || 10,
    visible_to_players: true,
    show_stats_to_players: true,
    conditions: []
  });
  showToast(pc.nombre+' añadido (init '+init+')');
}

async function addAllPCsToCombat() {
  if(!pcs.length) { showToast('No hay personajes creados'); return; }
  for(const pc of pcs) { await addPCToCombat(pc.id); }
}

// ── Roll initiative for ALL combatants that have init=0 ──
async function rollAllInitiatives() {
  if(!combatants.length) { showToast('No hay combatientes'); return; }
  const updates = combatants.map(c => {
    const pc = pcs.find(p=>p.id===c.character_id);
    const mod = pc ? dexMod(pc) : 0;
    return sb.from('combatants').update({ init: rollDie(20)+mod }).eq('id', c.id);
  });
  await Promise.all(updates);
  showToast('Iniciativas tiradas');
}

// ── Render PC buttons in combat panel ──
function renderCombatPCButtons() {
  const el = document.getElementById('comb-pc-buttons');
  if(!el) return;
  if(!pcs.length) {
    el.innerHTML = '<div class="card-detail" style="font-style:italic">No hay personajes creados aún.</div>';
    return;
  }
  const inCombatIds = new Set(combatants.filter(c=>c.character_id).map(c=>c.character_id));
  el.innerHTML = pcs.map(pc => {
    const inCombat = inCombatIds.has(pc.id);
    return `<button class="pc-comb-btn ${inCombat?'in-combat':''}" onclick="addPCToCombat('${pc.id}')" ${inCombat?'title="Ya en combate"':''}>
      <span class="pc-name">${inCombat?'✓ ':''} ${pc.nombre}</span>
      <span class="pc-stats">HP ${pc.hp_curr}/${pc.hp_max} · CA ${pc.ca}</span>
    </button>`;
  }).join('');
}

// ── Quick monster search in combat ──
let _quickMonResults = [];
function renderQuickMon() {
  if(typeof MONSTERS === 'undefined') return;
  const q = document.getElementById('quick-mon-search').value.toLowerCase().trim();
  const el = document.getElementById('quick-mon-results');
  if(!q) { el.innerHTML = ''; _quickMonResults = []; return; }
  _quickMonResults = MONSTERS.filter(m=>m.n.toLowerCase().includes(q)).slice(0,30);
  if(!_quickMonResults.length) { el.innerHTML = '<div class="empty-state" style="padding:8px">Sin resultados.</div>'; return; }
  el.innerHTML = '<div style="padding:4px 8px;font-family:Cinzel,serif;font-size:9px;color:var(--cream-muted);border-bottom:1px solid var(--leather)">NOMBRE · CR · HP · CA · ACCIÓN</div>' +
    _quickMonResults.map((m,i) => `
      <div class="quick-mon-row" onclick="quickAddMonster(${i})">
        <div style="font-size:12px;color:var(--cream)">${m.n}</div>
        <div style="font-size:10px;color:var(--cream-muted)">CR ${m.cr||'?'}</div>
        <div style="font-size:10px;color:var(--cream-dim)">${m.hp||'?'}</div>
        <button class="btn small gold" onclick="event.stopPropagation();quickAddMonster(${i})">+ Combate</button>
      </div>`).join('');
}

function parseNum(s) { const m=(s||'').match(/^(\d+)/); return m?+m[1]:10; }

async function quickAddMonster(idx) {
  const m = _quickMonResults[idx];
  if(!m) return;
  const qty = Math.max(1, +document.getElementById('quick-mon-qty').value||1);
  const initInput = document.getElementById('quick-mon-init').value;
  const rows = [];
  for(let i=0;i<qty;i++) {
    const init = initInput!=='' ? (+initInput - i) : rollDie(20)+1;
    rows.push({
      campaign_id: campaignId,
      nombre: qty>1 ? m.n+' '+(i+1) : m.n,
      init, tipo: 'enemy',
      hp_max: parseNum(m.hp), hp_curr: parseNum(m.hp),
      ca: parseNum(m.ac),
      visible_to_players: true,
      show_stats_to_players: false,
      conditions: [],
      monster_attacks: m.atk||[]
    });
  }
  await sb.from('combatants').insert(rows);
  showToast((qty>1?qty+'× ':'')+m.n+' añadido');
  document.getElementById('quick-mon-search').value='';
  document.getElementById('quick-mon-results').innerHTML='';
}
// ── end combat helpers ──

async function changeCombatHP(id, dir) {
  const c = combatants.find(x=>x.id===id);
  const amt = parseInt(prompt(dir>0?'Curar HP:':'Daño:')||'0');
  if(isNaN(amt)) return;
  const newHp = Math.max(0, Math.min(c.hp_max, c.hp_curr + (dir>0?amt:-amt)));
  await sb.from('combatants').update({ hp_curr: newHp }).eq('id', id);
}
async function setCombatHP(id, val) {
  const c = combatants.find(x=>x.id===id);
  const newHp = Math.max(0, Math.min(c.hp_max, +val||0));
  await sb.from('combatants').update({ hp_curr: newHp }).eq('id', id);
}
async function toggleVisible(id, field, val) {
  await sb.from('combatants').update({ [field]: val }).eq('id', id);
}
async function addCombatCond(id, sel) {
  if(!sel.value) return;
  const c = combatants.find(x=>x.id===id);
  if(!c) return;
  const conditions = [...(c.conditions||[])];
  if(!conditions.includes(sel.value)) conditions.push(sel.value);
  await sb.from('combatants').update({conditions}).eq('id',id);
  sel.value='';
}
async function removeCombatCond(id, cond) {
  const c = combatants.find(x=>x.id===id);
  if(!c) return;
  const conditions = (c.conditions||[]).filter(x=>x!==cond);
  await sb.from('combatants').update({conditions}).eq('id',id);
}
function rollCombatInit(id) {
  const c = combatants.find(x=>x.id===id);
  if(!c) return;
  const roll = rollDie(20)+1;
  sb.from('combatants').update({init:roll}).eq('id',id);
  showToast('Init '+c.nombre+': '+roll);
}

function rollCombatantAtk(combatantId, atkIdx) {
  const c = combatants.find(x=>x.id===combatantId);
  if(!c) return;
  const atk = (c.monster_attacks||[])[atkIdx];
  if(!atk) return;
  // Attack roll — secret (DM only)
  diceRoll(c.nombre+': '+atk.n+' (ataque)', 20, 1, atk.a||0, _diceState?.adv||'normal', false, null, 'DM');
  // Damage roll
  setTimeout(()=>{
    const dmg = atk.d||'1d6';
    const parts = dmg.match(/^(\d+)d(\d+)([+-]\d+)?/);
    if(parts) {
      diceRoll(c.nombre+': '+atk.n+' (daño)', +parts[2]||6, +parts[1]||1, parts[3]?(+parts[3]):0, 'normal', false, null, 'DM');
    }
  }, 350);
}
async function deleteCombatant(id) {
  await sb.from('combatants').delete().eq('id', id);
}
async function clearCombat() {
  if(!confirm('¿Limpiar todo el combate?')) return;
  await sb.from('combatants').delete().eq('campaign_id', campaignId);
  await sb.from('combat_state').update({ round: 1, turn: 0 }).eq('campaign_id', campaignId);
  combatRound = 1; combatTurn = 0;
  renderCombat();
}
async function sortByInit() {
  combatants.sort((a,b)=>b.init-a.init);
  await sb.from('combat_state').update({ turn: 0 }).eq('campaign_id', campaignId);
  combatTurn = 0;
  renderCombat();
}
async function nextTurn() {
  if(!combatants.length) return;
  let turn = (combatTurn+1) % combatants.length;
  let round = combatRound;
  if(turn === 0) round = combatRound + 1;
  await sb.from('combat_state').update({ round, turn }).eq('campaign_id', campaignId);
  combatRound = round; combatTurn = turn;
  renderCombat();
}

function renderCombat() {
  document.getElementById('round-display').textContent = `Ronda ${combatRound}`;
  const el = document.getElementById('combat-list');
  if(!combatants.length) { el.innerHTML = '<div class="empty-state">Añade combatientes para empezar.</div>'; return; }
  const sorted = [...combatants].sort((a,b)=>b.init-a.init);
  const turn = combatTurn;
  renderCombatPCButtons();
  el.innerHTML = sorted.map((c,i) => {
    const hpPct = Math.max(0, c.hp_curr/c.hp_max);
    const isActive = i === turn;
    const isDead = c.hp_curr <= 0;
    const initClass = c.tipo==='enemy'?'enemy':c.tipo==='neutral'?'neutral':'';
    const linkedPC = c.character_id ? pcs.find(p=>p.id===c.character_id) : null;
    const conds = (c.conditions||[]);
    const condBadges = conds.map(cd=>`<span class="condition-badge">${cd} <span style="cursor:pointer;opacity:0.7" onclick="removeCombatCond('${c.id}','${cd}')">×</span></span>`).join('');
    const CONDITIONS = ['Envenenado','Paralizado','Aturdido','Invisible','Asustado','Hechizado','Cegado','Derribado','Incapacitado','Restringido'];
    return `<div class="combatant-row ${isActive?'turn':''} ${isDead?'dead':''}">
      <div>
        <span class="init-badge ${initClass}">${c.init}</span>
        ${isActive?'<div style="font-size:8px;color:var(--gold);font-family:Cinzel,serif;text-align:center;letter-spacing:0.5px">TURNO</div>':''}
      </div>
      <div>
        <div style="font-size:13px;font-weight:600;color:${linkedPC?'var(--gold-bright)':'var(--cream)'}">${c.nombre}${linkedPC?'<span style="font-size:9px;color:var(--gold-dim);font-family:Cinzel,serif;margin-left:4px">PC</span>':''}</div>
        ${(c.monster_attacks||[]).length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">${(c.monster_attacks||[]).map((a,ai)=>`<button class="btn small" style="background:var(--dragon);color:var(--cream);border-color:var(--dragon-bright);font-size:9px" onclick="rollCombatantAtk('${c.id}',${ai})" title="${a.n}: +${a.a} / ${a.d}">⚔ ${a.n}</button>`).join('')}</div>` : ''}
        <div class="hp-bar"><div class="hp-fill" style="width:${Math.round(hpPct*100)}%;background:${hpColor(hpPct)}"></div></div>
        ${condBadges?`<div style="margin-top:3px">${condBadges}</div>`:''}
        <div style="margin-top:3px">
          <select class="select" style="font-size:9px;padding:1px 3px;width:100px" onchange="addCombatCond('${c.id}',this)">
            <option value="">+ Condición</option>
            ${CONDITIONS.filter(cd=>!conds.includes(cd)).map(cd=>`<option value="${cd}">${cd}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:3px">
        <button class="btn small danger" style="padding:3px 5px" onclick="changeCombatHP('${c.id}',-1)">−</button>
        <input class="hp-input" type="number" value="${c.hp_curr}" onchange="setCombatHP('${c.id}',this.value)" style="width:48px">
        <button class="btn small" style="padding:3px 5px" onclick="changeCombatHP('${c.id}',1)">+</button>
        <span style="font-size:9px;color:var(--cream-muted)">${c.hp_max}</span>
      </div>
      <div style="font-size:12px;color:var(--cream-dim)">CA ${c.ca}</div>
      <div style="display:flex;flex-direction:column;gap:2px">
        <label class="toggle-row" style="font-size:9px"><input type="checkbox" ${c.visible_to_players?'checked':''} onchange="toggleVisible('${c.id}','visible_to_players',this.checked)"> Visible</label>
        <label class="toggle-row" style="font-size:9px"><input type="checkbox" ${c.show_stats_to_players?'checked':''} onchange="toggleVisible('${c.id}','show_stats_to_players',this.checked)"> Stats</label>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <button class="btn small danger" onclick="deleteCombatant('${c.id}')">✕</button>
        <button class="btn small" onclick="rollCombatInit('${c.id}')" title="Tirar iniciativa">🎲</button>
      </div>
    </div>`;
  }).join('');
}

// ---- SHOP ----
// La lista de "Tienda" en el formulario depende de los lugares de tipo "tienda" creados en Mapas.
function populateShopLocationSelect() {
  const sel = document.getElementById('shop-location-id');
  if(!sel) return;
  const prev = sel.value;
  const shops = locations.filter(l => l.tipo === 'tienda');
  sel.innerHTML = shops.length
    ? shops.map(s => `<option value="${s.id}">${s.nombre}${s.abierta?'':' (cerrada)'}</option>`).join('')
    : `<option value="">-- Crea una tienda en Mapas primero --</option>`;
  if(shops.some(s=>s.id===prev)) sel.value = prev;
}

async function addShopItem() {
  const locationId = document.getElementById('shop-location-id').value;
  const location = locations.find(l => l.id === locationId);
  if(!location) { alert('Elige una tienda de la lista. Si no hay ninguna, ve a la pestaña Mapas y crea un lugar de tipo "Tienda/Comercio".'); return; }

  const modStats = {};
  ['str','dex','con','int','wis','cha'].forEach(s=>{
    const el = document.getElementById('shop-mod-'+s);
    const v = +el?.value || 0;
    if(v !== 0) modStats[s==='int'?'int_':s] = v;
  });
  const cantidadRaw = document.getElementById('shop-cantidad').value;
  const cantidad = cantidadRaw === '' ? null : Math.max(0, parseInt(cantidadRaw) || 0);

  const diceType = document.getElementById('shop-dice-type').value;
  const atkMod = +document.getElementById('shop-atk-mod').value || 0;
  const dmgDice = document.getElementById('shop-dmg-dice').value.trim();
  const dmgMod = +document.getElementById('shop-dmg-mod').value || 0;
  const spellDc = document.getElementById('shop-spell-dc').value.trim();
  const item = {
    campaign_id: campaignId,
    location_id: location.id,
    shop_name: location.nombre,
    nombre: document.getElementById('shop-item').value.trim(),
    tipo: document.getElementById('shop-type').value.trim(),
    categoria: document.getElementById('shop-categoria').value || 'otro',
    precio: +document.getElementById('shop-price').value || 0,
    cantidad: cantidad,
    mod_stats: modStats,
    dice_type: diceType || null,
    atk_mod: atkMod,
    dmg_dice: dmgDice || null,
    dmg_mod: dmgMod,
    spell_dc: spellDc || null,
    visible: true
  };
  if(!item.nombre) { alert('El artículo necesita un nombre.'); return; }
  const { error } = await sb.from('shop_items').insert(item);
  if(error) {
    alert('Error al guardar el artículo: ' + error.message + '\n\nSi el mensaje menciona "location_id" o "cantidad", falta agregar esa columna en Supabase (tabla shop_items).');
    console.error(error);
    return;
  }
  ['item','type','price','cantidad'].forEach(f=>{const el=document.getElementById('shop-'+f); if(el) el.value='';});
  ['str','dex','con','int','wis','cha'].forEach(s=>{const el=document.getElementById('shop-mod-'+s); if(el) el.value='0';});
  showToast('Artículo añadido ?');
  await loadAll();
}
async function toggleShopVisible(id, val) {
  await sb.from('shop_items').update({ visible: val }).eq('id', id);
  await loadAll();
}
async function updateShopCantidad(id, raw) {
  const cantidad = raw === '' ? null : Math.max(0, parseInt(raw) || 0);
  await sb.from('shop_items').update({ cantidad }).eq('id', id);
  await loadAll();
}
async function deleteShopItem(id) {
  await sb.from('shop_items').delete().eq('id', id);
  await loadAll();
}

const STAT_LABELS = {str:'STR',dex:'DEX',con:'CON',int_:'INT',wis:'WIS',cha:'CHA'};

// Entrega un artículo de la tienda al inventario de un personaje elegido por el DM.
// El objeto queda GUARDADO (sin equipar): el jugador decide cuándo equiparlo desde su pantalla,
// y solo entonces se aplican sus mod_stats. Opcionalmente se puede cobrar el precio del dinero del PJ.
async function giveItemToPC(itemId) {
  const item = shopItems.find(i=>i.id===itemId);
  if(!item) return;
  if(item.cantidad !== null && item.cantidad !== undefined && item.cantidad <= 0) { showToast('Artículo agotado — sin stock'); return; }
  if(!pcs.length) { showToast('No hay personajes en esta campaña'); return; }

  const names = pcs.map((p,i)=>`${i+1}. ${p.nombre}`).join('\n');
  const choice = prompt(`¿A qué personaje darle "${item.nombre}"?\n\n${names}\n\nEscribe el número:`);
  const idx = parseInt(choice) - 1;
  const pc = pcs[idx];
  if(!pc) return;

  const modsTxt = item.mod_stats && Object.keys(item.mod_stats).length
    ? ' (' + Object.entries(item.mod_stats).map(([k,v])=>`${STAT_LABELS[k]||k} ${v>=0?'+':''}${v}`).join(', ') + ')'
    : '';
  if(!confirm(`¿Dar "${item.nombre}"${modsTxt} a ${pc.nombre}? Quedará en su inventario sin equipar.`)) return;

  const newItem = { id: uid(), nombre: item.nombre, tipo: item.tipo||'', categoria: item.categoria||'otro', mod_stats: item.mod_stats||{}, equipped:false, precio: item.precio||0, slots:[] };
  const equipo = [...(pc.equipo||[]), newItem];

  let dinero = pc.dinero || 0;
  if(item.precio > 0 && confirm(`¿Cobrar el precio (${item.precio} po) del dinero de ${pc.nombre}? (Actual: ${dinero} po)`)) {
    dinero = Math.max(0, dinero - item.precio);
  }

  await sb.from('characters').update({ equipo, dinero }).eq('id', pc.id);

  // Descuenta stock automáticamente (si el artículo tiene cantidad limitada).
  // Al llegar a 0 el artículo se oculta solo para los jugadores (ver filtro en player_screen.html).
  if(item.cantidad !== null && item.cantidad !== undefined) {
    const nuevaCantidad = Math.max(0, item.cantidad - 1);
    await sb.from('shop_items').update({ cantidad: nuevaCantidad }).eq('id', item.id);
  }

  showToast(`${item.nombre} entregado a ${pc.nombre} (en su inventario) ?`);
  await loadAll();
}

function renderShop() {
  const el = document.getElementById('shop-list');
  if(!shopItems.length) { el.innerHTML = '<div class="empty-state">No hay artículos. ¡Añade el primero!</div>'; return; }

  const groups = {};
  shopItems.forEach(i => {
    const key = i.location_id || 'none';
    if(!groups[key]) groups[key] = { location: locations.find(l=>l.id===i.location_id) || null, items: [] };
    groups[key].items.push(i);
  });

  el.innerHTML = Object.values(groups).map(g => {
    const loc = g.location;
    const shopLabel = loc ? loc.nombre : (g.items[0]?.shop_name || 'Sin tienda asignada');
    const stateBadge = loc ? `<span class="badge ${loc.abierta?'badge-green':'badge-red'}">${loc.abierta?'ABIERTA':'CERRADA'}</span>` : `<span class="badge badge-gray">SIN TIENDA</span>`;
    const rows = g.items.map(i => {
      const hasMods = i.mod_stats && Object.keys(i.mod_stats).length;
      const modsHtml = hasMods
        ? `<div style="margin-top:3px">${Object.entries(i.mod_stats).map(([k,v])=>`<span class="badge badge-blue">${STAT_LABELS[k]||k} ${v>=0?'+':''}${v}</span>`).join(' ')}</div>`
        : '';
      const agotado = i.cantidad !== null && i.cantidad !== undefined && i.cantidad <= 0;
      return `<div class="shop-item-row" style="${agotado?'opacity:0.5':''}">
      <div>${i.nombre} <span class="badge badge-gray">${catLabel(i.categoria)}</span> <span class="card-detail">${i.tipo||''}</span>${agotado?' <span class="badge badge-red">AGOTADO</span>':''}${modsHtml}</div>
      <div class="gold-text">${i.precio} po</div>
      <input class="shop-cantidad-input" type="number" min="0" placeholder="∞" value="${i.cantidad===null||i.cantidad===undefined?'':i.cantidad}" onchange="updateShopCantidad('${i.id}',this.value)">
      <div><label class="toggle-row"><input type="checkbox" ${i.visible?'checked':''} onchange="toggleShopVisible('${i.id}',this.checked)"></label></div>
      <div style="display:flex;gap:4px">
        <button class="btn small gold" title="Dar a un personaje" ${agotado?'disabled':''} onclick="giveItemToPC('${i.id}')">?</button>
        <button class="btn small danger" onclick="deleteShopItem('${i.id}')">?</button>
      </div>
    </div>`;
    }).join('');
    return `<div class="shop-group">
      <div class="shop-group-header"><span class="shop-group-name">${shopLabel}</span>${stateBadge}</div>
      <div class="shop-group-body">
        <div class="shop-item-row header"><div>Artículo</div><div>Precio</div><div>Cant.</div><div>Visible</div><div></div></div>
        ${rows}
      </div>
    </div>`;
  }).join('');
}

// ---- LORE ----
async function addLore() {
  const l = {
    campaign_id: campaignId,
    titulo: document.getElementById('lore-titulo').value.trim(),
    categoria: document.getElementById('lore-cat').value,
    contenido: document.getElementById('lore-contenido').value.trim(),
    tags: document.getElementById('lore-tags').value.trim(),
    visible_to_players: document.getElementById('lore-visible').checked
  };
  if(!l.titulo) return;
  await sb.from('lore').insert(l);
  ['titulo','contenido','tags'].forEach(f=>{const el=document.getElementById('lore-'+f); if(el) el.value='';});
  document.getElementById('lore-visible').checked = false;
  toggleForm('lore-form');
}
async function toggleLoreVisible(id, val) {
  await sb.from('lore').update({ visible_to_players: val }).eq('id', id);
}
async function deleteLore(id) {
  await sb.from('lore').delete().eq('id', id);
}
function renderLore() {
  const el = document.getElementById('lore-list');
  const q = document.getElementById('lore-search').value.toLowerCase();
  const filtered = loreItems.filter(l => !q || l.titulo.toLowerCase().includes(q));
  if(!filtered.length) { el.innerHTML = '<div class="empty-state">No hay lore aún.</div>'; return; }
  const catColors = {historia:'blue',leyenda:'gold',faccion:'red',religion:'green',magia:'gold',profecia:'red',mundo:'gray'};
  el.innerHTML = filtered.map(l => `<div class="card">
    <div class="card-header">
      <div><div class="card-name">${l.titulo}</div></div>
      <div class="actions">
        <span class="badge badge-${catColors[l.categoria]||'gray'}">${l.categoria.toUpperCase()}</span>
        <label class="toggle-row"><input type="checkbox" ${l.visible_to_players?'checked':''} onchange="toggleLoreVisible('${l.id}',this.checked)"> Pública</label>
        <button class="btn small danger" onclick="deleteLore('${l.id}')">?</button>
      </div>
    </div>
    ${l.contenido?`<div class="card-detail" style="margin-top:6px">${l.contenido}</div>`:''}
  </div>`).join('');
}

function toggleForm(id) { const el = document.getElementById(id); el.style.display = el.style.display==='none'?'block':'none'; }

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');

    if(tab.dataset.tab === 'dungeon') {
      if(!dungeonDMLoaded) {
        dungeonDMLoaded = true;
        dungeonLoad().then(()=>dungeonSubscribeDM());
      }
    }
    if(tab.dataset.tab === 'vtt') {
      if(!vttLoaded) {
        vttLoaded = true;
        setTimeout(() => {
          vttInit();              // sets vttCtx synchronously
          vttSubscribe();
          vttLoad().then(() => vttRender()); // render AFTER load
        }, 50);
      } else {
        if(!vttCtx) vttInit();
        vttLoad().then(() => vttRender());
      }
    }
  });
});


// ========== BESTIARIO ==========
let MONSTERS = null; // loaded via loadGameData()


(function initBestiarioFilters() {
  const crOrder = ['0','1/8','1/4','1/2','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30'];
  const crSet = new Set(), tySet = new Set();
  MONSTERS.forEach(m => { if(m.cr) crSet.add(m.cr); if(m.ty) tySet.add(m.ty); });
  [...crSet].sort((a,b) => {const ai=crOrder.indexOf(a),bi=crOrder.indexOf(b); return (ai<0?99:ai)-(bi<0?99:bi);}).forEach(cr => {
    const o = document.createElement('option'); o.value=cr; o.textContent='CR '+cr;
    document.getElementById('mon-cr').appendChild(o);
  });
  [...tySet].sort().forEach(ty => {
    const o = document.createElement('option'); o.value=ty; o.textContent=ty.charAt(0).toUpperCase()+ty.slice(1);
    document.getElementById('mon-type').appendChild(o);
  });
})();

function parseHP(s) { const m=(s||'').match(/^(\d+)/); return m?+m[1]:10; }
function parseAC(s) { const m=(s||'').match(/^(\d+)/); return m?+m[1]:10; }

let _bestResults = [];
function renderBestiario() {
  if(!MONSTERS) { const el=document.getElementById('tab-bestiario'); if(el) el.innerHTML='<div class="empty-state">Cargando...</div>'; return; }
  const q = document.getElementById('mon-search').value.toLowerCase();
  const crf = document.getElementById('mon-cr').value;
  const tyf = document.getElementById('mon-type').value;
  _bestResults = MONSTERS.filter(m => {
    if(q && !m.n.toLowerCase().includes(q)) return false;
    if(crf && m.cr !== crf) return false;
    if(tyf && m.ty !== tyf) return false;
    return true;
  });
  const el = document.getElementById('mon-list');
  if(!_bestResults.length) { el.innerHTML='<div class="empty-state">Sin resultados.</div>'; return; }
  const trunc = _bestResults.length > 120;
  const show = _bestResults.slice(0,120);
  el.innerHTML = show.map((m,i) => {
    const atks = (m.atk||[]);
    const atkBtns = atks.map((a,ai) =>
      `<button class="btn small" style="background:var(--dragon);color:var(--cream);border-color:var(--dragon-bright);font-size:9px"
        onclick="rollBestiarioAtk(${i},${ai})" title="${a.n}: +${a.a} / ${a.d}">
        ⚔ ${a.n} (+${a.a}|${a.d})
      </button>`
    ).join('');
    const atkPreview = atks.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">${atkBtns}</div>`
      : '';
    return `<div class="mon-row" style="grid-template-columns:1fr 50px 80px 50px 80px 110px;align-items:start;padding:8px 10px">
      <div>
        <div style="font-size:13px;color:var(--cream);font-weight:600">${m.n}</div>
        ${atkPreview}
      </div>
      <div style="font-size:11px;color:var(--cream-dim);padding-top:2px">${m.cr||'?'}</div>
      <div style="font-size:11px;color:var(--cream-dim);padding-top:2px">${m.hp||'?'}</div>
      <div style="font-size:11px;color:var(--cream-dim);padding-top:2px">${m.ac||'?'}</div>
      <div style="font-size:11px;color:var(--cream-muted);padding-top:2px">${m.ty||''}</div>
      <div style="display:flex;flex-direction:column;gap:3px;padding-top:2px">
        <button class="btn small gold" onclick="bestAddToCombat(${i})">⚔ Combate</button>
        <button class="btn small" onclick="bestFillNPC(${i})">👤 NPC</button>
        <button class="btn small" onclick="dungeonAddEnemyFromBestiario(${i})" title="Añadir al dungeon">☠ Dungeon</button>
      </div>
    </div>`;
  }).join('') + (trunc ? `<div class="empty-state">Mostrando 120 de ${_bestResults.length}. Refina la búsqueda.</div>` : '');
}

function rollBestiarioAtk(mi, ai) {
  const m = _bestResults[mi]; if(!m) return;
  const atk = (m.atk||[])[ai]; if(!atk) return;
  // Roll attack d20
  diceRoll(m.n+': '+atk.n+' (ataque)', 20, 1, atk.a||0, _diceState?.adv||'normal', false, null, 'DM');
  // Roll damage after short delay
  setTimeout(() => {
    const dmg = atk.d || '1d6';
    const parts = dmg.match(/^(\d+)d(\d+)([+-]\d+)?/);
    if(parts) {
      const qty = +parts[1]||1, sides = +parts[2]||6;
      const mod = parts[3] ? +parts[3] : 0;
      diceRoll(m.n+': '+atk.n+' (daño)', sides, qty, mod, 'normal', false, null, 'DM');
    } else {
      // fallback
      diceRoll(m.n+': '+atk.n+' (daño)', 6, 1, 0, 'normal', false, null, 'DM');
    }
  }, 350);
}

function bestAddToCombat(i) {
  const m = _bestResults[i]; if(!m) return;
  // Delegate to existing addMonsterToCombat or quickAddMonster logic
  const qty = +document.getElementById('mon-qty')?.value||1;
  const initInput = document.getElementById('mon-init')?.value||'';
  const parseNum = s => { const x=(s||'').match(/^(\d+)/); return x?+x[1]:10; };
  const rows = [];
  for(let j=0;j<qty;j++) {
    const init = initInput!=='' ? (+initInput-j) : (Math.floor(Math.random()*20)+1);
    rows.push({
      campaign_id: campaignId,
      nombre: qty>1 ? m.n+' '+(j+1) : m.n,
      init, tipo:'enemy',
      hp_max: parseNum(m.hp), hp_curr: parseNum(m.hp),
      ca: parseNum(m.ac),
      visible_to_players: true, show_stats_to_players: false,
      conditions: [],
      monster_attacks: m.atk||[]
    });
  }
  sb.from('combatants').insert(rows).then(()=>{
    showToast((qty>1?qty+'× ':'')+m.n+' añadido al combate');
    goToTab('combate');
  });
}

function bestFillNPC(i) {
  const m = _bestResults[i]; if(!m) return;
  prefillNPCFromMonster(m);
}

async function addMonsterToCombat(m) {
  if(!campaignId) return;
  const qty = Math.max(1, +document.getElementById('mon-qty').value || 1);
  const initInput = document.getElementById('mon-init').value;
  const hpMax = parseHP(m.hp);
  const ac = parseAC(m.ac);
  const rows = [];
  for(let i=0;i<qty;i++) {
    const init = initInput !== '' ? (+initInput - i) : (Math.floor(Math.random()*20)+1);
    rows.push({
      campaign_id: campaignId,
      nombre: qty > 1 ? m.n+' '+(i+1) : m.n,
      init, tipo: 'enemy',
      hp_max: hpMax, hp_curr: hpMax, ca: ac,
      visible_to_players: true, show_stats_to_players: false,
      conditions: []
    });
  }
  await sb.from('combatants').insert(rows);
  showToast((qty>1?qty+'× ':'')+m.n+' añadido al combate');
  goToTab('combate');
}

function prefillNPCFromMonster(m) {
  document.getElementById('npc-nombre').value = m.n;
  document.getElementById('npc-rol').value = m.ty ? m.ty.charAt(0).toUpperCase()+m.ty.slice(1) : '';
  document.getElementById('npc-actitud').value = 'neutral';
  document.getElementById('npc-desc').value = 'CR '+m.cr+' · AC '+m.ac+' · HP '+m.hp;
  goToTab('npcs');
  toggleForm('npc-form');
  showToast('Datos de '+m.n+' copiados al formulario de NPC');
}

function goToTab(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const tabEl = document.querySelector(`.tab[data-tab="${name}"]`);
  if(tabEl) tabEl.classList.add('active');
  const panelEl = document.getElementById('tab-'+name);
  if(panelEl) panelEl.classList.add('active');
}

renderBestiario();
// =================================


// ======== PLAYER COMPENDIUM & PC WIZARD ========
const PC_DATA = {"races":[{"n":"Aarakocra","ab":"Dexterity +2, Wisdom +1","sz":"M","sp":"25","tr":[{"n":"Flight","t":"You have a flying speed of 50 feet. To use this speed, you can't be wearing medium or heavy armor."},{"n":"Talons","t":"You are proficient with your unarmed strikes, which deal 1d4 slashing damage on a hit."},{"n":"Language","t":"You can speak, read, and write Common, Aarakocra, and Auran."}]},{"n":"Aasimar (Fallen)","ab":"Charisma +2, Strength +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Blessed with a radiant soul, your vision can easily cut through darkness. You can see in dim light within 60 feet of you..."},{"n":"Celestial Resistance","t":"You have resistance to necrotic damage and radiant damage."},{"n":"Healing Hands","t":"As an action, you can touch a creature and cause it to regain a number of hit points equal to your level. Once you use t..."},{"n":"Light Bearer","t":"You know the light cantrip. Charisma is your spellcasting ability for it."}]},{"n":"Aasimar (Protector)","ab":"Charisma +2, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Blessed with a radiant soul, your vision can easily cut through darkness. You can see in dim light within 60 feet of you..."},{"n":"Celestial Resistance","t":"You have resistance to necrotic damage and radiant damage."},{"n":"Healing Hands","t":"As an action, you can touch a creature and cause it to regain a number of hit points equal to your level. Once you use t..."},{"n":"Light Bearer","t":"You know the light cantrip. Charisma is your spellcasting ability for it."}]},{"n":"Aasimar (Scourge)","ab":"Charisma +2, Constitution +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Blessed with a radiant soul, your vision can easily cut through darkness. You can see in dim light within 60 feet of you..."},{"n":"Celestial Resistance","t":"You have resistance to necrotic damage and radiant damage."},{"n":"Healing Hands","t":"As an action, you can touch a creature and cause it to regain a number of hit points equal to your level. Once you use t..."},{"n":"Light Bearer","t":"You know the light cantrip. Charisma is your spellcasting ability for it."}]},{"n":"Aetherborn","ab":"Charisma +2","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Your Charisma score increases by 2, and two other ability scores of your choice increase by 1.\n \nSource: Plane Shift: Ka..."},{"n":"Darkvision","t":"Accustomed to the night, you have superior vision in dark and dim conditions. You can see in dim light within 60 feet of..."},{"n":"Born of Aether","t":"You have resistance to necrotic damage.\n \nSource: Plane Shift: Kaladesh, p. 17"},{"n":"Menacing","t":"You gain proficiency in the Intimidation skill.\n \nSource: Plane Shift: Kaladesh, p. 17"}]},{"n":"Amonkhet Minotaur","ab":"Strength +2, Constitution +1","sz":"M","sp":"30","tr":[{"n":"Natural Weapon","t":"You can use your horns as a natural weapon to make unarmed strikes. If you hit with your horns, you deal bludgeoning dam..."},{"n":"Menacing","t":"You gain proficiency in the Intimidation skill.\n \nSource: Plane Shift: Amonkhet, p. 20"},{"n":"Relentless Endurance","t":"When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead. You can’t use this fe..."},{"n":"Savage Attacks","t":"When you score a critical hit with a melee weapon attack, you can roll one of the weapon’s damage dice one additional ti..."}]},{"n":"Amonkhet Naga","ab":"Constitution +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Speed Burst","t":"By lowering your body to the ground and propelling yourself with your arms, you can move more quickly for a time. As a b..."},{"n":"Natural Weapons","t":"Your fanged maw and constricting serpentine body are natural weapons, which you can use to make unarmed strikes. If you ..."},{"n":"Poison Immunity","t":"You are immune to poison damage and can’t be poisoned.\n \nSource: Plane Shift: Amonkhet, p. 22"},{"n":"Poison Affinity","t":"You gain proficiency with the poisoner’s kit.\n \nSource: Plane Shift: Amonkhet, p. 22"}]},{"n":"Beasthide Shifter","ab":"Dexterity +1, Constitution +2","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You have superior vision in dark and dim conditions. You can see in dim light within 60 feet of you as if it were bright..."},{"n":"Keen Senses","t":"You have proficiency with the Perception skill.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"},{"n":"Shifting","t":"As a bonus action, you can assume a more bestial appearance. This transformation lasts for 1 minute, until you die, or u..."},{"n":"Languages","t":"You can speak, read, and write Common.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"}]},{"n":"Bishtahar Elf","ab":"Dexterity +2, Wisdom +1","sz":"M","sp":"35","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill.\n \nSource: Plane Shift: Kaladesh, p. 21"},{"n":"Elf Weapon Training","t":"You have proficiency with the longsword, shortsword, shortbow, and longbow. Fey Ancestry. You have advantage on saving t..."},{"n":"Trance","t":"Elves don’t need to sleep. Instead, they meditate deeply, remaining semiconscious, for 4 hours a day. (The Common word f..."}]},{"n":"Bugbear","ab":"Strength +2, Dexterity +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Long-Limbed","t":"When you make a melee attack on your turn, your reach for it is 5 feet greater than normal."},{"n":"Powerful Build","t":"You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift."},{"n":"Sneaky","t":"You are proficient in the Stealth skill."}]},{"n":"Changeling","ab":"Charisma +2","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Either your Dexterity or your Intelligence increases by 1 (your choice).\n\n \nSource: Wayfinder's Guide to Eberron, Chapte..."},{"n":"Change Appearance","t":"As an action, you can transform your appearance or revert to your natural form. You can’t duplicate the appearance of a ..."},{"n":"Changeling Instincts","t":"You gain proficiency with two of the following skills of your choice: Deception, Intimidation, Insight, and Persuasion.\n..."},{"n":"Unsettling Visage","t":"When a creature you can see makes an attack roll against you, you can use your reaction to impose disadvantage on the ro..."}]},{"n":"Dragonborn","ab":"Strength +2, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Draconic Ancestry","t":"You have draconic ancestry. Choose one type of dragon from the Draconic Ancestry table. Your breath weapon and damage re..."},{"n":"Breath Weapon","t":"You can use your action to exhale destructive energy. Your draconic ancestry determines the size, shape, and damage type..."},{"n":"Damage Resistance","t":"You have resistance to the damage type associated with your draconic ancestry."},{"n":"Languages","t":"You can speak, read, and write Common and Draconic. Draconic is thought to be one of the oldest languages and is often u..."}]},{"n":"Dwarf (Duergar)","ab":"Constitution +2, Strength +1","sz":"M","sp":"25","tr":[{"n":"Superior Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 120..."},{"n":"Duergar Resilience","t":"You have advantage on saving throws against poison, and you have resistance against poison damage. You also have advanta..."},{"n":"Dwarven Combat Training","t":"You have proficiency with the battleaxe, handaxe, light hammer, and warhammer."},{"n":"Tool Proficiency","t":"You gain proficiency with the artisan's tools of your choice: smith's tools, brewer's supplies, or mason's tools."}]},{"n":"Dwarf (Hill)","ab":"Constitution +2, Wisdom +1","sz":"M","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Dwarven Resilience","t":"You have advantage on saving throws against poison, and you have resistance against poison damage."},{"n":"Dwarven Combat Training","t":"You have proficiency with the battleaxe, handaxe, light hammer, and warhammer."},{"n":"Tool Proficiency","t":"You gain proficiency with the artisan's tools of your choice: smith's tools, brewer's supplies, or mason's tools."}]},{"n":"Dwarf (Mountain)","ab":"Constitution +2, Strength +2","sz":"M","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Dwarven Resilience","t":"You have advantage on saving throws against poison, and you have resistance against poison damage."},{"n":"Dwarven Combat Training","t":"You have proficiency with the battleaxe, handaxe, light hammer, and warhammer."},{"n":"Tool Proficiency","t":"You gain proficiency with the artisan's tools of your choice: smith's tools, brewer's supplies, or mason's tools."}]},{"n":"Elf (Drow)","ab":"Dexterity +2, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Superior Darkvision","t":"Accustomed to the depths of the Underdark, you have superior vision in dark and dim conditions. You can see in dim light..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Trance","t":"Elves don't need to sleep. Instead, they meditate deeply, remaining semiconscious, for 4 hours a day. (The Common word f..."}]},{"n":"Elf (Eladrin)","ab":"Dexterity +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Trance","t":"Elves don't need to sleep. Instead, they meditate deeply, remaining semiconscious, for 4 hours a day. (The Common word f..."}]},{"n":"Elf (High)","ab":"Dexterity +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Trance","t":"Elves don't need to sleep. Instead, they meditate deeply, remaining semiconscious, for 4 hours a day. (The Common word f..."}]},{"n":"Elf (Wood)","ab":"Dexterity +2, Wisdom +1","sz":"M","sp":"35","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Trance","t":"Elves don't need to sleep. Instead, they meditate deeply, remaining semiconscious, for 4 hours a day. (The Common word f..."}]},{"n":"Fairy","ab":"Dexterity +2","sz":"T","sp":"40","tr":[{"n":"Speed","t":"You have a normal walking speed of 10ft. You have a fly speed of 40 and you can hover if you are no more than 10ft off t..."},{"n":"Size","t":"You are Tiny. Pixies hardly reach over the height of 1 foot. For all intents and purposes the Tiny Players (5e Variant R..."},{"n":"Darkvision","t":"You're accustomed to living in forest and in undergrowth with dim or darker lighting. You can see in dim light as if bri..."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."}]},{"n":"Fairy","ab":"Dexterity +2","sz":"T","sp":"40","tr":[{"n":"Speed","t":"You have a normal walking speed of 10ft. You have a fly speed of 40 and you can hover if you are no more than 10ft off t..."},{"n":"Size","t":"You are Tiny. Pixies hardly reach over the height of 1 foot. For all intents and purposes the Tiny Players (5e Variant R..."},{"n":"Darkvision","t":"You're accustomed to living in forest and in undergrowth with dim or darker lighting. You can see in dim light as if bri..."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."}]},{"n":"Firbolg","ab":"Wisdom +2, Strength +1","sz":"M","sp":"30","tr":[{"n":"Firbolg Magic","t":"You can cast detect magic and disguise self with this trait, using Wisdom as your spellcasting ability for them. Once yo..."},{"n":"Hidden Step","t":"As a bonus action, you can magically turn invisible until the start of your next turn ot until you attack, make a damage..."},{"n":"Powerful Build","t":"You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift."},{"n":"Speech of Beast and Leaf","t":"You have the ability to communicate in a limited manner with beasts and plants. They can understand the meaning of your ..."}]},{"n":"Gavony Human","ab":"Strength +1, Dexterity +1, Constitution +1, Intelligence +1, Wisdom +1, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Languages","t":"You can speak, read, and write Common and one extra language of your choice.\n \nSource: Plane Shift: Innistrad, p. 8"}]},{"n":"Genasi (Air)","ab":"Constitution +2, Dexterity +1","sz":"M","sp":"30","tr":[{"n":"Unending Breath","t":"You can hold your breath indefinitely while you're not incapacitated."},{"n":"Mingle with the Wind","t":"You can cast the levitate spell once with this trait, requiring no material components, and you regain the ability to ca..."},{"n":"Languages","t":"You can speak, read, and write Common and Primordial. Primordial is a guttural language, filled with harsh syllables and..."}]},{"n":"Genasi (Earth)","ab":"Constitution +2, Strength +1","sz":"M","sp":"30","tr":[{"n":"Earth Walk","t":"You can move across difficult terrain made of earth or stone without expending extra movement."},{"n":"Merge with Stone","t":"You can cast the pass without trace spell once with this trait, requiring no material components, and you regain the abi..."},{"n":"Languages","t":"You can speak, read, and write Common and Primordial. Primordial is a guttural language, filled with harsh syllables and..."}]},{"n":"Genasi (Fire)","ab":"Constitution +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. Your..."},{"n":"Fire Resistance","t":"You have resistance to fire damage."},{"n":"Reach to the Blaze","t":"You know the produce flame cantrip. Once you reach 3rd level, you can cast the burning hands spell once with this trait ..."},{"n":"Languages","t":"You can speak, read, and write Common and Primordial. Primordial is a guttural language, filled with harsh syllables and..."}]},{"n":"Genasi (Water)","ab":"Constitution +2, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Acid Resistance","t":"You have resistance to acid damage."},{"n":"Amphibious","t":"You can breathe air and water."},{"n":"Swim","t":"You have a swimming speed of 30 feet."},{"n":"Call to the Wave","t":"You know the shape water cantrip. When you reach 3rd level, you can cast the create or destroy water spell as a 2nd-leve..."}]},{"n":"Gnome (Deep)","ab":"Intelligence +2, Dexterity +1","sz":"S","sp":"25","tr":[{"n":"Superior Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 120..."},{"n":"Gnome Cunning","t":"You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic."},{"n":"Stone Camouflage","t":"You have advantage on Dexterity (stealth) checks to hide in rocky terrain."},{"n":"Languages","t":"You can speak, read, and write Common, Gnomish, and Undercommon. The svirfneblin dialect is more guttural than surface G..."}]},{"n":"Gnome (Forest)","ab":"Intelligence +2, Dexterity +1","sz":"S","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Gnome Cunning","t":"You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic."},{"n":"Languages","t":"You can speak, read, and write Common and Gnomish. The Gnomish language, which uses the Dwarvish script, is renowned for..."},{"n":"Natural Illusionist","t":"You know the minor illusion cantrip. Intelligence is your spellcasting ability for it."}]},{"n":"Gnome (Rock)","ab":"Intelligence +2, Constitution +1","sz":"S","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Gnome Cunning","t":"You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic."},{"n":"Languages","t":"You can speak, read, and write Common and Gnomish. The Gnomish language, which uses the Dwarvish script, is renowned for..."},{"n":"Artificer's Lore","t":"Whenever you make an Intelligence (History) check related to magic items, alchemical objects, or technological devices, ..."}]},{"n":"Goblin","ab":"Dexterity +2, Constitution +1","sz":"S","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Fury of the Small","t":"When you damage a creature with an attack or a spell and the creature's size is larger than yours, you can cause the att..."},{"n":"Nimble Escape","t":"You can take the Disengage or Hide action as a bonus action on each of your turns."},{"n":"Languages","t":"You can speak, read, and write Common and Goblin."}]},{"n":"Goliath","ab":"Strength +2, Constitution +1","sz":"M","sp":"30","tr":[{"n":"Natural Athlete","t":"You have proficiency in the Athletics skill."},{"n":"Stone's Endurance","t":"You can focus yourself to occasionally shrug off injury. When you take damage, you can use your reaction to roll a d12. ..."},{"n":"Powerful Build","t":"You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift."},{"n":"Mountain Born","t":"You're acclimated to high altitude, including elevations above 20,000 feet. You're also naturally adapted to cold climat..."}]},{"n":"Grotag Goblin","ab":"Constitution +2","sz":"S","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Grit","t":"You have resistance to fire damage and psychic damage. In addition, when you are wearing no armor, your AC is equal to 1..."},{"n":"Grotag Tamer","t":"You have proficiency in the Animal Handling skill.\n \nSource: Plane Shift: Zendikar, p. 16"},{"n":"Languages","t":"You can speak, read, and write Common and Goblin.\n \nSource: Plane Shift: Zendikar, p. 16"}]},{"n":"Half-Elf","ab":"Charisma +2","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Two different ability scores of your choice increase by 1."},{"n":"Darkvision","t":"Thanks to your elf blood, you have superior vision in dark and dim conditions. You can see in dim light within 60 feet o..."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Skill Versatility","t":"You gain proficiency in two skills of your choice."}]},{"n":"Half-Elf (Aquatic Elf Descent)","ab":"Charisma +2","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Two different ability scores of your choice increase by 1."},{"n":"Darkvision","t":"Thanks to your elf blood, you have superior vision in dark and dim conditions. You can see in dim light within 60 feet o..."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Variant Feature (Choose 1)","t":"Keen Senses\nYou have proficiency in the Perception skill\n\nSwim\nYou gain a swimming speed of 30."}]},{"n":"Half-Elf (Drow Descent)","ab":"Charisma +2","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Two different ability scores of your choice increase by 1."},{"n":"Darkvision","t":"Thanks to your elf blood, you have superior vision in dark and dim conditions. You can see in dim light within 60 feet o..."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Variant Feature (Choose 1)","t":"Keen Senses\nYou have proficiency in the Perception skill\n\nDrow Magic\nYou know the dancing lights cantrip. When you reach..."}]},{"n":"Half-Elf (Moon Elf or Sun Elf Descent)","ab":"Charisma +2","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Two different ability scores of your choice increase by 1."},{"n":"Darkvision","t":"Thanks to your elf blood, you have superior vision in dark and dim conditions. You can see in dim light within 60 feet o..."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Variant Feature (Choose 1)","t":"Keen Senses\nYou have proficiency in the Perception skill\n\nElf Weapon Training\nYou have proficiency with the longsword, s..."}]},{"n":"Half-Elf (Wood Elf Descent)","ab":"Charisma +2","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Two different ability scores of your choice increase by 1."},{"n":"Darkvision","t":"Thanks to your elf blood, you have superior vision in dark and dim conditions. You can see in dim light within 60 feet o..."},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep."},{"n":"Variant Feature (Choose 1)","t":"Keen Senses\nYou have proficiency in the Perception skill\n\nElf Weapon Training\nYou have proficiency with the longsword, s..."}]},{"n":"Half-Orc","ab":"Strength +2, Constitution +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Thanks to your orc blood, you have superior vision in dark and dim conditions. You can see in dim light within 60 feet o..."},{"n":"Menacing","t":"You gain proficiency in the Intimidation skill."},{"n":"Relentless Endurance","t":"When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead. You can't use this fe..."},{"n":"Savage Attacks","t":"When you score a critical hit with a melee weapon attack, you can roll one of the weapon's damage dice one additional ti..."}]},{"n":"Halfling (Ghostwise)","ab":"Dexterity +2, Wisdom +1","sz":"S","sp":"25","tr":[{"n":"Lucky","t":"When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll."},{"n":"Brave","t":"You have advantage on saving throws against being frightened."},{"n":"Halfling Nimbleness","t":"You can move through the space of any creature that is of a size larger than yours."},{"n":"Languages","t":"You can speak, read, and write Common and Halfling. The Halfling language isn't secret, but halflings are loath to share..."}]},{"n":"Halfling (Lightfoot)","ab":"Dexterity +2, Charisma +1","sz":"S","sp":"25","tr":[{"n":"Lucky","t":"When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll."},{"n":"Brave","t":"You have advantage on saving throws against being frightened."},{"n":"Halfling Nimbleness","t":"You can move through the space of any creature that is of a size larger than yours."},{"n":"Languages","t":"You can speak, read, and write Common and Halfling. The Halfling language isn't secret, but halflings are loath to share..."}]},{"n":"Halfling (Stout)","ab":"Dexterity +2, Constitution +1","sz":"S","sp":"25","tr":[{"n":"Lucky","t":"When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll."},{"n":"Brave","t":"You have advantage on saving throws against being frightened."},{"n":"Halfling Nimbleness","t":"You can move through the space of any creature that is of a size larger than yours."},{"n":"Languages","t":"You can speak, read, and write Common and Halfling. The Halfling language isn't secret, but halflings are loath to share..."}]},{"n":"Hawk-Headed Aven","ab":"Dexterity +2, Wisdom +2","sz":"M","sp":"25","tr":[{"n":"Flight","t":"You have a flying speed of 30 feet. You can’t use your flying speed while you wear medium or heavy armor. (If your campa..."},{"n":"Hawkeyed","t":"You have proficiency in the Perception skill. In addition, attacking at long range doesn’t impose disadvantage on your r..."},{"n":"Languages","t":"You can speak, read, and write Common and Aven.\n \nSource: Plane Shift: Amonkhet, p. 16"}]},{"n":"High Elf","ab":"Dexterity +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Languages","t":"You can speak, read, and write Common and Elvish. Elvish is fluid, with subtle intonations and intricate grammar. Elven ..."},{"n":"Extra Language","t":"You can speak, read, and write one extra language of your choice."},{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill."}]},{"n":"Hill Dwarf","ab":"Constitution +2, Wisdom +1","sz":"M","sp":"25","tr":[{"n":"Languages","t":"You can speak, read, and write Common and Dwarvish. Dwarvish is full of hard consonants and guttural sounds, and those c..."},{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Dwarven Resilience","t":"You have advantage on saving throws against poison, and you have resistance against poison damage."},{"n":"Dwarven Combat Training","t":"You have proficiency with the battleaxe, handaxe, light hammer, and warhammer."}]},{"n":"Hobgoblin","ab":"Constitution +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Martial Training","t":"You are proficient with two martial weapons of your choice and with light armor."},{"n":"Saving Face","t":"Hobgoblins are careful not to show weakness in front of their allies, for fear of losing status. If you miss with an att..."},{"n":"Languages","t":"You can speak, read, and write Common and Goblin."}]},{"n":"Human","ab":"Strength +1, Dexterity +1, Constitution +1, Intelligence +1, Wisdom +1, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Languages","t":"You can speak, read, and write Common and one extra language of your choice. Humans typically learn the languages of oth..."}]},{"n":"Human (Variant)","ab":"","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Two different ability scores of your choice increase by 1."},{"n":"Skills","t":"You gain proficiency in one skill of your choice."},{"n":"Feat","t":"You gain one feat of your choice."},{"n":"Languages","t":"You can speak, read, and write Common and one extra language of your choice. Humans typically learn the languages of oth..."}]},{"n":"Ibis-Headed Aven","ab":"Dexterity +2, Intelligence +1","sz":"M","sp":"25","tr":[{"n":"Flight","t":"You have a flying speed of 30 feet. You can’t use your flying speed while you wear medium or heavy armor. (If your campa..."},{"n":"Kefnet’s Blessing","t":"You can add half your proficiency bonus, rounded down, to any Intelligence check you make that doesn’t already include y..."},{"n":"Languages","t":"You can speak, read, and write Common and Aven.\n \nSource: Plane Shift: Amonkhet, p. 16"}]},{"n":"Joraga Elf","ab":"Wisdom +2, Dexterity +1","sz":"M","sp":"35","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill.\n \nSource: Plane Shift: Zendikar, p. 18"},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can’t put you to sleep.\n \nSource: Plane Shift: Zend..."},{"n":"Elf Weapon Training","t":"You have proficiency with the longsword, shortsword, shortbow, and longbow.\n \nSource: Plane Shift: Zendikar, p. 19"}]},{"n":"Kaladesh Dwarf","ab":"Constitution +2, Wisdom +1","sz":"M","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground in your race’s ancient past, you have superior vision in dark and dim conditions. You can..."},{"n":"Dwarven Resilience","t":"You have advantage on saving throws against poison, and you have resistance against poison damage.\n \nSource: Plane Shift..."},{"n":"Dwarven Toughness","t":"Your hit point maximum increases by 1, and it increases by 1 every time you gain a level. \n \nSource: Plane Shift: Kalade..."},{"n":"Artisan’s Expertise","t":"You gain proficiency with two kinds of artisan’s tools of your choice. Your proficiency bonus is doubled for any ability..."}]},{"n":"Kalashtar","ab":"Wisdom +1, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"One ability score of your choice increases by 1.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"},{"n":"Dual Mind","t":"When you make a Wisdom saving throw, you can use your reaction to gain advantage on the roll. You can use this trait imm..."},{"n":"Mental Discipline","t":"You have resistance to psychic damage.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"},{"n":"Mind Link","t":"You can speak telepathically to any creature you can see within 60 feet of you. You don’t need to share a language with ..."}]},{"n":"Kenku","ab":"Dexterity +2, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Expert Forgery","t":"You can duplicate other creatures' handwriting and craftwork. You have advantage on all checks made to produce forgeries..."},{"n":"Kenku Training","t":"You are proficient in your choice of two of the following skills: Acrobatics, Deception, Stealth, and Sleight of Hand."},{"n":"Mimicry","t":"You can mimic sounds you have heard, including voices. A creature that hears the sounds can tell they are imitations wit..."},{"n":"Languages","t":"You can read and write Common and Auran, but you can speak only using your Mimicry trait"}]},{"n":"Kessig Human","ab":"Dexterity +1, Wisdom +1","sz":"M","sp":"40","tr":[{"n":"Forest Folk","t":"You have proficiency in the Survival skill.\n \nSource: Plane Shift: Innistrad, p. 8"},{"n":"Fleet of Foot","t":"Your base walking speed is 40 feet.\n \nSource: Plane Shift: Innistrad, p. 8"},{"n":"Sure-Footed","t":"When you use the Dash action, difficult terrain doesn’t cost you extra movement on that turn.\n \nSource: Plane Shift: Inn..."},{"n":"Spring Attack","t":"When you make a melee attack against a creature, you don’t provoke opportunity attacks from that creature for the rest o..."}]},{"n":"Khenra","ab":"Dexterity +2, Strength +1","sz":"M","sp":"35","tr":[{"n":"Khenra Weapon Training","t":"You have proficiency with the khopesh, spear, and javelin.\n \nSource: Plane Shift: Amonkhet, p. 18"},{"n":"Khenra Twins","t":"If your twin is alive and you can see your twin, whenever you roll a 1 on an attack roll, ability check, or saving throw..."},{"n":"Languages","t":"You can speak, read, and write Common and Khenra.\n \nSource: Plane Shift: Amonkhet, p. 18"}]},{"n":"Kobold","ab":"Dexterity +2, Strength -2","sz":"S","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Grovel, Cower, and Beg","t":"As an action on your turn, you can cower pathetically to distract nearby foes. Until the end of your next turn, your all..."},{"n":"Pack Tactics","t":"You have advantage on an attack roll against a creature if at least one of your allies is within 5 feet of the creature ..."},{"n":"Sunlight Sensitivity","t":"You have disadvantage on attack rolls and on Wisdom (Perception) checks that rely on sight when you, the target of your ..."}]},{"n":"Kor","ab":"Dexterity +2, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Kor Climbing","t":"You have a climb speed of 30 feet as long as you are not encumbered or wearing heavy armor. You have proficiency with th..."},{"n":"Lucky","t":"When you roll a 1 on the d20 for an attack roll, ability check, or saving throw, you can reroll the die and must use the..."},{"n":"Brave","t":"You have advantage on saving throws against being frightened.\n \nSource: Plane Shift: Zendikar, p. 11"},{"n":"Languages","t":"You can speak, read, and write Common, and communicate in the silent speech of the kor.\n \nSource: Plane Shift: Zendikar,..."}]},{"n":"Lavastep Goblin","ab":"Constitution +2","sz":"S","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Grit","t":"You have resistance to fire damage and psychic damage. In addition, when you are wearing no armor, your AC is equal to 1..."},{"n":"Lavastep Grit","t":"You have advantage on Dexterity (Stealth) checks made to hide in rocky or subterranean environments.\n \nSource: Plane Shi..."},{"n":"Languages","t":"You can speak, read, and write Common and Goblin.\n \nSource: Plane Shift: Zendikar, p. 16"}]},{"n":"Lightfoot Halfling","ab":"Dexterity +2, Charisma +1","sz":"S","sp":"25","tr":[{"n":"Languages","t":"You can speak, read, and write Common and Halfling. The Halfling language isn’t secret, but halflings are loath to share..."},{"n":"Lucky","t":"When you roll a 1 on the d20 for an attack roll, ability check, or saving throw, you can reroll the die and must use the..."},{"n":"Brave","t":"You have advantage on saving throws against being frightened."},{"n":"Halfling Nimbleness","t":"You can move through the space of any creature that is of a size larger than yours."}]},{"n":"Lizardfolk","ab":"Constitution +2, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Swim Speed","t":"You have a swimming speed of 30 feet."},{"n":"Bite","t":"Your fanged maw is a natural weapon, which you can use to make unarmed strikes. If you hit with it, you deal piercing da..."},{"n":"Cunning Artisan","t":"As part of a short rest, you can harvest bone and hide from a slain beast, construct, dragon, monstrosity, or plant crea..."},{"n":"Hold Breath","t":"You can hold your breath for up to 15 minutes at a time."}]},{"n":"Longtooth Shifter","ab":"Dexterity +1, Strength +2","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You have superior vision in dark and dim conditions. You can see in dim light within 60 feet of you as if it were bright..."},{"n":"Keen Senses","t":"You have proficiency with the Perception skill.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"},{"n":"Shifting","t":"As a bonus action, you can assume a more bestial appearance. This transformation lasts for 1 minute, until you die, or u..."},{"n":"Languages","t":"You can speak, read, and write Common.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"}]},{"n":"Mark of Detection Half-Elf","ab":"Intelligence +1, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"One ability score of your choice increases by 1.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"},{"n":"Deductive Intuition","t":"When you make an Intelligence (Investigation) or Wisdom (Insight) check, you can roll one Intuition die, a d4, and add t..."},{"n":"Sense Threats","t":"You can cast the detect magic and detect poison and disease spells, but only as rituals. Intelligence is your spellcasti..."},{"n":"Languages","t":"You can speak, read, and write Common and Elvish.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"Mark of Finding Half-Orc","ab":"Strength +1, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"One ability score of your choice increases by 1.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"},{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Hunter's Intuition","t":"Your mark sharpens your senses and helps you find your prey. When you make a Wisdom (Perception) or Wisdom (Survival) ch..."},{"n":"Imprint Prey","t":"As a bonus action, choose one creature you can see within 30 feet of you. The target is imprinted in your mind until it ..."}]},{"n":"Mark of Finding Human","ab":"Dexterity +1, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"One ability score of your choice increases by 1.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"},{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Hunter's Intuition","t":"Your mark sharpens your senses and helps you find your prey. When you make a Wisdom (Perception) or Wisdom (Survival) ch..."},{"n":"Imprint Prey","t":"As a bonus action, choose one creature you can see within 30 feet of you. The target is imprinted in your mind until it ..."}]},{"n":"Mark of Handling Human","ab":"Dexterity +1, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"One ability score of your choice increases by 1.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"},{"n":"Wild Intuition","t":"When you make a Wisdom (Animal Handling) or Intelligence (Nature) check, you can roll one Intuition die, a d4, and add t..."},{"n":"Expert Handling","t":"You can use the Help action to aid an ally animal companion or mount within 30 feet of you, rather than 5 feet of you.\n ..."},{"n":"Primal Connection","t":"You can cast animal friendship once with this trait and regain the ability to do so when you finish a short or long rest..."}]},{"n":"Mark of Healing Halfling","ab":"Dexterity +2, Wisdom +1","sz":"S","sp":"25","tr":[{"n":"Lucky","t":"When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll.\n ..."},{"n":"Brave","t":"You have advantage on saving throws against being frightened.\n \nSource: Player's Handbook, p. 28"},{"n":"Halfling Nimbleness","t":"You can move through the space of any creature that is of a size larger than yours.\n \nSource: Player's Handbook, p. 28"},{"n":"Languages","t":"You can speak, read, and write Common and Halfling. The Halfling language isn't secret, but halflings are loath to share..."}]},{"n":"Mark of Hospitality Halfling","ab":"Dexterity +2, Charisma +1","sz":"S","sp":"25","tr":[{"n":"Lucky","t":"When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll.\n ..."},{"n":"Brave","t":"You have advantage on saving throws against being frightened.\n \nSource: Player's Handbook, p. 28"},{"n":"Halfling Nimbleness","t":"You can move through the space of any creature that is of a size larger than yours.\n \nSource: Player's Handbook, p. 28"},{"n":"Languages","t":"You can speak, read, and write Common and Halfling. The Halfling language isn't secret, but halflings are loath to share..."}]},{"n":"Mark of Making Human","ab":"Intelligence +1, Dexterity +1","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"Increase either Intelligence or Dexterity by an additional 1 point.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"},{"n":"Artisan's Intuition","t":"When you make an ability check with artisan’s tools, roll 1d4 and add it to the result.\n \nSource: Wayfinder's Guide to E..."},{"n":"Maker's Gift","t":"You know the cantrip mending and gain proficiency with one type of artisan’s tools\n \nSource: Wayfinder's Guide to Eberro..."},{"n":"Magecraft","t":"You can create a temporary magic item out of common materials. Choose a cantrip from the wizard spell list. Describe the..."}]},{"n":"Mark of Passage Human","ab":"Dexterity +2","sz":"M","sp":"40","tr":[{"n":"Ability Score Increase","t":"One ability score of your choice increases by 1.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"},{"n":"Courier's Speed","t":"Your base walking speed increases to 40 ft.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"},{"n":"Intuitive Motion","t":"When you make a Strength (Athletics) check or any ability check to operate or maintain a land vehicle, you can roll one ..."},{"n":"Orien's Grace","t":"When you use the Dash action, difficult terrain doesn’t cost you extra movement on that turn.\n \nSource: Wayfinder's Guid..."}]},{"n":"Mark of Scribing Gnome","ab":"Intelligence +2, Charisma +1","sz":"S","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Gnome Cunning","t":"You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic.\n \nSource: Player's Handbook, p..."},{"n":"Languages","t":"You can speak, read, and write Common and Gnomish. The Gnomish language, which uses the Dwarvish script, is renowned for..."},{"n":"Gifted Scribe","t":"You are proficient with calligrapher’s supplies and the forgery kit. When you make an ability check using either one of ..."}]},{"n":"Mark of Sentinel Human","ab":"Strength +1, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"One ability score of your choice increases by 1.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"},{"n":"Sentinel's Intuition","t":"When you roll for Initiative or make a Wisdom (Perception) check to notice a threat, you can roll one Intuition die, a d..."},{"n":"Sentinel's Shield","t":"You know the cantrip blade ward. You can cast shield once with this trait and regain the ability to do so after you fini..."},{"n":"Vigilant Guardian","t":"As an action, you can designate an ally you can see as your ward. You have advantage on Wisdom (Insight) and Wisdom (Per..."}]},{"n":"Mark of Shadow Elf","ab":"Dexterity +2, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill.\n \nSource: Player's Handbook, p. 23"},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can't put you to sleep.\n \nSource: Player's Handbook..."},{"n":"Trance","t":"Elves don't need to sleep. Instead, they meditate deeply, remaining semiconscious, for 4 hours a day. (The Common word f..."}]},{"n":"Mark of Storm Half-Elf","ab":"Dexterity +1, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Ability Score Increase","t":"One ability score of your choice increases by 1.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"},{"n":"Sea Monkey","t":"Your base walking speed is 30 feet, and you have a swim speed of 30 feet.\n \nSource: Wayfinder's Guide to Eberron, Chapte..."},{"n":"Windwright's Intuition","t":"When you make a Dexterity (Acrobatics) check or any ability check involving operating or maintaining a water or air vehi..."},{"n":"Storm's Blessing","t":"You have resistance to lightning damage.\n \nSource: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"Mark of Warding Dwarf","ab":"Constitution +2, Dexterity +1, Intelligence +1","sz":"M","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Dwarven Resilience","t":"You have advantage on saving throws against poison, and you have resistance against poison damage.\n \nSource: Player's Ha..."},{"n":"Dwarven Combat Training","t":"You have proficiency with the battleaxe, handaxe, light hammer, and warhammer.\n \nSource: Player's Handbook, p. 20"},{"n":"Tool Proficiency","t":"You gain proficiency with the artisan's tools of your choice: smith's tools, brewer's supplies, or mason's tools.\n \nSour..."}]},{"n":"Minotaur","ab":"Strength +2, Constitution +1","sz":"M","sp":"40","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Powerful Build","t":"You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift"},{"n":"Monstrous Reputation","t":"Due to their massive build and blood covered ancestry, minotaurs have proficiency on Intimidation."},{"n":"Gore","t":"A minotaur can make an attack with his horns, causing 1d8 piercing damage plus his Strength modifier.  If the target is ..."}]},{"n":"Mul Daya Elf","ab":"Wisdom +2, Strength +1","sz":"M","sp":"30","tr":[{"n":"Superior Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill.\n \nSource: Plane Shift: Zendikar, p. 18"},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can’t put you to sleep.\n \nSource: Plane Shift: Zend..."},{"n":"Sunlight Sensitivity","t":"You have disadvantage on attack rolls and on Wisdom (Perception) checks that rely on sight when you, the target of your ..."}]},{"n":"Nephalia Human","ab":"Intelligence +1, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Breadth of Knowledge","t":"You gain proficiency in any combination of four skills or with four tools of your choice.\n \nSource: Plane Shift: Innistr..."},{"n":"Languages","t":"You can speak, read, and write Common and one extra language of your choice.\n \nSource: Plane Shift: Innistrad, p. 8"}]},{"n":"Orc","ab":"Strength +2, Constitution +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Aggressive","t":"As a bonus action, you can move up to your movement speed toward a hostile creature you can see or hear. You must end th..."},{"n":"Menacing","t":"You are trained in the Intimidation skill.\n \nSource: Volo's Guide to Monsters, p. 120"},{"n":"Powerful Build","t":"You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift.\n \nSourc..."}]},{"n":"Orc (Uruck-High)","ab":"Strength +2, Constitution +2, Intelligence -2","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Aggressive","t":"As a bonus action, you can move up to your movement speed toward a hostile creature you can see or hear. You must end th..."},{"n":"Menacing","t":"You are trained in the Intimidation skill."},{"n":"Powerful Build","t":"You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift."}]},{"n":"Orc (Uruck-High)","ab":"Strength +2, Constitution +2, Intelligence -2","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Aggressive","t":"As a bonus action, you can move up to your movement speed toward a hostile creature you can see or hear. You must end th..."},{"n":"Menacing","t":"You are trained in the Intimidation skill."},{"n":"Powerful Build","t":"You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift."}]},{"n":"Rock Gnome","ab":"Intelligence +2, Constitution +1","sz":"S","sp":"25","tr":[{"n":"Languages","t":"You can speak, read, and write Common and Gnomish. The Gnomish language, which uses the Dwarvish script, is renowned for..."},{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Gnome Cunning","t":"You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic."},{"n":"Artificer’s Lore","t":"Whenever you make an Intelligence (History) check related to magic items, alchemical objects, or technological devices, ..."}]},{"n":"Shifter (Razorclaw)","ab":"Dexterity +2","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Your lycanthropic heritage grants you the ability to see in dark conditions. You can see in dim light within 60 feet of ..."},{"n":"Shifting","t":"On your turn, you can shift as a bonus action. Shifting lasts for 1 minute or until you end it on your turn as a bonus a..."},{"n":"Languages","t":"You can speak, read, and write Common and Sylvan."},{"n":"Shifting Feature","t":"While shifting, you can make an unarmed strike as a bonus action. You can use your Dexterity for its attack roll and dam..."}]},{"n":"Shifter (Wildhunt)","ab":"Dexterity +1, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Your lycanthropic heritage grants you the ability to see in dark conditions. You can see in dim light within 60 feet of ..."},{"n":"Shifting","t":"On your turn, you can shift as a bonus action. Shifting lasts for 1 minute or until you end it on your turn as a bonus a..."},{"n":"Languages","t":"You can speak, read, and write Common and Sylvan."},{"n":"Shifting Feature","t":"While shifting, you gain advantage on all Wisdom-based checks and saving throws."}]},{"n":"Stensia Human","ab":"Strength +1, Constitution +1","sz":"M","sp":"30","tr":[{"n":"Daunting","t":"You have proficiency in the Intimidation skill.\n \nSource: Plane Shift: Innistrad, p. 8"},{"n":"Tough","t":"Your hit point maximum increases by 2, and it increases by 2 every time you gain a level.\n \nSource: Plane Shift: Innistr..."},{"n":"Languages","t":"You can speak, read, and write Common and one extra language of your choice.\n \nSource: Plane Shift: Innistrad, p. 8"}]},{"n":"Swiftstride Shifter","ab":"Dexterity +2, Charisma +1","sz":"M","sp":"35","tr":[{"n":"Darkvision","t":"You have superior vision in dark and dim conditions. You can see in dim light within 60 feet of you as if it were bright..."},{"n":"Keen Senses","t":"You have proficiency with the Perception skill.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"},{"n":"Shifting","t":"As a bonus action, you can assume a more bestial appearance. This transformation lasts for 1 minute, until you die, or u..."},{"n":"Languages","t":"You can speak, read, and write Common.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"}]},{"n":"Tabaxi","ab":"Dexterity +2, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You have a cat's keen senses, especially in the dark. You can see in dim light within 60 feet of you as if it were brigh..."},{"n":"Feline Agility","t":"Your reflexes and agility allow you to move with a burst of speed. When you move on your turn in combat, you can double ..."},{"n":"Cat's Claws","t":"Because of your claws, you have a climbing speed of 20 feet. In addition, your claws are natural weapons, which you can ..."},{"n":"Cat's Talents","t":"You have proficiency in the Perception and Stealth skills."}]},{"n":"Tajuru Elf","ab":"Wisdom +2, Charisma +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill.\n \nSource: Plane Shift: Zendikar, p. 18"},{"n":"Fey Ancestry","t":"You have advantage on saving throws against being charmed, and magic can’t put you to sleep.\n \nSource: Plane Shift: Zend..."},{"n":"Skill Versatility","t":"You gain proficiency in any combination of two skills or tools of your choice\n \nSource: Plane Shift: Zendikar, p. 19"}]},{"n":"Tiefling","ab":"Intelligence +1, Charisma +2","sz":"M","sp":"30","tr":[{"n":"Languages","t":"You can speak, read, and write Common and Infernal."},{"n":"Darkvision","t":"Thanks to your infernal heritage, you have superior vision in dark and dim conditions. You can see in dim light within 6..."},{"n":"Hellish Resistance","t":"You have resistance to fire damage."},{"n":"Infernal Legacy","t":"You know the thaumaturgy cantrip. When you reach 3rd level, you can cast the hellish rebuke spell as a 2nd level spell o..."}]},{"n":"Tiefling (Infernal)","ab":"Charisma +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Thanks to your infernal heritage, you have superior vision in dark and dim conditions. You can see in dim light within 6..."},{"n":"Hellish Resistance","t":"You have resistance to fire damage."},{"n":"Infernal Legacy","t":"You know the thaumaturgy cantrip. Once you reach 3rd level, you can cast the hellish rebuke spell as a 2nd-level spell; ..."},{"n":"Languages","t":"You can speak, read, and write Common and Infernal."}]},{"n":"Tirahar Elf","ab":"Dexterity +2, Wisdom +1","sz":"M","sp":"35","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill.\n \nSource: Plane Shift: Kaladesh, p. 21"},{"n":"Elf Weapon Training","t":"You have proficiency with the longsword, shortsword, shortbow, and longbow. Fey Ancestry. You have advantage on saving t..."},{"n":"Trance","t":"Elves don’t need to sleep. Instead, they meditate deeply, remaining semiconscious, for 4 hours a day. (The Common word f..."}]},{"n":"Trickster-Creed Merfolk","ab":"Charisma +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Amphibious","t":"You have a swim speed of 30 feet. You can breathe air and water.\n \nSource: Plane Shift: Zendikar, p. 13"},{"n":"Creed of the Trickster","t":"You have proficiency in the Sleight of Hand and Stealth skills.\n \nSource: Plane Shift: Zendikar, p. 13"},{"n":"Cantrip","t":"You know one cantrip of your choice from the bard spell list. Charisma is your spellcasting ability for it.\n \nSource: Pl..."},{"n":"Languages","t":"You can speak, read, and write Common, Merfolk, and one extra language of your choice.\n \nSource: Plane Shift: Zendikar, ..."}]},{"n":"Triton","ab":"Strength +1, Charisma +1, Constitution +1","sz":"M","sp":"30","tr":[{"n":"Swim Speed","t":"You have a swimming speed of 30 feet."},{"n":"Amphibious","t":"You can breathe air and water."},{"n":"Control Air and Water","t":"A child of the sea, you can call on the magic of elemental air and water. You can cast fog cloud with this trait. Starti..."},{"n":"Emissary of the Sea","t":"Aquatic beasts have an extraordinary affinity with your people. You can communicate simple ideas with beasts that can br..."}]},{"n":"Tuktuk Goblin","ab":"Constitution +2","sz":"S","sp":"25","tr":[{"n":"Darkvision","t":"Accustomed to life underground, you have superior vision in dark and dim conditions. You can see in dim light within 60 ..."},{"n":"Grit","t":"You have resistance to fire damage and psychic damage. In addition, when you are wearing no armor, your AC is equal to 1..."},{"n":"Tuktuk Cunning","t":"You have proficiency with thieves’ tools.\n \nSource: Plane Shift: Zendikar, p. 16"},{"n":"Languages","t":"You can speak, read, and write Common and Goblin.\n \nSource: Plane Shift: Zendikar, p. 16"}]},{"n":"Vahadar Elf","ab":"Dexterity +2, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Accustomed to twilit forests and the night sky, you have superior vision in dark and dim conditions. You can see in dim ..."},{"n":"Keen Senses","t":"You have proficiency in the Perception skill.\n \nSource: Plane Shift: Kaladesh, p. 21"},{"n":"Elf Weapon Training","t":"You have proficiency with the longsword, shortsword, shortbow, and longbow. Fey Ancestry. You have advantage on saving t..."},{"n":"Trance","t":"Elves don’t need to sleep. Instead, they meditate deeply, remaining semiconscious, for 4 hours a day. (The Common word f..."}]},{"n":"Vedalken","ab":"Intelligence +2, Wisdom +1","sz":"M","sp":"30","tr":[{"n":"Vedalken Cunning","t":"You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic.\n \nSource: Plane Shift: Kalades..."},{"n":"Aether Lore","t":"Whenever you make an Intelligence (History) check related to magic items or aether-powered technological devices, you ca..."},{"n":"Languages","t":"You can speak, read, and write Common and Vedalken. The Vedalken language is renowned for its technical treatises and it..."}]},{"n":"Warforged Envoy","ab":"Constitution +1","sz":"M","sp":"30","tr":[{"n":"Warforged Resilience","t":"You were created to have remarkable fortitude, represented by the following benefits.\n\t \n• You have advantage on saving ..."},{"n":"Sentry's Rest","t":"When you take a long rest, you must spend at least six hours in an inactive, motionless state, rather than sleeping. In ..."},{"n":"Intergrated Protection","t":"Your body has built-in defensive layers, which determine your armor class. You gain no benefit from wearing armor, but i..."},{"n":"Languages","t":"You can speak, read, and write Common.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"}]},{"n":"Warforged Juggernaut","ab":"Constitution +1, Strength +2","sz":"M","sp":"30","tr":[{"n":"Warforged Resilience","t":"You were created to have remarkable fortitude, represented by the following benefits.\n\t \n• You have advantage on saving ..."},{"n":"Sentry's Rest","t":"When you take a long rest, you must spend at least six hours in an inactive, motionless state, rather than sleeping. In ..."},{"n":"Intergrated Protection","t":"Your body has built-in defensive layers, which determine your armor class. You gain no benefit from wearing armor, but i..."},{"n":"Languages","t":"You can speak, read, and write Common.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"}]},{"n":"Warforged Skirmisher","ab":"Constitution +1, Dexterity +2","sz":"M","sp":"30","tr":[{"n":"Warforged Resilience","t":"You were created to have remarkable fortitude, represented by the following benefits.\n\t \n• You have advantage on saving ..."},{"n":"Sentry's Rest","t":"When you take a long rest, you must spend at least six hours in an inactive, motionless state, rather than sleeping. In ..."},{"n":"Intergrated Protection","t":"Your body has built-in defensive layers, which determine your armor class. You gain no benefit from wearing armor, but i..."},{"n":"Languages","t":"You can speak, read, and write Common.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"}]},{"n":"Water-Creed Merfolk","ab":"Charisma +1, Intelligence +2","sz":"M","sp":"30","tr":[{"n":"Amphibious","t":"You have a swim speed of 30 feet. You can breathe air and water.\n \nSource: Plane Shift: Zendikar, p. 13"},{"n":"Water Creed Navigation","t":"You have proficiency with navigator’s tools and in the Survival skill.\n \nSource: Plane Shift: Zendikar, p. 13"},{"n":"Cantrip","t":"You know one cantrip of your choice from the wizard spell list. Intelligence is your spellcasting ability for it.\n \nSour..."},{"n":"Languages","t":"You can speak, read, and write Common, Merfolk, and one extra language of your choice.\n \nSource: Plane Shift: Zendikar, ..."}]},{"n":"Wildhunt Shifter","ab":"Dexterity +1, Wisdom +2","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You have superior vision in dark and dim conditions. You can see in dim light within 60 feet of you as if it were bright..."},{"n":"Keen Senses","t":"You have proficiency with the Perception skill.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"},{"n":"Shifting","t":"As a bonus action, you can assume a more bestial appearance. This transformation lasts for 1 minute, until you die, or u..."},{"n":"Languages","t":"You can speak, read, and write Common.\n \nSource: Wayfinder's Guide to Eberron, Chapter 3"}]},{"n":"Wind-Creed Merfolk","ab":"Charisma +1, Wisdom +2","sz":"M","sp":"30","tr":[{"n":"Amphibious","t":"You have a swim speed of 30 feet. You can breathe air and water.\n \nSource: Plane Shift: Zendikar, p. 13"},{"n":"Wind Creed Manipulation","t":"You have proficiency in the Deception and Persuasion skills.\n \nSource: Plane Shift: Zendikar, p. 13"},{"n":"Cantrip","t":"You know one cantrip of your choice from the druid spell list. Wisdom is your spellcasting ability for it.\n \nSource: Pla..."},{"n":"Languages","t":"You can speak, read, and write Common, Merfolk, and one extra language of your choice.\n \nSource: Plane Shift: Zendikar, ..."}]},{"n":"Yuan-ti Pureblood","ab":"Charisma +2, Intelligence +1","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You ..."},{"n":"Innate Spellcasting","t":"You know the poison spray cantrip. You can cast animal friendship an unlimited number of times with this trait, but you ..."},{"n":"Magic Resistance","t":"You have advantage on saving throws against spells and other magical effects."},{"n":"Poison Immunity","t":"You are immune to poison damage and the poisoned condition."}]},{"n":"Zendikar Vampire","ab":"Intelligence +1, Charisma +2","sz":"M","sp":"30","tr":[{"n":"Darkvision","t":"Thanks to your heritage, you have superior vision in dark and dim conditions. You can see in dim light within 60 feet of..."},{"n":"Vampiric Resistance","t":"You have resistance to necrotic damage.\n \nSource: Plane Shift: Zendikar, p. 15"},{"n":"Blood Thirst","t":"You can drain blood and life energy from a willing creature, or one that is grappled by you, incapacitated, or restraine..."},{"n":"Languages","t":"You can speak, read, and write Common and Vampire.\n \nSource: Plane Shift: Zendikar, p. 15"}]}],"classes":[{"n":"Artificer","hd":"8","pf":"Constitution, Intelligence","sa":"Intelligence","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a hand axe and"},{"n":"Artificer Specialist","t":"At 1st level, you choose the type of Artificer Specialist you are: Alchemist or Gunsmith, both of wh"},{"n":"Magic Item Analysis","t":"Starting at 1st level, your understanding of magic items allows you to analyze and understand their "},{"n":"Artificer Specialist: Alchemist","t":"An alchemist is an expert at combining exotic reagents to produce a variety of materials, from heali"}]},{"n":"Barbarian","hd":"12","pf":"Strength, Constitution","sa":"","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a greataxe or "},{"n":"Rage","t":"In battle, you fight with primal ferocity. On your turn, you can enter a rage as a bonus action.\n   "},{"n":"Unarmored Defense","t":"While you are not wearing any armor, your Armor Class equals 10 + your Dexterity modifier + your Con"}]},{"n":"Bard","hd":"8","pf":"Dexterity, Charisma","sa":"Charisma","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a rapier, (b) "},{"n":"Bardic Inspiration","t":"You can inspire others through stirring words or music. To do so, you use a bonus action on your tur"},{"n":"Spellcasting","t":"You have learned to untangle and reshape the fabric of reality in harmony with your wishes and music"}]},{"n":"Blood Hunter","hd":"10","pf":"Strength, Wisdom","sa":"Wisdom","f1":[{"n":"Starting Proficiencies","t":"Armor: Light armor, medium armor, shields\nWeapons: Simple weapons, martial weapons\nTools: Alchemist’"},{"n":"Starting Equipment","t":"You start with the following equipment, in addition to the equipment granted by your background:\n\n(a"},{"n":"Hunter's Bane","t":"Beginning at 1st level, you have survived the imbibing of the Hunter’s Bane, a poisonous alchemical "},{"n":"Crimson Rite","t":"At 1st level, you learn to invoke a rite of blood magic within your weapon at the cost of your own v"},{"n":"Primal Rites","t":"Choose from the following:\n\nRite of the Roar, Rite of the Oracle, Rite of the Dead or Rite of the Ru"}]},{"n":"Cleric","hd":"8","pf":"Wisdom, Charisma","sa":"Wisdom","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a mace or (b) "},{"n":"Spellcasting","t":"As a conduit for divine power, you can cast cleric spells. See chapter 10 for the general rules of s"},{"n":"Divine Domain","t":"Choose one domain related to your deity: Arcana, Knowledge, Life, Light, Nature, Tempest, Trickery, "},{"n":"Divine Domain Arcana","t":"Magic is an energy that suffuses the multiverse and that fuels both destruction and creation. Gods o"}]},{"n":"Cleric of the Five Gods","hd":"8","pf":"Wisdom, Charisma, History, Insight, Medicine, Persuasion, Religion","sa":"Wisdom","f1":[{"n":"Starting Cleric of the Five Gods","t":"As a 1st-level Cleric of the Five Gods, you begin play with 8+your Constitution modifier hit points."},{"n":"Multiclass Cleric of the Five Gods","t":"To multiclass as a Cleric of the Five Gods, you must meet the following prerequisites:\n• Wisdom 13\n "},{"n":"Spellcasting","t":"As a conduit for divine power, you can cast cleric spells. See chapter 10 for the general rules of s"},{"n":"Divine Domain","t":"Choose one domain related to your deity: Knowledge, Life, Light, Nature, Tempest, Trickery, or War. "},{"n":"Divine Domain: Solidarity Domain (Oketra)","t":"The worthy must know and respect all others whom the God-Pharaoh deems worthy, for in the afterlife,"}]},{"n":"Druid","hd":"8","pf":"Intelligence, Wisdom","sa":"Wisdom","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a wooden shiel"},{"n":"Druidic","t":"You know Druidic, the secret language of druids. You can speak the language and use it to leave hidd"},{"n":"Spellcasting","t":"Drawing on the divine essence of nature itself, you can cast spells to shape that essence to your wi"}]},{"n":"Fighter","hd":"10","pf":"Strength, Constitution","sa":"Intelligence","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) chain mail or "},{"n":"Fighting Style","t":"You adopt a particular style of fighting as your specialty. Choose a fighting style from the list of"},{"n":"Fighting Style: Archery","t":"You gain a +2 bonus to attack rolls you make with ranged weapons."},{"n":"Fighting Style: Defense","t":"While you are wearing armor, you gain a +1 bonus to AC."}]},{"n":"Gunslinger","hd":"8","pf":"Dexterity, Wisdom","sa":"Charisma","f1":[{"n":"Starting Proficiencies","t":"Armor: light armor, medium armor\nWeapons: Simple weapons, martial weapons, guns\nTools: Tinker's tool"},{"n":"Starting Equipment","t":"You start with the following equipment, in addition to the equipment granted by your background:\n\n(a"},{"n":"Firearm Expertise","t":"Starting at level 1, you gain a +2 bonus to attack rolls and damage rolls you make with firearms."},{"n":"Weapon Forging","t":"Starting at level 1, you can forge modern style firearms. The DM must determine whether an item is c"}]},{"n":"Monk","hd":"8","pf":"Strength, Dexterity","sa":"Wisdom","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a shortsword o"},{"n":"Unarmored Defense","t":"Beginning at 1st level, while you are wearing no armor and not wielding a shield, your AC equals 10 "},{"n":"Martial Arts","t":"Your practice of martial arts gives you mastery of combat styles that use unarmed strikes and monk w"}]},{"n":"Mystic (UA)","hd":"8","pf":"Intelligence, Wisdom","sa":"Intelligence","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a spear or (b)"},{"n":"Important Notes","t":"Currently there are only rules for levels one to ten, so there is nothing past that included in the "},{"n":"Psionics","t":"As a student of psionics, you can master and use psionic disciplines."},{"n":"Psionic Talents","t":"A psionic talent is a minor psionic effect you have mastered. At 1st level, you know one psionic tal"}]},{"n":"Paladin","hd":"10","pf":"Wisdom, Charisma","sa":"Charisma","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a martial weap"},{"n":"Divine Sense","t":"The presence of strong evil registers on your senses like a noxious odor, and powerful good rings li"},{"n":"Lay on Hands","t":"Your blessed touch can heal wounds. You have a pool of healing power that replenishes when you take "}]},{"n":"Ranger","hd":"10","pf":"Strength, Dexterity","sa":"Wisdom","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) scale mail or "},{"n":"Favored Enemy","t":"Beginning at 1st level, you have significant experience studying, tracking, hunting, and even talkin"},{"n":"Natural Explorer","t":"You are particularly familiar with one type of natural environment and are adept at traveling and su"}]},{"n":"Ranger (Revised)","hd":"10","pf":"Strength, Dexterity","sa":"Wisdom","f1":[{"n":"Starting Ranger (Revised)","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Favored Enemy","t":"Beginning at 1st level, you have significant experience studying, tracking, hunting, and even talkin"},{"n":"Natural Explorer","t":"You are a master of navigating the natural world, and you react with swift and decisive action when "}]},{"n":"Rogue","hd":"8","pf":"Dexterity, Intelligence","sa":"Intelligence","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a rapier or (b"},{"n":"Expertise","t":"At 1st level, choose two of your skill proficiencies, or one of your skill proficiencies and your pr"},{"n":"Sneak Attack","t":"Beginning at 1st level, you know how to strike subtly and exploit a foe's distraction. Once per turn"},{"n":"Thieves' Cant","t":"During your rogue training you learned thieves' cant, a secret mix of dialect, jargon, and code that"}]},{"n":"Sorcerer","hd":"6","pf":"Constitution, Charisma","sa":"Charisma","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a light crossb"},{"n":"Spellcasting","t":"An event in your past, or in the life of a parent or ancestor, left an indelible mark on you, infusi"},{"n":"Sorcerous Origin","t":"Choose a sorcerous origin, which describes the source of your innate magical power: Draconic Bloodli"},{"n":"Sorcerous Origin: Draconic Bloodline","t":"Your innate magic comes from draconic magic that was mingled with your blood or that of your ancesto"}]},{"n":"Sorcerer (Pyromancer)","hd":"6","pf":"Constitution, Charisma, Arcana, Deception, Insight, Intimidation, Persuasion, Religion","sa":"Charisma","f1":[{"n":"Starting Sorcerer (Pyromancer)","t":"As a 1st-level Sorcerer (Pyromancer), you begin play with 6+your Constitution modifier hit points.\n "},{"n":"Multiclass Sorcerer (Pyromancer)","t":"To multiclass as a Sorcerer (Pyromancer), you must meet the following prerequisites:\n• Charisma 13\n "},{"n":"Spellcasting","t":"An event in your past, or in the life of a parent or ancestor, left an indelible mark on you, infusi"},{"n":"Sorcerous Origin","t":"Choose a sorcerous origin, which describes the source of your innate magical power: Draconic Bloodli"},{"n":"Sorcerous Origin: Pyromancer","t":"Your innate magic manifests in fire. You are your fire, and your fire is you.\n\t\nSource: Plane Shift:"}]},{"n":"Warlock","hd":"8","pf":"Wisdom, Charisma","sa":"Charisma","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a light crossb"},{"n":"Otherworldly Patron","t":"At 1st level, you have struck a bargain with an otherworldly being of your choice - the Archfey, the"},{"n":"Otherworldly Patron: The Archfey","t":"Your patron is a lord or lady of the fey, a creature of legend who holds secrets that were forgotten"},{"n":"Otherworldly Patron: The Fiend","t":"You have made a pact with a fiend from the lower planes of existence, a being whose aims are evil, e"}]},{"n":"Wizard","hd":"6","pf":"Intelligence, Wisdom","sa":"Intelligence","f1":[{"n":"Starting Proficiencies","t":"You are proficient with the following items, in addition to any proficiencies provided by your race "},{"n":"Starting Equipment","t":"You start with the following items, plus anything provided by your background.\n\n• (a) a quarterstaff"},{"n":"Arcane Recovery","t":"You have learned to regain some of your magical energy by studying your spellbook. Once per day when"},{"n":"Spellcasting","t":"As a student of arcane magic, you have a spellbook containing spells that show the first glimmerings"}]}],"backgrounds":[{"n":"Acolyte","pf":"Insight, Religion","tr":[{"n":"Overview","t":"You have spent your life in the service of a temple to a specific god or pantheon of gods. You act a"},{"n":"Skill Proficiencies","t":"Insight, Religion"},{"n":"Languages","t":"Two of your choice"}]},{"n":"Caravan Specialist","pf":"Animal Handling, Survival","tr":[{"n":"Overview","t":"You are used to life on the road. You pride yourself at having traveled every major trade way in the"},{"n":"Skill Proficiencies","t":"Animal Handling, Survival"},{"n":"Tool Proficiencies","t":"Land vehicles"}]},{"n":"Charlatan","pf":"Deception, Sleight of Hand","tr":[{"n":"Overview","t":"You have always had a way with people. You know what makes them tick, you can tease out their hearts"},{"n":"Skill Proficiencies","t":"Deception, Sleight of Hand"},{"n":"Tool Proficiencies","t":"Disguise Kit, Forgery Kit"}]},{"n":"City Watch","pf":"Athletics, Insight","tr":[{"n":"Overview","t":"You have served the community where you grew up, standing as its first line of defense against crime"},{"n":"Skill Proficiencies","t":"Athletics, Insight"},{"n":"Languages","t":"Any two of your choice"}]},{"n":"Clan Crafter","pf":"History, Insight","tr":[{"n":"Overview","t":"The Stout Folk are well known for their artisanship and the worth of their handiworks, and you have "},{"n":"Skill Proficiencies","t":"History, Insight"},{"n":"Tool Proficiencies","t":"One type of artisan's tools"}]},{"n":"Cloistered Scholar","pf":"History","tr":[{"n":"Overview","t":"As a child, you were inquisitive when your playmates were possessive or raucous. In your formative y"},{"n":"Skill Proficiencies","t":"History, plus your choice of one from among Arcana, Nature, and Religion"},{"n":"Languages","t":"Languages: any two of your choice"}]},{"n":"Cormanthor Refugee","pf":"Nature, Survival","tr":[{"n":"Overview","t":"You are one of hundreds of refugees that were driven from Hillsfar or that fled the destruction of M"},{"n":"Skill Proficiencies","t":"Nature, Survival"},{"n":"Tool Proficiencies","t":"One type of artisan's tools"}]},{"n":"Courtier","pf":"Insight, Persuasion","tr":[{"n":"Overview","t":"In your earlier days, you were a personage of some significance in a noble court or a bureaucratic o"},{"n":"Skill Proficiencies","t":"Insight, Persuasion"},{"n":"Languages","t":"Any two of your choice"}]},{"n":"Criminal","pf":"Deception, Stealth","tr":[{"n":"Overview","t":"You are an experienced criminal with a history of breaking the law. You have spent a lot of time amo"},{"n":"Skill Proficiencies","t":"Deception, Stealth"},{"n":"Tool Proficiencies","t":"One type of gaming set, thieves' tools"}]},{"n":"Dissenter Initiate","pf":"Athletics, Intimidation","tr":[{"n":"Description","t":"Even in the carefully constructed and curated city-state of Naktamun, and in the presence of the fiv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Athletics, Intimidation\n \nLanguage"},{"n":"Shelter of Dissenters","t":"If they wish to have any hope of survival, whether hiding within the city or cast out into the deser"}]},{"n":"Dissenter Vizier","pf":"History, Religion","tr":[{"n":"Description","t":"Even in the carefully constructed and curated city-state of Naktamun, and in the presence of the fiv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: History, Religion\n \nLanguages: non"},{"n":"Shelter of Dissenters","t":"If they wish to have any hope of survival, whether hiding within the city or cast out into the deser"}]},{"n":"Earthspur Miner","pf":"Athletics, Survival","tr":[{"n":"Overview","t":"You are a down-on your luck miner from the Earthspur Mountains who is no stranger to hardship. You h"},{"n":"Skill Proficiencies","t":"Athletics, Survival"},{"n":"Languages","t":"Dwarven and Undercommon"}]},{"n":"Entertainer","pf":"Acrobatics, Performance","tr":[{"n":"Overview","t":"You thrive in front of an audience. You know how to entrance them, entertain them, and even inspire "},{"n":"Skill Proficiencies","t":"Acrobatics, Performance"},{"n":"Tool Proficiencies","t":"Disguise kit, one type of musical instrument"}]},{"n":"Faction Agent","pf":"Insight","tr":[{"n":"Overview","t":"Many organizations active in the North and across the face of Faerûn aren't bound by strictures of g"},{"n":"Skill Proficiencies","t":"Insight and one Intelligence, Wisdom, or Charisma skill of your choice, as appropriate to your facti"},{"n":"Languages","t":"Any two of your choice"}]},{"n":"Far Traveler","pf":"Insight, Perception","tr":[{"n":"Overview","t":"Almost all of the common people and other folk that one might encounter along the Sword Coast or in "},{"n":"Skill Proficiencies","t":"Insight, Perception"},{"n":"Tool Proficiencies","t":"Any one musical instrument or gaming set of your choice, likely something native to your homeland"}]},{"n":"Folk Hero","pf":"Animal Handling, Survival","tr":[{"n":"Overview","t":"You come from a humble social rank, but you are destined for so much more. Already the people of you"},{"n":"Skill Proficiencies","t":"Animal Handling, Survival"},{"n":"Tool Proficiencies","t":"One type of artisan's tools, vehicles (land)"}]},{"n":"Gate Urchin","pf":"Deception, Sleight of Hand","tr":[{"n":"Overview","t":"All traffic into and out of the City of Trade passes through the Hillsfar Gate, making it the ideal "},{"n":"Skill Proficiencies","t":"Athletics, Survival"},{"n":"Tool Proficiencies","t":"Thieves' tools, one type of musical instrument"}]},{"n":"Guild Artisan","pf":"Insight, Persuasion","tr":[{"n":"Overview","t":"You are a member of an artisan's guild, skilled in a particular field and closely associated with ot"},{"n":"Skill Proficiencies","t":"Insight, Persuasion"},{"n":"Tool Proficiencies","t":"One type of artisan's tools"}]},{"n":"Harborfolk","pf":"Athletics, Sleight of Hand","tr":[{"n":"Overview","t":"You are one of the hundreds of small-time fishermen and women who haul the bounty of Mulmaster's fre"},{"n":"Skill Proficiencies","t":"Athletics, Sleight of Hand"},{"n":"Tool Proficiencies","t":"One type of gaming set, water vehicles"}]},{"n":"Haunted One","pf":"","tr":[{"n":"Overview","t":"You are haunted by something so terrible that you dare not speak of it. You've tried to bury it and "},{"n":"Feature: Harrowing Event","t":"Prior to becoming an adventurer, your path in life was defined by one dark moment, one fateful decis"},{"n":"Personality Trait","t":"Choose or randomly determine\n\n1. I don't run from evil. Evil runs from me. \n \n2. I like to read and "}]},{"n":"Hermit","pf":"Medicine, Religion","tr":[{"n":"Skill Proficiencies","t":"Medicine, Religion"},{"n":"Tool Proficiencies","t":"Herbalism Kit"},{"n":"Languages","t":"One of your choice"}]},{"n":"Hillsfar Merchant","pf":"Insight, Persuasion","tr":[{"n":"Overview","t":"Before becoming an adventurer, you were a successful merchant operating out Hillsfar, the City of Tr"},{"n":"Skill Proficiencies","t":"Insight, Persuasion"},{"n":"Tool Proficiencies","t":"Land vehicles and water vehicles"}]},{"n":"Hillsfar Smuggler","pf":"Perception, Stealth","tr":[{"n":"Overview","t":"Hillsfar is the City of Trade. However, the Great Law of Trade only protects \"legitimate\" trade, tra"},{"n":"Skill Proficiencies","t":"Perception, Stealth"},{"n":"Tool Proficiencies","t":"Forgery kit"}]},{"n":"House Cannith Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Deneith Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Ghallanda Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Jorasco Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Kundarak Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Lyrandar Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Medani Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Orien Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Phiarlan Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Sivis Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Tharashk Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Thuranni Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"House Vadalis Agent","pf":"Investigation, Persuasion","tr":[{"n":"Description","t":"You have sworn fealty to a Dragonmarked House, one of the mighty mercantile guilds that shapes Khorv"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Persuasion\n \nLangua"},{"n":"House Connections","t":"Source: Wayfinder's Guide to Eberron, Chapter 4"}]},{"n":"Inheritor","pf":"Survival","tr":[{"n":"Overview","t":"You are the heir to something of great value — not mere coin or wealth, but an object that has been "},{"n":"Skill Proficiencies","t":"Survival, plus one from among Arcana, History, and Religion"},{"n":"Languages","t":"Any one of your choice"}]},{"n":"Initiate","pf":"Athletics, Intimidation","tr":[{"n":"Description","t":"You are an initiate, on the path to completing the trials of the five gods in the hope of earning a "},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Athletics, Intimidation\n \nLanguage"},{"n":"Trial of the Five Gods","t":"Your life is oriented around your participation in the five trials that will determine your worthine"}]},{"n":"Inquisitor","pf":"Investigation, Religion","tr":[{"n":"Description","t":"Historically, inquisitors were cathar detectives who investigated crimes both mundane and supernatur"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: Investigation, Religion\n \nLanguage"},{"n":"Legal Authority","t":"As an inquisitor of the church, you have the authority to arrest criminals. In the absence of other "}]},{"n":"Investigator","pf":"Insight, Investigation","tr":[{"n":"Skill Proficiencies","t":"Insight, Investigation"},{"n":"Languages","t":"Any two of your choice"},{"n":"Equipment","t":"A uniform in the style of your unit and indicative of your rank, a horn with which to summon help, a"}]},{"n":"Knight of the Order","pf":"Persuasion","tr":[{"n":"Overview","t":"You belong to an order of knights who have sworn oaths to achieve a certain goal. The nature of this"},{"n":"Skill Proficiencies","t":"Persuasion, plus one from among Arcana, History, Nature, and Religion, as appropriate for your order"},{"n":"Tool Proficiencies","t":"Your choice of a gaming set or a musical instrument"}]},{"n":"Mercenary Veteran","pf":"Athletics, Persuasion","tr":[{"n":"Overview","t":"As a sell-sword who fought battles for coin, you're well acquainted with risking life and limb for a"},{"n":"Skill Proficiencies","t":"Athletics, Persuasion"},{"n":"Tool Proficiencies","t":"One type of gaming set, vehicles (land)"}]},{"n":"Mulmaster Aristocrat","pf":"Deception, Performance","tr":[{"n":"Description","t":"From your hilltop home, you have looked down (literally and perhaps figuratively) on the unwashed ma"},{"n":"Skill Proficiencies","t":"Deception, Performance"},{"n":"Tool Proficiencies","t":"One type of artistic artisan's tools and one musical instrument"}]},{"n":"Noble","pf":"History, Persuasion","tr":[{"n":"Description","t":"You understand wealth, power, and privilege. You carry a noble title, and your family owns land, col"},{"n":"Skill Proficiencies","t":"History, Persuasion"},{"n":"Tool Proficiencies","t":"One type of gaming set"}]},{"n":"Outlander","pf":"Athletics, Survival","tr":[{"n":"Description","t":"You grew up in the wilds, far from civilization and the comforts of town and technology. You've witn"},{"n":"Skill Proficiencies","t":"Athletics, Survival"},{"n":"Tool Proficiencies","t":"One type of musical instrument"}]},{"n":"Phlan Refugee","pf":"Athletics, Insight","tr":[{"n":"Description","t":"Gone are the happier days of walking into the Laughing Goblin Inn after a hard day's labor. Everythi"},{"n":"Skill Proficiencies","t":"Insight, Athletics"},{"n":"Tool Proficiencies","t":"One type of artisan's tools"}]},{"n":"Sage","pf":"Arcana, History","tr":[{"n":"Description","t":"You spent years learning the lore of the multiverse. You scoured manuscripts, studied scrolls, and l"},{"n":"Skill Proficiencies","t":"Arcana, History"},{"n":"Languages","t":"Two of your choice"}]},{"n":"Sailor","pf":"Athletics, Perception","tr":[{"n":"Description","t":"You sailed on a seagoing vessel for years. In that time, you faced down mighty storms, monsters of t"},{"n":"Skill Proficiencies","t":"Athletics, Perception"},{"n":"Tool Proficiencies","t":"Navigator's tools, vehicles(water)"}]},{"n":"Secret Identity","pf":"Deception, Stealth","tr":[{"n":"Description","t":"Even though you are a non-human, despite Hillsfar's Great Law of Humanity, you continue to live in t"},{"n":"Skill Proficiencies","t":"Deception, Stealth"},{"n":"Tool Proficiencies","t":"Disguise kit, forgery kit"}]},{"n":"Shade Fanatic","pf":"Deception, Intimidation","tr":[{"n":"Description","t":"You grew up at a time when the wizards of Netheril were at war with the elves of Cormanthor. You rec"},{"n":"Skill Proficiencies","t":"Deception, Intimidation"},{"n":"Tool Proficiencies","t":"Forgery kit"}]},{"n":"Soldier","pf":"Athletics, Intimidation","tr":[{"n":"Skill Proficiencies","t":"Athletics, Intimidation"},{"n":"Tool Proficiencies","t":"One type of gaming set, vehicles (land)"},{"n":"Equipment","t":"An insignia of rank, a trophy taken from a fallen enemy (a dagger, broken blade, or piece of a banne"}]},{"n":"Trade Sherrif","pf":"Investigation, Persuasion","tr":[{"n":"Overview","t":"You are one of the many people that make sure the trade routes are clear at ALL times. You assure th"},{"n":"Skill Proficiencies","t":"Investigation, Persuasion"},{"n":"Tool Proficiencies","t":"Thieves kit"}]},{"n":"Urban Bounty Hunter","pf":"","tr":[{"n":"Overview","t":"Before you became an adventurer, your life was already full of conflict and excitement, because you "},{"n":"Skill Proficiencies","t":"Choose two from among Deception, Insight, Persuasion, and Stealth"},{"n":"Tool Proficiencies","t":"Choose two from among one type of gaming set, one musical instrument, and thieves's tools"}]},{"n":"Urchin","pf":"Sleight of Hand, Stealth","tr":[{"n":"Overview","t":"You grew up on the streets alone, orphaned, and poor. You had no one to watch over you or to provide"},{"n":"Skill Proficiencies","t":"Sleight of Hand, Stealth"},{"n":"Tool Proficiencies","t":"Disguise Kit, thieves' tools"}]},{"n":"Uthgardt Tribe Member","pf":"Athletics, Survival","tr":[{"n":"Overview","t":"Though you might have only recently arrived in civilized lands, you are no stranger to the values of"},{"n":"Skill Proficiencies","t":"Athletics, Survival"},{"n":"Languages","t":"Any one of your choice"}]},{"n":"Variant Criminal (Spy)","pf":"Deception, Stealth","tr":[{"n":"Skill Proficiencies","t":"Deception, Stealth"},{"n":"Tool Proficiencies","t":"One type of gaming set, thief's tools"},{"n":"Equipment","t":"A crowbar, a set of dark common clothes including a hood, and a belt pouch containing 15 gp"}]},{"n":"Variant Entertainer (Gladiator)","pf":"Acrobatics, Performance","tr":[{"n":"Skill Proficiencies","t":"Acrobatics, Performance"},{"n":"Tool Proficiencies","t":"Disguise kit, one type of musical instrument"},{"n":"Equipment","t":"An inexpensive but unusual weapon, such as a trident or net (one of your choice), the favor of an ad"}]},{"n":"Variant Guild Artisan (Guild Merchant)","pf":"Insight, Persuasion","tr":[{"n":"Skill Proficiencies","t":"Insight, Persuasion"},{"n":"Tool Proficiencies","t":"Navigator's Tools or an additional language"},{"n":"Equipment","t":"A mule and cart, a letter of introduction from your guild, a set of traveler's clothes, and a belt p"}]},{"n":"Variant Noble (Knight)","pf":"History, Persuasion","tr":[{"n":"Skill Proficiencies","t":"History, Persuasion"},{"n":"Tool Proficiencies","t":"One type of gaming set"},{"n":"Languages","t":"One of your choice"}]},{"n":"Variant Sailor (Pirate)","pf":"Athletics, Perception","tr":[{"n":"Skill Proficiencies","t":"Athletics, Perception"},{"n":"Tool Proficiencies","t":"Navigator's tools, vehicles(water)"},{"n":"Equipment","t":"A belaying pin (dub), 50 feet of silk rope, a lucky charm such as a rabbit foot or a small stone wit"}]},{"n":"Vizier","pf":"History, Religion","tr":[{"n":"Description","t":"You are a vizier, a servant of your god. You perform tasks that are essential to facilitating the in"},{"n":"Starting Proficiencies","t":"Your background grants you the following proficiencies.\n \nSkills: History, Religion\n \nLanguages: non"},{"n":"Voice of Authority","t":"Your voice is the voice of your god, at least in theory. Your job might include training and instruc"}]},{"n":"Waterdhavian Noble","pf":"History, Persuasion","tr":[{"n":"Overview","t":"You are a scion of one of the great noble families of Waterdeep. Human families who jealously guard "},{"n":"Skill Proficiencies","t":"History, Persuasion"},{"n":"Languages","t":"Any one of your choice"}]}],"feats":[{"n":"Aberrant Dragon Mark","pr":"No existing dragonmark","t":"You have manifested an aberrant dragonmark. Determine its appearance and the flaw associated with it. You gain the follo"},{"n":"Actor","pr":"","t":"Skilled at mimicry and dramatics, you gain the following benefits:\n• Increase your Charisma score by 1, to a maximum of "},{"n":"Alert","pr":"","t":"Always on the lookout for danger, you gain the following\n\n• You gain a +5 bonus to initiative.\n\n• You can't be surprised"},{"n":"Athlete","pr":"","t":"You have undergone extensive physical training to gain the following benefits: • Increase your Strength or Dexterity sco"},{"n":"Charger","pr":"","t":"When you use your action to Dash, you can use a bonus action to make one melee weapon attack or to shove a creature.\n\nIf"},{"n":"Crossbow Expert","pr":"","t":"Thanks to extensive practice with the crossbow, you gain the following benefits:\n\n• You ignore the loading quality of cr"},{"n":"Defensive Duelist","pr":"Dexterity 13 or higher","t":"When you are wielding a finesse weapon with which you are proficient and another creature hits you with a melee attack, "},{"n":"Dragonmark of Detection","pr":"half-elf","t":"Your have the magical mark of Detection, the dragonmark of House Medani, and are a member of that house.\nYou gain the ab"},{"n":"Dragonmark of Finding","pr":"half-orc or human","t":"Your have the magical mark of Finding, the dragonmark of House Tharashk, and are a member of that house.\nYou gain the ab"},{"n":"Dragonmark of Handling","pr":"human","t":"Your have the magical mark of Handling, the dragonmark of House Vadalis, and are a member of that house.\nYou gain the ab"},{"n":"Dragonmark of Healing","pr":"halfling","t":"Your have the magical mark of Healing, the dragonmark of House Jorasco, and are a member of that house.\nYou gain the abi"},{"n":"Dragonmark of Hospitality","pr":"halfling","t":"Your have the magical mark of Hospitality, the dragonmark of House Ghallanda, and are a member of that house.\nYou gain t"},{"n":"Dragonmark of Making","pr":"human","t":"Your have the magical mark of Making, the dragonmark of House Cannith, and are a member of that house.\nYou gain the abil"},{"n":"Dragonmark of Passage","pr":"human","t":"Your have the magical mark of Passage, the dragonmark of House Orien, and are a member of that house.\nYou gain the abili"},{"n":"Dragonmark of Scribing","pr":"gnome","t":"Your have the magical mark of Scribing, the dragonmark of House Sivis, and are a member of that house.\nYou gain the abil"},{"n":"Dragonmark of Sentinel","pr":"human","t":"Your have the magical mark of Sentinel, the dragonmark of House Deneith, and are a member of that house.\nYou gain the ab"},{"n":"Dragonmark of Shadow","pr":"elf","t":"Your have the magical mark of Shadow, the dragonmark of House Phiarlan and House Thuranni, and are a member of one of th"},{"n":"Dragonmark of Storm","pr":"half-elf","t":"Your have the magical mark of Storm, the dragonmark of House Lyrander, and are a member of that house.\nYou gain the abil"},{"n":"Dragonmark of Warding","pr":"dwarf","t":"Your have the magical mark of Warding, the dragonmark of House Kundarak, and are a member of that house.\nYou gain the ab"},{"n":"Dual Wielder","pr":"","t":"You master fighting with two weapons, gaining the following benefits:\n\n• You gain a +1 bonus to AC while you are wieldin"},{"n":"Dungeon Delver","pr":"","t":"Alert to the hidden traps and secret doors found in many dungeons, you gain the following benefits:\n\n• You have advantag"},{"n":"Durable","pr":"","t":"Hardy and resilient, you gain the following benefits:\n\n• Increase your Constitution score by 1, to a maximum of 20.\n\n• W"},{"n":"Elemental Adept","pr":"The ability to cast at least one spell","t":"When you gain this feat, choose one of the following damage types: acid, cold, fire, lightning, or thunder.\n\nSpells you "},{"n":"Grappler","pr":"Strength 13 or higher","t":"You've developed the skills necessary to hold your own in close-quarters grappling. You gain the following benefits:\n\n• "},{"n":"Great Weapon Master","pr":"","t":"You've learned to put the weight of a weapon to your advantage, letting its momentum empower your strikes. You gain the "},{"n":"Greater Mark of Detection","pr":"8th level, must possess Mark of Detection","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Finding","pr":"8th level, must possess Mark of Finding","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Handling","pr":"8th level, must possess Mark of Handling","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Healing","pr":"8th level, must possess Mark of Healing","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Hospitality","pr":"8th level, must possess Mark of Hospitality","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Making","pr":"8th level, must possess Mark of Making","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Passage","pr":"8th level, must possess Mark of Passage","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Scribing","pr":"8th level, must possess Mark of Scribing","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Sentinel","pr":"8th level, must possess Mark of Sentinel","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Shadow","pr":"8th level, must possess Mark of Shadow","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Storm","pr":"8th level, must possess Mark of Storm","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Greater Mark of Warding","pr":"8th level, must possess Mark of Warding","t":"Your dragonmark has grown in size and power. This enhances your existing dragonmark, and the benefits are based on the m"},{"n":"Healer","pr":"","t":"You are an able physician, allowing you to mend wounds quickly and get your allies back in the fight. You gain the follo"},{"n":"Heavily Armored","pr":"Proficiency with medium armor","t":"You have trained to master the use of heavy armor, gaining the following benefits:\n\n• Increase your Strength score by 1,"},{"n":"Heavy Armor Master","pr":"Proficiency with heavy armor","t":"You can use your armor to deflect strikes that would kill others. You gain the following benefits:\n\n• Increase your Stre"},{"n":"Inspiring Leader","pr":"CHA 13","t":"You can spend 10 minutes inspiring your companions, shoring up their resolve to fight. When you do so, choose up to six "},{"n":"Keen Mind","pr":"","t":"You have a mind that can track time, direction, and detail with uncanny precision. You gain the following benefits.\n\n• I"},{"n":"Lightly Armored","pr":"","t":"You have trained to master the use of light armor, gaining the following benefits:\n\n• Increase your Strength or Dexterit"},{"n":"Linguist","pr":"","t":"You have studied languages and codes, gaining the following benefits:\n\n• Increase your Intelligence score by 1, to a max"},{"n":"Lucky","pr":"","t":"You have inexplicable luck that seems to kick in at just the right moment.\n\nYou have 3 luck points. Whenever you make an"},{"n":"Mage Slayer","pr":"","t":"You have practiced techniques useful in melee combat against spellcasters, gaining the following benefits:\n\n• When a cre"},{"n":"Magic Initiate","pr":"","t":"Choose a class: bard, cleric, druid, sorcerer, warlock, or wizard. You learn two cantrips of your choice from that class"},{"n":"Martial Adept","pr":"","t":"You have martial training that allows you to perform special combat maneuvers. You gain the following benefits:\n\n• You l"},{"n":"Medium Armor Master","pr":"Proficiency with medium armor","t":"You have practiced moving in medium armor to gain the following benefits:\n\n• Wearing medium armor doesn't impose disadva"},{"n":"Mobile","pr":"","t":"You are exceptionally speedy and agile. You gain the following benefits:\n\n• Your speed increases by 10 feet.\n\n• When you"},{"n":"Moderately Armored","pr":"Proficiency with light armor","t":"You have trained to master the use of medium armor and shields, gaining the following benefits:\n\n• Increase your Strengt"},{"n":"Mounted Combatant","pr":"","t":"You are a dangerous foe to face while mounted. While you are mounted and aren't incapacitated, you gain the following be"},{"n":"Observant","pr":"","t":"Quick to notice details of your environment, you gain the following benefits:\n\n• Increase your Intelligence or Wisdom sc"},{"n":"Polearm Master","pr":"","t":"You can keep your enemies at bay with reach weapons. You gain the following benefits:\n\n• When you take the Attack action"},{"n":"Quicksmithing","pr":"Intelligence 13 or higher","t":"You have mastered the art of on-the-fly invention, improvement, and jury-rigging. You can use your talents to create imm"},{"n":"Resilient","pr":"","t":"Choose one ability score. You gain the following benefits:\n\n• Increase the chosen ability score by 1, to a maximum of 20"},{"n":"Revenant Blade","pr":"Elf","t":"You are descended from a master of the double blade and their skills have passed on to you. You gain the following benef"},{"n":"Ritual Caster","pr":"Intelligence or Wisdom 13 or higher","t":"You have learned a number of spells that you can cast as rituals. These spells are written in a ritual book, which you m"},{"n":"Savage Attacker","pr":"","t":"Once per turn when you roll damage for a melee weapon attack, you can reroll the weapon's damage dice and use either tot"},{"n":"Sentinel","pr":"","t":"You have mastered techniques to take advantage of every drop in any enemy's guard, gaining the following benefits:\n\n• Wh"},{"n":"Servo Crafting","pr":"Intelligence 13 or higher","t":"You are skilled in the creation of servos—tiny constructs that function as personal assistants. You can cast the find fa"},{"n":"Sharpshooter","pr":"","t":"You have mastered ranged weapons and can make shots that others find impossible. You gain the following benefits:\n\n• Att"},{"n":"Shield Master","pr":"","t":"You use shields not just for protection but also for offense. You gain the following benefits while you are wielding a s"},{"n":"Skilled","pr":"","t":"You gain proficiency in any combination of three skills or tools of your choice.\n\nSource: Player's Handbook, page 170"},{"n":"Skulker","pr":"Dexterity 13 or higher","t":"You are expert at slinking through shadows. You gain the following benefits:\n\n• You can try to hide when you are lightly"},{"n":"Spell Sniper","pr":"The ability to cast at least one spell","t":"You have learned techniques to enhance your attacks with certain kinds of spells, gaining the following benefits:\n\n• Whe"},{"n":"Svirfneblin Magic","pr":"Gnome (deep gnome)","t":"You have inherited the innate spellcasting ability of your ancestors. This ability allows you to cast nondetection on yo"},{"n":"Tavern Brawler","pr":"","t":"Accustomed to rough-and-tumble fighting using whatever weapons happen to be at hand, you gain the following benefits:\n\n•"},{"n":"Tough","pr":"","t":"Your hit point maximum increases by an amount equal to twice your level when you gain this feat. Whenever you gain a lev"},{"n":"War Caster","pr":"The ability to cast at least one spell","t":"You have practiced casting spells in the midst of combat, learning techniques that grant you the following benefits:\n\n• "},{"n":"Weapon Master","pr":"","t":"You have practiced extensively with a variety of weapons, gaining the following benefits:\n\n• Increase your Strength or D"}]};

// ---- Compendio tab (replace old tab-compendio if it existed for monsters there) ----
// This renders in the "Compendio" tab for player-facing data only

let wizStep = 0;
let wizData = {
  nombre: '', player_pin: '',
  race: null, cls: null, background: null, feats: [],
  stats: {str:10, dex:10, con:10, int:10, wis:10, cha:10},
  hp_max: 8, hp_curr: 8, ca: 10, nivel: 1, xp: 0
};

const WIZ_STEPS = ['Raza', 'Clase', 'Trasfondo', 'Stats', 'Datos', 'Confirmar'];

function openWizard() {
  wizStep = 0;
  wizData = { nombre:'', player_pin:'', race:null, cls:null, background:null, feats:[],
    stats:{str:10,dex:10,con:10,int:10,wis:10,cha:10}, hp_max:8,hp_curr:8,ca:10,nivel:1,xp:0 };
  document.getElementById('pc-wizard').style.display = 'flex';
  renderWizStep();
}
function closeWizard() {
  document.getElementById('pc-wizard').style.display = 'none';
}

function renderWizPips() {
  const el = document.getElementById('wiz-pips');
  el.innerHTML = WIZ_STEPS.map((s,i) =>
    `<div class="wizard-step-pip ${i < wizStep ? 'done' : i === wizStep ? 'active' : ''}" title="${s}"></div>`
  ).join('');
}

function renderWizStep() {
  renderWizPips();
  document.getElementById('wiz-title').textContent = `Paso ${wizStep+1}/6 — ${WIZ_STEPS[wizStep]}`;
  document.getElementById('wiz-back').style.display = wizStep === 0 ? 'none' : 'inline-flex';
  document.getElementById('wiz-next').textContent = wizStep === 5 ? '? Guardar personaje' : 'Siguiente ?';
  const body = document.getElementById('wiz-body');

  if(wizStep === 0) renderWizRace(body);
  else if(wizStep === 1) renderWizClass(body);
  else if(wizStep === 2) renderWizBackground(body);
  else if(wizStep === 3) renderWizStats(body);
  else if(wizStep === 4) renderWizDetails(body);
  else if(wizStep === 5) renderWizConfirm(body);
}

// STEP 0 — RACE
function renderWizRace(body) {
  const q = (body.querySelector('.wiz-search')?.value || '').toLowerCase();
  const filtered = PC_DATA.races.map((r,i) => ({...r, _i:i})).filter(r => !q || r.n.toLowerCase().includes(q));
  body.innerHTML = `
    <div class="wizard-step-label">Elige la raza de tu personaje</div>
    <input class="input picker-search wiz-search" placeholder="Buscar raza..." oninput="renderWizStep()" value="${q}">
    <div class="picker-grid">
      ${filtered.map(r => `
        <div class="picker-card ${wizData.race?.n === r.n ? 'selected' : ''}" onclick="selectRace(${r._i})">
          <div class="picker-card-name">${r.n}</div>
          <div class="picker-card-sub">${r.ab || 'Sin bonos de atributo'}</div>
          <div class="picker-card-traits">${(r.tr||[]).slice(0,2).map(t=>t.n).join(' · ')}</div>
        </div>`).join('')}
    </div>`;
}
function selectRace(i) { wizData.race = PC_DATA.races[i]; renderWizStep(); }

// STEP 1 — CLASS
function renderWizClass(body) {
  const q = (body.querySelector('.wiz-search')?.value || '').toLowerCase();
  const filtered = PC_DATA.classes.map((c,i) => ({...c, _i:i})).filter(c => !q || c.n.toLowerCase().includes(q));
  body.innerHTML = `
    <div class="wizard-step-label">Elige la clase de tu personaje</div>
    <input class="input picker-search wiz-search" placeholder="Buscar clase..." oninput="renderWizStep()" value="${q}">
    <div class="picker-grid">
      ${filtered.map(c => `
        <div class="picker-card ${wizData.cls?.n === c.n ? 'selected' : ''}" onclick="selectClass(${c._i})">
          <div class="picker-card-name">${c.n}</div>
          <div class="picker-card-sub">d${c.hd} · ${c.pf || 'Ver manual'}</div>
          <div class="picker-card-traits">${c.sa ? 'Conjuro: '+c.sa : 'Sin magia'} · ${(c.f1||[]).slice(0,2).map(f=>f.n).join(', ')}</div>
        </div>`).join('')}
    </div>`;
}
function selectClass(i) { wizData.cls = PC_DATA.classes[i];  calculateHP(); renderWizStep(); }

// STEP 2 — BACKGROUND
function renderWizBackground(body) {
  const q = (body.querySelector('.wiz-search')?.value || '').toLowerCase();
  const filtered = PC_DATA.backgrounds.map((b,i) => ({...b, _i:i})).filter(b => !q || b.n.toLowerCase().includes(q));
  body.innerHTML = `
    <div class="wizard-step-label">Elige el trasfondo de tu personaje</div>
    <input class="input picker-search wiz-search" placeholder="Buscar trasfondo..." oninput="renderWizStep()" value="${q}">
    <div class="picker-grid">
      ${filtered.map(b => `
        <div class="picker-card ${wizData.background?.n === b.n ? 'selected' : ''}" onclick="selectBackground(${b._i})">
          <div class="picker-card-name">${b.n}</div>
          <div class="picker-card-sub">${b.pf || 'Ver manual'}</div>
          <div class="picker-card-traits">${(b.tr||[]).slice(0,1).map(t=>t.t).join('').slice(0,80).replace(/'/g,"&#39;")}...</div>
        </div>`).join('')}
    </div>`;
}
function selectBackground(i) { wizData.background = PC_DATA.backgrounds[i]; renderWizStep(); }

// STEP 3 — STATS
function parseAbilityBonus(abStr) {
  const bonuses = {};
  if(!abStr) return bonuses;
  const map = {'Strength':'str','Dexterity':'dex','Constitution':'con','Intelligence':'int','Wisdom':'wis','Charisma':'cha',
    'Str':'str','Dex':'dex','Con':'con','Int':'int','Wis':'wis','Cha':'cha'};
  const matches = abStr.matchAll(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma|Str|Dex|Con|Int|Wis|Cha)\s*([+-]?\d+)/gi);
  for(const m of matches) { bonuses[map[m[1]]] = (bonuses[map[m[1]]]||0) + (+m[2]); }
  return bonuses;
}

function rollStat() {
  const rolls = Array.from({length:4}, ()=>Math.ceil(Math.random()*6));
  rolls.sort((a,b)=>a-b);
  return rolls.slice(1).reduce((a,b)=>a+b, 0);
}

function rollAllStats() {
  const stats = ['str','dex','con','int','wis','cha'];
  const bonuses = parseAbilityBonus(wizData.race?.ab || '');
  stats.forEach(s => {
    const base = rollStat();
    const bonus = bonuses[s] || 0;
    wizData.stats[s] = base + bonus;
    const inputEl = document.getElementById('stat-'+s);
    if(inputEl) inputEl.value = wizData.stats[s];
  });
  updateStatDisplay();
}

function updateStatDisplay() {
  
['str','dex','con','int','wis','cha'].forEach(s => {
    const v = wizData.stats[s];
    const mod = Math.floor((v-10)/2);
    const modEl = document.getElementById('statmod-'+s);
    if(modEl) modEl.textContent = (mod>=0?'+':'')+mod;
  });

  // Recalculate HP from class hit die + CON mod

if(wizData.cls) {
  calculateHP();
}

}

function renderWizStats(body) {
  const bonuses = parseAbilityBonus(wizData.race?.ab || '');
  const bonusNote = Object.entries(bonuses).map(([k,v]) => k.toUpperCase()+(v>=0?'+':'')+v).join(', ');
  const statNames = {str:'Fuerza',dex:'Destreza',con:'Constitución',int:'Inteligencia',wis:'Sabiduría',cha:'Carisma'};
  body.innerHTML = `
    <div class="wizard-step-label">Asigna los valores de habilidad</div>
    ${bonusNote ? `<div class="card-detail" style="margin-bottom:10px;color:var(--gold-dim)">Bonos raciales incluidos: ${bonusNote}</div>` : ''}
    <button class="btn gold" onclick="rollAllStats()" style="margin-bottom:12px">? Tirar todos los dados (4d6 descarta el menor)</button>
    <div class="stat-roller">
      ${['str','dex','con','int','wis','cha'].map(s => {
        const mod = Math.floor((wizData.stats[s]-10)/2);
        return `<div class="stat-roller-box">
          <input class="stat-roller-input" id="stat-${s}" type="number" min="1" max="30"
            value="${wizData.stats[s]}" oninput="handleStatChange('${s}', this.value)">
          <div class="stat-roller-mod" id="statmod-${s}">${mod>=0?'+':''}${mod}</div>
          <div class="stat-roller-name">${statNames[s]}</div>
          ${bonuses[s] ? `<div style="font-size:9px;color:var(--gold-dim)">(${bonuses[s]>=0?'+':''}${bonuses[s]} racial)</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="card-detail" style="margin-top:10px">HP base: d${wizData.cls?.hd||8} + mod CON = <b style="color:var(--gold)">${wizData.hp_max}</b></div>`;
}

// STEP 4 — NAME / PIN / NIVEL
function renderWizDetails(body) {
  body.innerHTML = `
    <div class="wizard-step-label">Datos del personaje</div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">Nombre del personaje</label>
      <input class="input" id="wiz-nombre" placeholder="Ej: Aldric Stoneback" value="${wizData.nombre}">
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">PIN del jugador (para entrar a su Player Screen)</label>
      <input class="input" id="wiz-pin" placeholder="Ej: 1234" value="${wizData.player_pin}">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="form-group">
        <label class="form-label">Nivel inicial</label>
        <input class="input" id="wiz-nivel" type="number"
        value="${wizData.nivel}" min="1" max="20"
        oninput="handleLevelChange(this.value)">
      </div>
      <div class="form-group">
        <label class="form-label">CA inicial</label>
        <input class="input" id="wiz-ca" type="number" value="${wizData.ca}" min="1" max="30">
      </div>
    </div>`;
}

function handleLevelChange(value) {
  wizData.nivel = +value || 1;
  calculateHP();
  updateHPDisplay();
}

function saveWizDetails() {
  wizData.nombre = document.getElementById('wiz-nombre')?.value.trim() || '';
  wizData.player_pin = document.getElementById('wiz-pin')?.value.trim() || '';
  wizData.nivel = +document.getElementById('wiz-nivel')?.value || 1;
  calculateHP();
  wizData.ca = +document.getElementById('wiz-ca')?.value || 10;
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const v = +document.getElementById('stat-'+s)?.value;
    if(!isNaN(v)) wizData.stats[s] = v;
  });
  updateStatDisplay();
  updateHPDisplay();
}

function updateHPDisplay() {
  const el = document.querySelector('.card-detail b');
  if(el) el.textContent = wizData.hp_max;
}


function calculateHP() {
  if(!wizData.cls) return;

  const hitDie = +wizData.cls.hd || 8;
  const conMod = Math.floor((wizData.stats.con - 10) / 2);
  const level = wizData.nivel || 1;

  // Nivel 1 = dado completo
  let hp = hitDie + conMod;

  // niveles adicionales (promedio)
  if(level > 1) {
    const avg = Math.ceil(hitDie / 2) + 1; 
    hp += (level - 1) * (avg + conMod);
  }

  wizData.hp_max = Math.max(1, hp);
  wizData.hp_curr = wizData.hp_max;
}

function handleStatChange(stat, value) {
  const v = +value || 10;
  wizData.stats[stat] = v;

  const mod = Math.floor((v - 10) / 2);
  const modEl = document.getElementById('statmod-' + stat);
  if(modEl) modEl.textContent = (mod >= 0 ? '+' : '') + mod;

  // recalcular HP en tiempo real
  
if(stat === 'con') {
  calculateHP();
  updateHPDisplay();
}

}

// STEP 5 — CONFIRM
function renderWizConfirm(body) {
  const bonuses = parseAbilityBonus(wizData.race?.ab || '');
  body.innerHTML = `
    <div class="wizard-step-label">Revisa y confirma tu personaje</div>
    <table class="confirm-table">
      <tr><td>NOMBRE</td><td><b style="color:var(--cream)">${wizData.nombre||'(sin nombre)'}</b></td></tr>
      <tr><td>RAZA</td><td>${wizData.race?.n || '—'}</td></tr>
      <tr><td>CLASE</td><td>${wizData.cls?.n || '—'} (d${wizData.cls?.hd||8})</td></tr>
      <tr><td>TRASFONDO</td><td>${wizData.background?.n || '—'}</td></tr>
      <tr><td>NIVEL</td><td>${wizData.nivel}</td></tr>
      <tr><td>HP</td><td>${wizData.hp_max}</td></tr>
      <tr><td>CA</td><td>${wizData.ca}</td></tr>
      <tr><td>PIN JUGADOR</td><td>${wizData.player_pin||'(sin PIN)'}</td></tr>
      <tr><td>STATS</td><td>
        STR ${wizData.stats.str} · DEX ${wizData.stats.dex} · CON ${wizData.stats.con}<br>
        INT ${wizData.stats.int} · WIS ${wizData.stats.wis} · CHA ${wizData.stats.cha}
      </td></tr>
      <tr><td>COMPETENCIAS</td><td style="font-size:11px">${wizData.cls?.pf||''} ${wizData.background?.pf ? '· '+wizData.background.pf : ''}</td></tr>
    </table>
    ${!wizData.nombre ? '<div style="color:#e0a0a0;margin-top:10px;font-size:12px">? Falta el nombre del personaje</div>' : ''}
    ${!wizData.player_pin ? '<div style="color:#e0a0a0;font-size:12px">? Falta el PIN del jugador</div>' : ''}`;
}

async function wizNext() {
  // Persist current step state before advancing
  if(wizStep === 3) {
    // Read all stat inputs directly into wizData — do NOT call updateStatDisplay here
    ['str','dex','con','int','wis','cha'].forEach(s => {
      const el = document.getElementById('stat-'+s);
      if(el) wizData.stats[s] = Math.max(1, +el.value || 10);
    });
    // Recalculate HP with saved CON
    if(wizData.cls) {
        calculateHP();
        updateHPDisplay();
    }

  }
  if(wizStep === 4) saveWizDetails();

  // Validate
  if(wizStep === 0 && !wizData.race) { showToast('Elige una raza para continuar'); return; }
  if(wizStep === 1 && !wizData.cls)  { showToast('Elige una clase para continuar'); return; }
  if(wizStep === 2 && !wizData.background) { showToast('Elige un trasfondo para continuar'); return; }
  if(wizStep === 5) { await saveWizardPC(); return; }

  wizStep++;
  renderWizStep();
}

function wizBack() {
  if(wizStep > 0) { wizStep--; renderWizStep(); }
}

async function saveWizardPC() {
  if(!wizData.nombre) { showToast('El personaje necesita un nombre'); return; }
  if(!wizData.player_pin) { showToast('El personaje necesita un PIN de jugador'); return; }
  if(!campaignId) { showToast('Error: no hay campaña activa'); return; }

  const pc = {
    campaign_id: campaignId,
    player_pin: wizData.player_pin,
    nombre: wizData.nombre,
    clase: (wizData.race?.n||'') + ' ' + (wizData.cls?.n||''),
    nivel: wizData.nivel,
    xp: 0,
    hp_max: wizData.hp_max,
    hp_curr: wizData.hp_max,
    ca: wizData.ca,
    str: wizData.stats.str,
    dex: wizData.stats.dex,
    con: wizData.stats.con,
    int_: wizData.stats.int,
    wis: wizData.stats.wis,
    cha: wizData.stats.cha,
    equipo: [],
    dinero: 0,
    habilidades: [
      ...(wizData.cls?.f1||[]).slice(0,3).map(f=>f.n),
      ...(wizData.background?.tr||[]).slice(0,2).map(t=>t.n)
    ],
    notas: [
      wizData.race?.n ? 'Raza: '+wizData.race.n : '',
      wizData.cls?.n ? 'Clase: '+wizData.cls.n+' (d'+wizData.cls.hd+')' : '',
      wizData.background?.n ? 'Trasfondo: '+wizData.background.n : '',
      wizData.cls?.pf ? 'Competencias: '+wizData.cls.pf : '',
      wizData.background?.pf ? 'Habilidades trasfondo: '+wizData.background.pf : '',
    ].filter(Boolean).join('\n')
  };

  document.getElementById('wiz-next').textContent = 'Guardando...';
  document.getElementById('wiz-next').disabled = true;

  const { data, error } = await sb.from('characters').insert(pc).select();
  if(error) {
    alert('Error al guardar: ' + error.message);
    document.getElementById('wiz-next').textContent = '? Guardar personaje';
    document.getElementById('wiz-next').disabled = false;
    return;
  }
  console.log("FINAL STATS:", wizData.stats);
  closeWizard();
  showToast('¡'+wizData.nombre+' creado! ?');
  await loadAll();
}
// =====================================================


// ===== DICE ENGINE =====
const IS_DM = true;
let _diceState = { sel:20, adv:'normal', trayOpen:false, logOpen:false };
let diceRolls = [];

function rollDie(s){ return Math.floor(Math.random()*s)+1; }

function diceRoll(label, sides, qty, modifier, advantage, visible, charId, charName) {
  let used=[], dropped=[];
  if(advantage!=='normal' && qty===1) {
    const a=rollDie(sides), b=rollDie(sides);
    used=[advantage==='adv'?Math.max(a,b):Math.min(a,b)];
    dropped=[advantage==='adv'?Math.min(a,b):Math.max(a,b)];
  } else {
    for(let i=0;i<qty;i++) used.push(rollDie(sides));
  }
  const sum=used.reduce((a,b)=>a+b,0);
  const total=sum+modifier;
  const isCrit=sides===20&&qty===1&&used[0]===20;
  const isFail=sides===20&&qty===1&&used[0]===1;
  showRollPop(label,used,dropped,modifier,total,isCrit,isFail,advantage);
  saveRoll(label,qty+'d'+sides,used,sum,modifier,total,advantage,visible,charId,charName);
  return total;
}

function showRollPop(label,used,dropped,mod,total,isCrit,isFail,adv) {
  const pop=document.getElementById('dice-result-pop');
  pop.className='dice-result-pop show'+(isCrit?' crit':isFail?' fail':'');
  const cls=isCrit?'crit':isFail?'fail':'normal';
  const advB=adv==='adv'?'<span style="font-size:10px;background:#1a4a1a;color:#7cca7c;padding:2px 6px;border-radius:2px;font-family:Cinzel,serif"> VENTAJA</span>'
    :adv==='dis'?'<span style="font-size:10px;background:var(--dragon);color:var(--cream);padding:2px 6px;border-radius:2px;font-family:Cinzel,serif"> DESVENTAJA</span>':'';
  const critB=isCrit?'<div style="font-family:Cinzel,serif;font-size:13px;color:var(--gold);margin-top:6px">¡CRÍTICO!</div>'
    :isFail?'<div style="font-family:Cinzel,serif;font-size:13px;color:var(--dragon-bright);margin-top:6px">PIFIA</div>':'';
  const bd=dropped.length?'['+used.join(',')+'] ~~'+dropped.join(',')+'~~':'['+used.join(' + ')+']';
  const modS=mod?(mod>0?' +':' ')+mod:'';
  pop.innerHTML=`<div class="roll-label">${label}${advB}</div>
    <div class="roll-total ${cls}">${total}</div>${critB}
    <div class="roll-breakdown">${bd}${modS}</div>
    <button class="btn small" onclick="closeRollPop()" style="margin-top:12px">Cerrar</button>`;
  clearTimeout(window._rpt);
  window._rpt=setTimeout(closeRollPop,4000);
}
function closeRollPop(){ document.getElementById('dice-result-pop').classList.remove('show'); }

async function saveRoll(rollType, dice, results, sum, modifier, grandTotal, advantage, visible, charId, charName) {
  // Update local array immediately — don't wait for Realtime (blocked by Edge)
  const entry = {
    id: 'local-' + Date.now(),
    campaign_id: campaignId,
    character_id: charId || null,
    character_name: charName || (IS_DM ? 'DM' : '?'),
    roll_type: rollType, dice, results, total: sum,
    modifier, grand_total: grandTotal, advantage,
    is_dm: IS_DM, visible_to_players: visible,
    created_at: new Date().toISOString()
  };
  diceRolls.unshift(entry);
  if(diceRolls.length > 100) diceRolls.pop();
  renderDiceLog();
  if(typeof renderDMRollLog === 'function') renderDMRollLog();

  // Persist to Supabase async (for other players)
  if(campaignId) {
    sb.from('dice_rolls').insert({
      campaign_id: campaignId, character_id: charId || null,
      character_name: charName || (IS_DM ? 'DM' : '?'),
      roll_type: rollType, dice, results, total: sum,
      modifier, grand_total: grandTotal, advantage,
      is_dm: IS_DM, visible_to_players: visible
    }).then(({error}) => { if(error) console.warn('saveRoll DB:', error.message); });
  }
}

function myCharId(){ return typeof myCharacter!=='undefined'?myCharacter?.id:null; }
function myCharName(){ return typeof myCharacter!=='undefined'?myCharacter?.nombre:(IS_DM?'DM':''); }

function _renderDiceLogBase(rolls) {
  if(rolls) diceRolls=rolls;
  const el=document.getElementById('dice-log-body');
  if(!el) return;
  const shown=IS_DM?diceRolls:diceRolls.filter(r=>r.visible_to_players||r.character_id===myCharId());
  if(!shown.length){ el.innerHTML='<div class="empty-state">Sin tiradas aún.</div>'; return; }
  el.innerHTML=[...shown].slice(0,50).map(r=>{
    const isCrit=r.dice&&r.dice.endsWith('d20')&&(r.grand_total-r.modifier===20);
    const isFail=r.dice&&r.dice.endsWith('d20')&&(r.grand_total-r.modifier===1);
    const cls=isCrit?'crit-roll':isFail?'fail-roll':r.is_dm?'dm-roll':'player-roll';
    const modS=r.modifier?(r.modifier>0?'+':'')+r.modifier:'';
    const ts=new Date(r.created_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
    const hidden=!r.visible_to_players?' 🤫':'';
    const advS=r.advantage==='adv'?' ▲':r.advantage==='dis'?' ▼':'';
    return `<div class="log-entry ${cls}">
      <span class="log-total">${r.grand_total}</span>
      <div class="log-who">${r.character_name||'?'}${r.is_dm?' (DM)':''}${hidden} · ${ts}</div>
      <div class="log-type">${r.roll_type}${advS}</div>
      <div class="log-dice">${r.dice}${modS} → [${(r.results||[]).join(', ')}]</div>
    </div>`;
  }).join('');
}

function toggleTray(){
  _diceState.trayOpen=!_diceState.trayOpen;
  document.getElementById('dice-tray').classList.toggle('open',_diceState.trayOpen);
  document.getElementById('dice-tray-toggle').textContent=_diceState.trayOpen?'✕':'🎲';
}
function toggleLog(){
  _diceState.logOpen=!_diceState.logOpen;
  document.getElementById('dice-log-panel').classList.toggle('open',_diceState.logOpen);
}
function selectDie(s){
  _diceState.sel=s;
  document.querySelectorAll('.dice-btn').forEach(b=>b.classList.toggle('active',+b.dataset.sides===s));
}
function setAdv(mode){
  _diceState.adv=_diceState.adv===mode?'normal':mode;
  document.getElementById('adv-btn').classList.toggle('active-adv',_diceState.adv==='adv');
  document.getElementById('dis-btn').classList.toggle('active-dis',_diceState.adv==='dis');
}
function rollSelected(){
  const qty=+document.getElementById('dice-qty').value||1;
  const mod=+document.getElementById('dice-mod').value||0;
  diceRoll('d'+_diceState.sel,_diceState.sel,qty,mod,_diceState.adv,true,myCharId(),myCharName());
}
function quickRoll(label,mod,visible){
  diceRoll(label,20,1,mod||0,_diceState.adv,visible!==false,myCharId(),myCharName());
}
function rollAttack(name,atkMod,dmgDice,dmgMod){
  diceRoll('Ataque: '+name,20,1,atkMod||0,_diceState.adv,true,myCharId(),myCharName());
  setTimeout(()=>{
    const parts=(dmgDice||'1d6').split('d');
    diceRoll('Daño: '+name,+parts[1]||6,+parts[0]||1,dmgMod||0,'normal',true,myCharId(),myCharName());
  },350);
}
function subscribeDiceRolls(){
  if(!campaignId) return;
  sb.channel('dice-'+campaignId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'dice_rolls',filter:'campaign_id=eq.'+campaignId},
      payload=>{
        const r=payload.new;
        if(IS_DM||r.visible_to_players||r.character_id===myCharId()){
          diceRolls.unshift(r);
          if(diceRolls.length>80) diceRolls.pop();
          renderDiceLog();
          if(!_diceState.logOpen){
            const b=document.getElementById('log-toggle-btn');
            if(b){b.style.color='var(--gold)';setTimeout(()=>b.style.color='',2000);}
          }
        }
      }).subscribe();
}
async function loadDiceRolls(){
  if(!campaignId) return;
  let q=sb.from('dice_rolls').select('*').eq('campaign_id',campaignId).order('created_at',{ascending:false}).limit(60);
  if(!IS_DM) q=q.eq('visible_to_players',true);
  const {data}=await q;
  renderDiceLog(data||[]);
}
async function clearDiceLog(){
  if(!confirm('¿Limpiar historial de tiradas?')) return;
  await sb.from('dice_rolls').delete().eq('campaign_id',campaignId);
  diceRolls=[];
  renderDiceLog();
}
// ===== END DICE ENGINE =====


// ===== DM EXTRA DICE =====
let dmAdvState='normal', dmPCAdvState='normal';
function dmSetAdv(m){ dmAdvState=dmAdvState===m?'normal':m; document.getElementById('dm-adv-btn').classList.toggle('active-adv',dmAdvState==='adv'); document.getElementById('dm-dis-btn').classList.toggle('active-dis',dmAdvState==='dis'); }
function dmPCSetAdv(m){ dmPCAdvState=dmPCAdvState===m?'normal':m; document.getElementById('dm-pc-adv').classList.toggle('active-adv',dmPCAdvState==='adv'); document.getElementById('dm-pc-dis').classList.toggle('active-dis',dmPCAdvState==='dis'); }

function dmCustomRoll(){
  const label=document.getElementById('dm-roll-label').value.trim()||'Tirada del DM';
  const dstr=document.getElementById('dm-roll-dice').value.trim()||'1d20';
  const mod=+document.getElementById('dm-roll-mod').value||0;
  const visible=document.getElementById('dm-roll-visible').checked;
  const parts=dstr.split('d'); const sides=+parts[1]||20; const qty=+parts[0]||1;
  diceRoll(label,sides,qty,mod,dmAdvState,visible,null,'DM');
}
function dmSecretRoll(){
  const label=(document.getElementById('dm-roll-label').value.trim()||'Tirada secreta')+' 🤫';
  const dstr=document.getElementById('dm-roll-dice').value.trim()||'1d20';
  const mod=+document.getElementById('dm-roll-mod').value||0;
  const parts=dstr.split('d');
  diceRoll(label,+parts[1]||20,+parts[0]||1,mod,dmAdvState,false,null,'DM');
}

function refreshDMPCSelect(){
  const sel=document.getElementById('dm-pc-target');
  if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">— Seleccionar PC —</option>'+pcs.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('');
  if(cur) sel.value=cur;
}

function sMod(pc,st){
  const m={str:pc.str,dex:pc.dex,con:pc.con,int:pc.int_,wis:pc.wis,cha:pc.cha};
  return Math.floor(((m[st]||10)-10)/2);
}

function dmRollForPC(){
  const pcId=document.getElementById('dm-pc-target').value;
  if(!pcId){showToast('Selecciona un PC');return;}
  const pc=pcs.find(p=>p.id===pcId); if(!pc) return;
  const sel=document.getElementById('dm-pc-roll-type');
  const rollType=sel.value;
  const label=sel.options[sel.selectedIndex].text;
  const statMap={initiative:'dex',str_check:'str',dex_check:'dex',con_check:'con',int_check:'int',wis_check:'wis',cha_check:'cha',str_save:'str',dex_save:'dex',con_save:'con',int_save:'int',wis_save:'wis',cha_save:'cha',death_save:'con'};
  const mod=sMod(pc,statMap[rollType]||'dex');
  diceRoll(pc.nombre+': '+label,20,1,mod,dmPCAdvState,true,pc.id,pc.nombre);
}

function renderDMRollLog(){
  const el=document.getElementById('dm-roll-log');
  if(!el||!diceRolls.length){if(el)el.innerHTML='<div class="empty-state">Sin tiradas aún.</div>';return;}
  el.innerHTML=[...diceRolls].slice(0,30).map(r=>{
    const isCrit=r.dice&&r.dice.endsWith('d20')&&(r.grand_total-r.modifier===20);
    const isFail=r.dice&&r.dice.endsWith('d20')&&(r.grand_total-r.modifier===1);
    const cls=isCrit?'crit-roll':isFail?'fail-roll':r.is_dm?'dm-roll':'player-roll';
    const modS=r.modifier?(r.modifier>0?'+':'')+r.modifier:'';
    const hidden=!r.visible_to_players?' 🤫':'';
    const ts=new Date(r.created_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
    return `<div class="log-entry ${cls}">
      <span class="log-total">${r.grand_total}</span>
      <div class="log-who">${r.character_name||'?'}${r.is_dm?' (DM)':''}${hidden} · ${ts}</div>
      <div class="log-type">${r.roll_type}${r.advantage==='adv'?' ▲':r.advantage==='dis'?' ▼':''}</div>
      <div class="log-dice">${r.dice}${modS} → [${(r.results||[]).join(', ')}]</div>
    </div>`;
  }).join('');
}
const _baseRDL=renderDiceLog;
function renderDiceLog(rolls){ _renderDiceLogBase(rolls); if(typeof renderDMRollLog==='function') renderDMRollLog(); }
// ===== END DM EXTRA =====


let COMP_DATA = null; // loaded via loadGameData()


// ===== COMPENDIO JUGADORES =====
let _activeComp = 'spells';
let _filtSpells = [];
let _filtItems  = [];
let _filtFeats  = [];

function switchComp(tab) {
  _activeComp = tab;
  ['spells','items','feats'].forEach(t => {
    const p = document.getElementById('cpanel-'+t);
    const b = document.getElementById('ctab-'+t);
    if(p) p.style.display = t===tab ? 'block' : 'none';
    if(b) b.classList.toggle('active', t===tab);
  });
  if(tab==='spells') renderCompSpells();
  if(tab==='items')  renderCompItems();
  if(tab==='feats')  renderCompFeats();
}

(function initCompFilters() {
  if(typeof COMP_DATA === "undefined") return;
  const lvSet=new Set(), scSet=new Set(), tySet=new Set();
  COMP_DATA.spells.forEach(s=>{ if(s.lv!==undefined) lvSet.add(s.lv); if(s.sc) scSet.add(s.sc); });
  COMP_DATA.items.forEach(i=>{ if(i.ty) tySet.add(i.ty); });
  const defaultLabels = {'cs-level':'Todos los niveles','cs-school':'Toda escuela','ci-type':'Todos los tipos'};
  ['cs-level','cs-school','ci-type'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    el.innerHTML=`<option value="">${defaultLabels[id]||''}</option>`;
  });
  [...lvSet].sort((a,b)=>+a-+b).forEach(lv=>{
    const o=document.createElement('option'); o.value=lv;
    o.textContent=lv==='0'?'Truco':'Nivel '+lv;
    document.getElementById('cs-level')?.appendChild(o);
  });
  [...scSet].sort().forEach(sc=>{
    const o=document.createElement('option'); o.value=sc; o.textContent=sc;
    document.getElementById('cs-school')?.appendChild(o);
  });
  [...tySet].sort().forEach(ty=>{
    const o=document.createElement('option'); o.value=ty; o.textContent=ty;
    document.getElementById('ci-type')?.appendChild(o);
  });
})();

function refreshCompPCSelects() {
  ['cs-target-pc','cf-target-pc'].forEach(id=>{
    const sel=document.getElementById(id); if(!sel) return;
    const cur=sel.value;
    sel.innerHTML='<option value="">— Seleccionar PC —</option>'+
      (pcs||[]).map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('');
    if(cur) sel.value=cur;
  });
}

// ── SPELLS ──
function renderCompSpells() {
  if(!COMP_DATA) return;
  if(typeof COMP_DATA === "undefined") return;
  const q  = (document.getElementById('cs-search')?.value||'').toLowerCase();
  const lv = document.getElementById('cs-level')?.value||'';
  const sc = document.getElementById('cs-school')?.value||'';
  _filtSpells = COMP_DATA.spells.filter(s=>{
    if(q && !s.n.toLowerCase().includes(q)) return false;
    if(lv!=='' && s.lv!==lv) return false;
    if(sc && s.sc!==sc) return false;
    return true;
  });
  const el = document.getElementById('cs-list');
  if(!el) return;
  if(!_filtSpells.length){ el.innerHTML='<div class="empty-state">Sin resultados.</div>'; return; }
  const show = _filtSpells.slice(0,100);
  el.innerHTML = show.map((s,i)=>{
    const diceLabel  = s.dice ? `<span class="badge badge-blue" style="margin-left:4px">${s.dice}${s.dt?' '+s.dt:''}</span>` : '';
    const dcLabel    = s.dc   ? `<span class="badge badge-gray" style="margin-left:4px">${s.dc}</span>` : '';
    const typeLabel  = s.atk  ? '<span class="badge badge-red" style="margin-left:4px">ATAQUE</span>'
                     : s.heal ? '<span class="badge badge-green" style="margin-left:4px">CURA</span>' : '';
    const rollBtn    = s.dice  ? `<button class="btn small" style="background:var(--dragon);color:var(--cream);border-color:var(--dragon-bright)" onclick="compRollSpell(${i})">🎲 ${s.dice}</button>` : '';
    return `<div class="comp-row" style="align-items:start;padding:8px 10px">
      <div>
        <div style="font-size:13px;color:var(--cream)">${s.n}${diceLabel}${dcLabel}${typeLabel}</div>
        <div class="card-detail">${s.ti||''}${s.ra?' · '+s.ra:''}${s.du?' · '+s.du:''}</div>
        ${s.tx?`<div class="card-detail" style="margin-top:2px">${s.tx}…</div>`:''}
      </div>
      <div style="font-size:11px;color:var(--cream-dim);padding-top:2px">${s.lv==='0'?'Truco':'Nv '+s.lv}</div>
      <div style="padding-top:2px"><span class="badge badge-blue" style="font-size:9px">${s.sc||''}</span></div>
      <div style="display:flex;flex-direction:column;gap:3px;padding-top:2px">
        <button class="btn small gold" onclick="compAddSpellToPC(${i})">+ PC</button>
        ${rollBtn}
        <button class="btn small" onclick="compSpellNote(${i})">📝 Nota</button>
      </div>
    </div>`;
  }).join('') + (_filtSpells.length>100?`<div class="empty-state">Mostrando 100 de ${_filtSpells.length}. Refina la búsqueda.</div>`:'');
  refreshCompPCSelects();
}

function compRollSpell(idx) {
  const s = _filtSpells[idx]; if(!s||!s.dice) return;
  const m = s.dice.match(/^(\d+)d(\d+)([+-]\d+)?/);
  if(!m) return;
  const qty=+m[1]||1, sides=+m[2]||6, mod=m[3]?(+m[3]):0;
  if(s.atk) {
    diceRoll('Ataque: '+s.n, 20, 1, 0, _diceState?.adv||'normal', false, null, 'DM');
    setTimeout(()=>diceRoll('Daño: '+s.n, sides, qty, mod, 'normal', false, null, 'DM'), 350);
  } else {
    const label = s.heal ? 'Curación: '+s.n : 'Daño: '+s.n;
    diceRoll(label, sides, qty, mod, 'normal', false, null, 'DM');
  }
}

async function compAddSpellToPC(idx) {
  const s = _filtSpells[idx]; if(!s) return;
  const pcId = document.getElementById('cs-target-pc')?.value;
  if(!pcId){ showToast('Selecciona un PC primero'); return; }
  const pc = pcs.find(p=>p.id===pcId); if(!pc) return;
  const habilidades = [...(pc.habilidades||[])];
  habilidades.push({
    nombre: s.n+(s.lv==='0'?' (Truco)':' (Nv'+s.lv+')'),
    tipo: s.atk?'hechizo':s.heal?'heal':'',
    dice: s.dice||'',
    mod: 0,
    desc: [s.ti,s.ra,s.du].filter(Boolean).join(' · '),
    spell_dc: s.dc||''
  });
  await sb.from('characters').update({habilidades}).eq('id',pcId);
  showToast(s.n+' → '+pc.nombre);
  await loadAll(); refreshCompPCSelects();
}

function compSpellNote(idx) {
  const s = _filtSpells[idx]; if(!s) return;
  localState.notas.push({
    text: `[Hechizo] ${s.n} (Nv${s.lv}, ${s.sc}) · ${s.ti} · ${s.ra} · ${s.du}`,
    tag:'importante',
    ts: new Date().toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})
  });
  saveLocalState(); showToast('Hechizo guardado como nota');
}

// ── ITEMS ──
function renderCompItems() {
  if(typeof COMP_DATA === "undefined") return;
  const q  = (document.getElementById('ci-search')?.value||'').toLowerCase();
  const ty = document.getElementById('ci-type')?.value||'';
  const mg = document.getElementById('ci-magic')?.value||'';
  _filtItems = COMP_DATA.items.filter(i=>{
    if(q && !i.n.toLowerCase().includes(q)) return false;
    if(ty && i.ty!==ty) return false;
    if(mg && i.mg!==mg) return false;
    return true;
  });
  const el = document.getElementById('ci-list');
  if(!el) return;
  if(!_filtItems.length){ el.innerHTML='<div class="empty-state">Sin resultados.</div>'; return; }
  const show = _filtItems.slice(0,100);
  el.innerHTML = show.map((it,i)=>{
    const diceLabel  = it.d1 ? `<span class="badge badge-red" style="margin-left:4px">${it.d1}${it.dt?' '+it.dt:''}</span>` : '';
    const bonusLabel = it.ab ? `<span class="badge badge-gold" style="margin-left:4px">+${it.ab}</span>` : '';
    const healLabel  = it.hd ? `<span class="badge badge-green" style="margin-left:4px">${it.hd} cura</span>` : '';
    const acLabel    = it.ac ? `<span class="badge badge-blue" style="margin-left:4px">CA ${it.ac}</span>` : '';
    const rollDice   = it.d1||it.hd;
    const rollBtn    = rollDice ? `<button class="btn small" style="background:var(--dragon);color:var(--cream);border-color:var(--dragon-bright)" onclick="compRollItem(${i})">🎲 ${rollDice}</button>` : '';
    return `<div class="item-comp-row" style="align-items:start;padding:8px 10px">
      <div>
        <div style="font-size:13px;color:var(--cream)">${it.n}${it.mg==='YES'?'<span class="badge badge-gold" style="margin-left:4px">Mágico</span>':''}${diceLabel}${bonusLabel}${healLabel}${acLabel}</div>
        ${it.tx?`<div class="card-detail" style="margin-top:2px">${it.tx}…</div>`:''}
      </div>
      <div style="padding-top:2px"><span class="badge badge-gray" style="font-size:9px">${it.ty||''}</span></div>
      <div style="font-size:12px;color:var(--gold);padding-top:2px">${it.vl?it.vl+' po':'—'}</div>
      <div style="display:flex;flex-direction:column;gap:3px;padding-top:2px">
        <button class="btn small gold" onclick="compAddItemToShop(${i})">🏪 Tienda</button>
        ${rollBtn}
        <button class="btn small" onclick="compItemNote(${i})">📝 Nota</button>
      </div>
    </div>`;
  }).join('') + (_filtItems.length>100?`<div class="empty-state">Mostrando 100 de ${_filtItems.length}.</div>`:'');
}

function compRollItem(idx) {
  const it = _filtItems[idx]; if(!it) return;
  const dice = it.d1||it.hd; if(!dice) return;
  const m = dice.match(/^(\d+)d(\d+)([+-]\d+)?/);
  if(!m) return;
  const qty=+m[1]||1, sides=+m[2]||6, mod=(m[3]?(+m[3]):0)+(it.ab||0);
  const label = it.hd ? 'Curación: '+it.n : 'Daño: '+it.n;
  diceRoll(label, sides, qty, mod, 'normal', false, null, 'DM');
}

function compAddItemToShop(idx) {
  const it = _filtItems[idx]; if(!it) return;
  showItemShopPopup(it);
}

function showItemShopPopup(it) {
  let modal = document.getElementById('comp-shop-modal');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'comp-shop-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(modal);
  }
  // Build shop options from existing locations
  const shopOptions = (locations||[]).length
    ? (locations||[]).map(l=>`<option value="${l.id}" data-name="${l.nombre}">${l.nombre}</option>`).join('')
    : '<option value="">Sin tiendas creadas aún</option>';

  const suggestedPrice = parseFloat(it.vl)||0;

  modal.innerHTML = `
    <div style="background:var(--parchment-2);border:2px solid var(--gold);border-radius:6px;padding:22px;width:100%;max-width:460px">
      <div style="font-family:'Cinzel',serif;color:var(--gold);font-size:15px;letter-spacing:1px;margin-bottom:4px">🏪 Añadir a tienda</div>
      <div style="font-size:13px;color:var(--cream-dim);margin-bottom:14px">${it.n}${it.d1?` · <span style="color:var(--gold)">${it.d1} ${it.dt||''}</span>`:''}${it.ac?` · CA ${it.ac}`:''}</div>

      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Tienda destino</label>
        <select class="select" id="csp-shop">${shopOptions}</select>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Categoría / ranura de equipo</label>
        <select class="select" id="csp-cat">
          <option value="arma_1m"${it.cat==='arma_1m'?' selected':''}>⚔ Arma (1 mano)</option>
          <option value="arma_2m"${it.cat==='arma_2m'?' selected':''}>⚔ Arma (2 manos)</option>
          <option value="escudo"${it.cat==='escudo'?' selected':''}>🛡 Escudo / Secundaria</option>
          <option value="armadura"${it.cat==='armadura'?' selected':''}>🥋 Armadura</option>
          <option value="casco"${it.cat==='casco'?' selected':''}>⛑ Casco</option>
          <option value="guantes"${it.cat==='guantes'?' selected':''}>🧤 Guantes</option>
          <option value="botas"${it.cat==='botas'?' selected':''}>👢 Botas</option>
          <option value="capa"${it.cat==='capa'?' selected':''}>🧥 Capa</option>
          <option value="cinturon"${it.cat==='cinturon'?' selected':''}>Cinturón</option>
          <option value="anillo"${it.cat==='anillo'?' selected':''}>💍 Anillo</option>
          <option value="amuleto"${it.cat==='amuleto'?' selected':''}>📿 Amuleto</option>
          <option value="otro"${it.cat==='otro'?' selected':''}>📦 Otro (sin ranura)</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div class="form-group">
          <label class="form-label">Precio (po)</label>
          <input class="input" id="csp-price" type="number" value="${suggestedPrice}" style="text-align:center">
        </div>
        <div class="form-group">
          <label class="form-label">Cantidad (vacío=∞)</label>
          <input class="input" id="csp-qty" type="number" placeholder="Ilimitado" style="text-align:center">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:14px">
        <div class="form-group">
          <label class="form-label">Dado de daño</label>
          <input class="input" id="csp-dice" value="${it.d1||''}" placeholder="1d8" style="text-align:center">
        </div>
        <div class="form-group">
          <label class="form-label">Mod. ataque/daño</label>
          <input class="input" id="csp-ab" type="number" value="${it.ab||0}" style="text-align:center">
        </div>
        <div class="form-group">
          <label class="form-label">Dado curación</label>
          <input class="input" id="csp-hd" value="${it.hd||''}" placeholder="2d4+2" style="text-align:center">
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn gold" style="flex:1" onclick="saveItemToShop()">✓ Añadir a tienda</button>
        <button class="btn" onclick="document.getElementById('comp-shop-modal').style.display='none'">Cancelar</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
  modal._item = it;
}

async function saveItemToShop() {
  const modal = document.getElementById('comp-shop-modal');
  const it = modal._item; if(!it) return;
  const shopSel = document.getElementById('csp-shop');
  const locId   = shopSel?.value||null;
  const shopName= shopSel?.options[shopSel.selectedIndex]?.dataset.name || shopSel?.options[shopSel.selectedIndex]?.text || 'Tienda';
  const cat     = document.getElementById('csp-cat')?.value||'otro';
  const price   = +document.getElementById('csp-price')?.value||0;
  const qtyRaw  = document.getElementById('csp-qty')?.value;
  const qty     = qtyRaw===''||qtyRaw===null ? null : Math.max(0,+qtyRaw);
  const d1      = document.getElementById('csp-dice')?.value.trim()||null;
  const ab      = +document.getElementById('csp-ab')?.value||0;
  const hd      = document.getElementById('csp-hd')?.value.trim()||null;

  const shopItem = {
    campaign_id: campaignId,
    location_id: locId||null,
    shop_name: shopName,
    nombre: it.n,
    tipo: it.ty + (d1 ? ' · '+d1+(it.dt?' '+it.dt:'') : it.d1 ? ' · '+it.d1+(it.dt?' '+it.dt:'') : '') + (it.ac ? ' · CA '+it.ac : ''),
    categoria: cat,
    precio: price,
    cantidad: qty,
    mod_stats: {},
    dice_type: d1?'weapon':hd?'heal':null,
    atk_mod: ab,
    dmg_dice: d1||null,
    dmg_mod: ab,
    spell_dc: null,
    visible: true
  };
  const {error} = await sb.from('shop_items').insert(shopItem);
  if(error){ alert('Error: '+error.message); return; }
  modal.style.display = 'none';
  showToast(it.n+' → '+shopName);
  await loadAll();
}

function compItemNote(idx) {
  const it = _filtItems[idx]; if(!it) return;
  localState.notas.push({
    text: `[Objeto] ${it.n} (${it.ty}) · ${it.vl||'?'} po${it.d1?' · '+it.d1+' '+it.dt:''}${it.ac?' · CA '+it.ac:''}`,
    tag:'general',
    ts: new Date().toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})
  });
  saveLocalState(); showToast('Objeto guardado como nota');
}

// ── FEATS / TRAITS ──
function renderCompFeats() {
  if(typeof COMP_DATA === "undefined") return;
  const q = (document.getElementById('cf-search')?.value||'').toLowerCase();
  _filtFeats = COMP_DATA.feats.filter(f=>!q||f.n.toLowerCase().includes(q)||(f.tx||'').toLowerCase().includes(q));
  const el = document.getElementById('cf-list');
  if(!el) return;
  if(!_filtFeats.length){ el.innerHTML='<div class="empty-state">Sin resultados.</div>'; return; }
  el.innerHTML = _filtFeats.slice(0,80).map((f,i)=>`
    <div class="feat-comp-row">
      <div>
        <div style="font-size:13px;color:var(--cream)">${f.n}</div>
        ${f.pr?`<div class="card-detail">Prerreq: ${f.pr}</div>`:''}
        ${f.tx?`<div class="card-detail" style="margin-top:2px">${f.tx}…</div>`:''}
      </div>
      <button class="btn small gold" onclick="compAddFeatToPC(${i})">+ PC</button>
    </div>`).join('');
  refreshCompPCSelects();
}

async function compAddFeatToPC(idx) {
  const f = _filtFeats[idx]; if(!f) return;
  const pcId = document.getElementById('cf-target-pc')?.value;
  if(!pcId){ showToast('Selecciona un PC primero'); return; }
  const pc = pcs.find(p=>p.id===pcId); if(!pc) return;
  const habilidades = [...(pc.habilidades||[])];
  habilidades.push({
    nombre: f.n, tipo:'', dice:'', mod:0,
    desc: (f.pr?'Prerreq: '+f.pr+' · ':'')+((f.tx||'').slice(0,100)),
    spell_dc:''
  });
  await sb.from('characters').update({habilidades}).eq('id',pcId);
  showToast(f.n+' → '+pc.nombre);
  await loadAll(); refreshCompPCSelects();
}

// Init — defer until after DOM and COMP_DATA are ready
document.querySelector('.tab[data-tab="compendio"]')?.addEventListener('click', ()=>{
  // Re-run filter population in case it was skipped on first load
  if(document.getElementById('cs-level')?.options.length <= 1) {
    const defaultLabels2 = {'cs-level':'Todos los niveles','cs-school':'Toda escuela','ci-type':'Todos los tipos'};
    ['cs-level','cs-school','ci-type'].forEach(id=>{
      const el=document.getElementById(id); if(!el||el.options.length>1) return;
      el.innerHTML=`<option value="">${defaultLabels2[id]||''}</option>`;
    });
    const lvSet=new Set(), scSet=new Set(), tySet=new Set();
    COMP_DATA.spells.forEach(s=>{ if(s.lv!==undefined) lvSet.add(s.lv); if(s.sc) scSet.add(s.sc); });
    COMP_DATA.items.forEach(i=>{ if(i.ty) tySet.add(i.ty); });
    [...lvSet].sort((a,b)=>+a-+b).forEach(lv=>{
      const o=document.createElement('option'); o.value=lv;
      o.textContent=lv==='0'?'Truco':'Nivel '+lv;
      document.getElementById('cs-level')?.appendChild(o);
    });
    [...scSet].sort().forEach(sc=>{
      const o=document.createElement('option'); o.value=sc; o.textContent=sc;
      document.getElementById('cs-school')?.appendChild(o);
    });
    [...tySet].sort().forEach(ty=>{
      const o=document.createElement('option'); o.value=ty; o.textContent=ty;
      document.getElementById('ci-type')?.appendChild(o);
    });
  }
  renderCompSpells();
});
// ===== END COMPENDIO JUGADORES =====


// ===== VTT ENGINE =====
let vttTokens    = [];
let vttMapUrl    = '';
let vttGridSize  = 50;
let vttTool      = 'select';
let vttDragging  = null;
let vttDragOffX  = 0, vttDragOffY = 0;
let vttMapImg    = null;
let vttPingAnim  = null;
let vttCanvas    = null, vttCtx = null;

const VTT_COLORS = {
  player: '#c9a227',   // gold
  enemy:  '#8b1a1a',   // red
  neutral:'#3d6b8a'    // blue
};

// ── Init ──
function vttInit() {
  vttCanvas = document.getElementById('vtt-canvas');
  if(!vttCanvas) return;
  vttCtx = vttCanvas.getContext('2d');
  vttCanvas.addEventListener('mousedown',  vttOnMouseDown);
  vttCanvas.addEventListener('mousemove',  vttOnMouseMove);
  vttCanvas.addEventListener('mouseup',    vttOnMouseUp);
  vttCanvas.addEventListener('mouseleave', vttOnMouseUp);
  vttCanvas.addEventListener('dblclick',   vttOnDblClick);
  // Touch support
  vttCanvas.addEventListener('touchstart', e=>{ e.preventDefault(); vttOnMouseDown(e.touches[0]); }, {passive:false});
  vttCanvas.addEventListener('touchmove',  e=>{ e.preventDefault(); vttOnMouseMove(e.touches[0]); }, {passive:false});
  vttCanvas.addEventListener('touchend',   e=>{ e.preventDefault(); vttOnMouseUp(e.changedTouches[0]); }, {passive:false});
  vttRender();
}

// ── Tool ──
function vttSetTool(tool) {
  vttTool = tool;
  document.querySelectorAll('.vtt-tool-btn[id^="vtt-tool-"]').forEach(b=>{
    b.classList.toggle('active', b.id==='vtt-tool-'+tool);
  });
  vttCanvas.style.cursor = tool==='ping' ? 'crosshair' : 'default';
}

// ── Map ──
async function vttLoadMap() {
  const url = document.getElementById('vtt-map-url').value.trim();
  if(!url) return;
  vttMapUrl = url;
  vttGridSize = +document.getElementById('vtt-grid-size').value || 50;
  // Save to supabase
  if(campaignId) {
    const {data:existing} = await sb.from('vtt_maps').select('id').eq('campaign_id',campaignId).maybeSingle();
    if(existing) {
      await sb.from('vtt_maps').update({url,grid_size:vttGridSize,active:true}).eq('id',existing.id);
    } else {
      await sb.from('vtt_maps').insert({campaign_id:campaignId,url,grid_size:vttGridSize,active:true,nombre:'Mapa'});
    }
  }
  vttLoadMapImage(url);
}

function vttLoadMapImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    vttMapImg = img;
    // Resize canvas to match map proportions
    const maxW = 900, maxH = 600;
    const ratio = Math.min(maxW/img.width, maxH/img.height, 1);
    vttCanvas.width  = Math.round(img.width * ratio);
    vttCanvas.height = Math.round(img.height * ratio);
    vttRender();
  };
  img.onerror = () => {
    showToast('No se pudo cargar el mapa. Verifica la URL.');
    vttRender();
  };
  img.src = url;
}

// ── Tokens from combat ──
async function vttAddSelectedCombatants() {
  if(!campaignId) return;
  const {data:combList} = await sb.from('combatants').select('*').eq('campaign_id',campaignId);
  if(!combList||!combList.length){ showToast('No hay combatientes. Añade primero desde la pestaña Combate.'); return; }
  const existing = new Set(vttTokens.map(t=>t.entity_id));
  const toAdd = combList.filter(c=>!existing.has(c.id));
  if(!toAdd.length){ showToast('Todos los combatientes ya están en el VTT'); return; }
  const rows = toAdd.map((c,i)=>({
    campaign_id: campaignId,
    entity_id: c.id, entity_type: c.tipo||'enemy',
    nombre: c.nombre, hp_curr: c.hp_curr, hp_max: c.hp_max,
    x: 80 + (i%8)*70, y: 80 + Math.floor(i/8)*70,
    color: VTT_COLORS[c.tipo]||VTT_COLORS.enemy,
    visible_to_players: c.visible_to_players, show_hp: true,
    size: 40
  }));
  const {error:ce} = await sb.from('vtt_tokens').insert(rows);
  if(ce) { alert('Error añadiendo tokens: '+ce.message); return; }
  showToast(rows.length+' tokens añadidos al VTT');
  await vttGotoAndShow();
}

async function vttAddPCs() {
  if(!campaignId||!pcs) return;
  const existing = new Set(vttTokens.map(t=>t.entity_id));
  const toAdd = pcs.filter(p=>!existing.has(p.id));
  if(!toAdd.length){ showToast('Todos los PCs ya están en el VTT'); return; }
  const rows = toAdd.map((p,i)=>({
    campaign_id: campaignId,
    entity_id: p.id, entity_type: 'player',
    nombre: p.nombre, hp_curr: p.hp_curr, hp_max: p.hp_max,
    x: 80 + (i%8)*70, y: 500,
    color: VTT_COLORS.player,
    visible_to_players: true, show_hp: true,
    size: 40
  }));
  const {error:pe} = await sb.from('vtt_tokens').insert(rows);
  if(pe) { alert('Error añadiendo PCs: '+pe.message); return; }
  showToast(rows.length+' PCs añadidos al VTT');
  await vttGotoAndShow();
}

async function vttClearTokens() {
  if(!confirm('¿Eliminar todos los tokens del VTT?')) return;
  await sb.from('vtt_tokens').delete().eq('campaign_id',campaignId);
  vttTokens = [];
  vttRender(); vttRenderTokenList();
}

async function vttRemoveToken(id) {
  await sb.from('vtt_tokens').delete().eq('id',id);
}

async function vttToggleVisible(id, val) {
  await sb.from('vtt_tokens').update({visible_to_players:val}).eq('id',id);
}

async function vttSyncHPFromCombat() {
  // Sync HP from combatants table into vtt_tokens
  const {data:combList} = await sb.from('combatants').select('*').eq('campaign_id',campaignId);
  if(!combList) return;
  for(const t of vttTokens) {
    if(t.entity_type==='player') {
      const pc = (pcs||[]).find(p=>p.id===t.entity_id);
      if(pc && (pc.hp_curr!==t.hp_curr||pc.hp_max!==t.hp_max)) {
        await sb.from('vtt_tokens').update({hp_curr:pc.hp_curr,hp_max:pc.hp_max}).eq('id',t.id);
      }
    } else {
      const c = combList.find(x=>x.id===t.entity_id);
      if(c && (c.hp_curr!==t.hp_curr||c.hp_max!==t.hp_max)) {
        await sb.from('vtt_tokens').update({hp_curr:c.hp_curr,hp_max:c.hp_max}).eq('id',t.id);
      }
    }
  }
}

// ── Load VTT data ──
async function vttLoad() {
  if(!campaignId) return;
  try {
    const [tokRes, mapRes] = await Promise.all([
      sb.from('vtt_tokens').select('*').eq('campaign_id', campaignId),
      sb.from('vtt_maps').select('*').eq('campaign_id', campaignId).eq('active', true).maybeSingle()
    ]);
    if(tokRes.error) { console.error('[VTT] vtt_tokens error:', tokRes.error.message); }
    else { vttTokens = tokRes.data || []; }

    const maps = mapRes.data;
    if(maps) {
      vttGridSize = maps.grid_size || 50;
      if(maps.url && maps.url !== vttMapUrl) {
        vttMapUrl = maps.url;
        const el = document.getElementById('vtt-map-url');
        if(el) el.value = maps.url;
        vttLoadMapImage(maps.url);
        return; // render called after image loads
      }
    }
    if(vttCtx) vttRender();
    vttRenderTokenList();
  } catch(e) {
    console.error('[VTT] vttLoad exception:', e);
  }
}

// ── Subscribe ──
function vttSubscribe() {
  if(!campaignId) return;
  sb.channel('vtt-dm-'+campaignId)
    .on('postgres_changes',{event:'*',schema:'public',table:'vtt_tokens',filter:`campaign_id=eq.${campaignId}`}, ()=>{
      vttLoad();
    })
    .subscribe();
}

// ── Drag ──
function vttGetCanvasPos(e) {
  const rect = vttCanvas.getBoundingClientRect();
  const scaleX = vttCanvas.width  / rect.width;
  const scaleY = vttCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY
  };
}

function vttTokenAt(x, y) {
  return [...vttTokens].reverse().find(t=>{
    const r = (t.size||40)/2;
    return Math.hypot(x-t.x, y-t.y) <= r;
  });
}

function vttOnMouseDown(e) {
  const {x,y} = vttGetCanvasPos(e);
  if(vttTool==='ping') {
    vttDoPing(x,y); return;
  }
  const token = vttTokenAt(x,y);
  if(token) {
    vttDragging  = token;
    vttDragOffX  = x - token.x;
    vttDragOffY  = y - token.y;
    vttCanvas.style.cursor = 'grabbing';
  }
}

function vttOnMouseMove(e) {
  if(!vttDragging) return;
  const {x,y} = vttGetCanvasPos(e);
  vttDragging.x = x - vttDragOffX;
  vttDragging.y = y - vttDragOffY;
  vttRender();
}

function vttOnMouseUp(e) {
  if(!vttDragging) return;
  const token = vttDragging;
  vttDragging = null;
  vttCanvas.style.cursor = 'default';
  // Snap to grid
  const g = vttGridSize||50;
  token.x = Math.round(token.x / g) * g + g/2;
  token.y = Math.round(token.y / g) * g + g/2;
  // Save to Supabase
  sb.from('vtt_tokens').update({x:token.x, y:token.y}).eq('id',token.id);
  vttRender();
}

function vttOnDblClick(e) {
  const {x,y} = vttGetCanvasPos(e);
  const token = vttTokenAt(x,y);
  if(token) vttEditTokenHP(token);
}

async function vttEditTokenHP(token) {
  const hp = prompt(`HP actual de ${token.nombre} (máx ${token.hp_max}):`, token.hp_curr);
  if(hp===null) return;
  const newHp = Math.max(0, Math.min(token.hp_max, +hp));
  token.hp_curr = newHp;
  await sb.from('vtt_tokens').update({hp_curr:newHp}).eq('id',token.id);
  // Also update combatant if linked
  if(token.entity_id && token.entity_type!=='player') {
    await sb.from('combatants').update({hp_curr:newHp}).eq('id',token.entity_id);
  }
  vttRender();
}

function vttDoPing(x,y) {
  vttPingAnim = {x,y,r:0,max:60,t:Date.now()};
  vttAnimatePing();
  // Broadcast ping via vtt_maps update (simple way to share)
}

function vttAnimatePing() {
  if(!vttPingAnim) return;
  vttRender();
  vttPingAnim.r = (Date.now()-vttPingAnim.t)/8;
  if(vttPingAnim.r < vttPingAnim.max) requestAnimationFrame(vttAnimatePing);
  else { vttPingAnim=null; vttRender(); }
}

// ── Render ──
function vttRender() {
  if(!vttCtx) { console.warn('[VTT] vttRender called but vttCtx is null'); return; }
  const ctx = vttCtx;
  const W = vttCanvas.width, H = vttCanvas.height;
  const g = vttGridSize||50;

  // Background
  ctx.fillStyle = '#111a0a';
  ctx.fillRect(0,0,W,H);

  // Map image
  if(vttMapImg) {
    ctx.drawImage(vttMapImg, 0, 0, W, H);
  }

  // Grid
  ctx.strokeStyle = 'rgba(201,162,39,0.15)';
  ctx.lineWidth = 1;
  for(let x=0;x<W;x+=g){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<H;y+=g){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Tokens
  vttTokens.forEach(t => vttDrawToken(ctx, t));

  // Ping animation
  if(vttPingAnim) {
    const p = vttPingAnim;
    ctx.strokeStyle = 'rgba(240,200,64,'+(1-p.r/p.max)+')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.stroke();
  }
}

function vttDrawToken(ctx, t) {
  const r    = (t.size||40)/2;
  const x    = t.x, y = t.y;
  const dead = t.hp_curr<=0;
  const color= t.color||'#c9a227';

  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur  = 8;

  // Token circle
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = dead ? '#333' : color;
  ctx.fill();
  ctx.strokeStyle = dead ? '#666' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Initial letter
  ctx.fillStyle = dead ? '#888' : '#fff';
  ctx.font = `bold ${Math.round(r*0.8)}px Cinzel, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((t.nombre||'?')[0].toUpperCase(), x, y);

  // Name label
  ctx.font = '11px Crimson Text, serif';
  ctx.fillStyle = '#f0e6c8';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeText(t.nombre||'', x, y+r+12);
  ctx.fillText(t.nombre||'', x, y+r+12);

  // HP bar (only if show_hp and has HP)
  if(t.show_hp && t.hp_max>0) {
    const barW = r*2, barH = 6;
    const bx   = x - r, by = y - r - 10;
    const pct  = Math.max(0, t.hp_curr/t.hp_max);
    const barColor = pct>0.6?'#3a8a3a': pct>0.3?'#c9a227':'#8b1a1a';

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx, by, barW, barH);
    // Fill
    ctx.fillStyle = barColor;
    ctx.fillRect(bx, by, Math.round(barW*pct), barH);
    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, barW, barH);

    // HP text
    if(t.entity_type!=='enemy' || t.show_hp) {
      ctx.font = '9px Cinzel, serif';
      ctx.fillStyle = '#f0e6c8';
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 2;
      const hpTxt = t.hp_curr+'/'+t.hp_max;
      ctx.strokeText(hpTxt, x, by+barH/2+0.5);
      ctx.fillText(hpTxt,   x, by+barH/2+0.5);
    }
  }
}

// ── Token list panel ──
function vttRenderTokenList() {
  const el = document.getElementById('vtt-token-list');
  if(!el) return;
  if(!vttTokens.length){ el.innerHTML='<div class="empty-state">Sin tokens. Añade desde el combate o los PCs.</div>'; return; }
  el.innerHTML = vttTokens.map(t=>`
    <div class="vtt-token-row">
      <div class="vtt-token-dot" style="background:${t.color||'#c9a227'}"></div>
      <div style="font-size:12px">${t.nombre}<div style="font-size:10px;color:var(--cream-muted)">${t.entity_type} · ${t.hp_curr}/${t.hp_max} HP</div></div>
      <div style="font-size:10px;color:var(--cream-muted)">${Math.round(t.x)},${Math.round(t.y)}</div>
      <div>
        <label style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--cream-muted);font-family:Cinzel,serif;cursor:pointer">
          <input type="checkbox" ${t.visible_to_players?'checked':''} onchange="vttToggleVisible('${t.id}',this.checked)"> Visible
        </label>
      </div>
      <div><button class="btn small danger" onclick="vttRemoveToken('${t.id}')">✕</button></div>
    </div>`).join('');
}

let vttLoaded = false; // init handled in main tab forEach

async function vttGotoAndShow() {
  // Switch to VTT tab
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const vttTab = document.querySelector('.tab[data-tab="vtt"]');
  if(vttTab) vttTab.classList.add('active');
  const vttPanel = document.getElementById('tab-vtt');
  if(vttPanel) vttPanel.classList.add('active');
  // Init canvas synchronously FIRST, then load data, then render
  if(!vttLoaded) { vttLoaded = true; vttSubscribe(); }
  if(!vttCtx) vttInit();
  await vttLoad();
  vttRender();
  vttRenderTokenList();
}

// ===== END VTT ENGINE =====

// ===== DUNGEON CRAWLER — DM MODULE =====
// Tiles: 0=empty 1=wall 2=door(closed) 3=door(open) 4=start 5=exit 6=trap 7=enemy_spawn
const DUNGEON_TILE = { EMPTY:0, WALL:1, DOOR_C:2, DOOR_O:3, START:4, EXIT:5, TRAP:6, SPAWN:7 };
const DUNGEON_TILE_COLORS = { 0:'transparent', 1:'#7c3aed', 2:'#c77dff', 3:'#86efac',
  4:'#fbbf24', 5:'#34d399', 6:'#ef4444', 7:'#f97316' };
const DUNGEON_TILE_LABELS = { 0:'·', 1:'▪', 2:'🚪', 3:'🔓', 4:'★', 5:'🏁', 6:'⚠', 7:'👾' };

let dungeonMaps     = [];
let dungeonActive   = null; // current map being edited
let dungeonPlayers  = [];
let dungeonEnemies  = [];
let dungeonBrush    = DUNGEON_TILE.WALL;
let dungeonDrawing  = false;

const DG_W = 20, DG_H = 15; // default grid size

function dungeonEmptyGrid(w=DG_W, h=DG_H) {
  return Array.from({length:h}, (_,y) =>
    Array.from({length:w}, (_,x) =>
      (x===0||y===0||x===w-1||y===h-1) ? DUNGEON_TILE.WALL : DUNGEON_TILE.EMPTY
    )
  );
}

// ── Load / Save ──
async function dungeonLoad() {
  if(!campaignId) return;
  const [{data:maps},{data:players},{data:enemies}] = await Promise.all([
    sb.from('dungeon_maps').select('*').eq('campaign_id',campaignId).order('created_at'),
    sb.from('dungeon_players').select('*').eq('campaign_id',campaignId),
    sb.from('dungeon_enemies').select('*').eq('campaign_id',campaignId)
  ]);
  dungeonMaps    = maps    || [];
  dungeonPlayers = players || [];
  dungeonEnemies = enemies || [];
  if(!dungeonActive && dungeonMaps.length) dungeonActive = dungeonMaps[0];
  dungeonRenderEditor();
  dungeonRenderMapList();
}

async function dungeonNewMap() {
  const name = prompt('Nombre del dungeon:', 'Mazmorra 1');
  if(!name) return;
  const grid = dungeonEmptyGrid();
  const {data, error} = await sb.from('dungeon_maps').insert({
    campaign_id: campaignId, nombre: name,
    grid: JSON.stringify(grid), width: DG_W, height: DG_H, active: false
  }).select().single();
  if(error) { alert('Error: '+error.message); return; }
  dungeonMaps.push(data);
  dungeonActive = data;
  dungeonRenderMapList();
  dungeonRenderEditor();
}

async function dungeonSaveGrid() {
  if(!dungeonActive) return;
  const grid = dungeonGetCurrentGrid();
  await sb.from('dungeon_maps').update({grid: JSON.stringify(grid)}).eq('id', dungeonActive.id);
  showToast('Mapa guardado');
}

async function dungeonToggleActive(mapId) {
  // Deactivate all, then activate selected
  await sb.from('dungeon_maps').update({active:false}).eq('campaign_id',campaignId);
  const map = dungeonMaps.find(m=>m.id===mapId);
  if(map) {
    const newActive = !map.active;
    await sb.from('dungeon_maps').update({active:newActive}).eq('id',mapId);
    map.active = newActive;
    showToast(newActive ? '🟢 Dungeon activado para jugadores' : '🔴 Dungeon desactivado');
  }
  await dungeonLoad();
}

async function dungeonDeleteMap(mapId) {
  if(!confirm('¿Eliminar este dungeon?')) return;
  await sb.from('dungeon_enemies').delete().eq('map_id',mapId);
  await sb.from('dungeon_players').delete().eq('map_id',mapId);
  await sb.from('dungeon_maps').delete().eq('id',mapId);
  dungeonMaps = dungeonMaps.filter(m=>m.id!==mapId);
  dungeonActive = dungeonMaps[0] || null;
  dungeonRenderMapList();
  dungeonRenderEditor();
}

// ── Grid editor ──
let _dgGrid = null; // working copy of current grid

function dungeonGetCurrentGrid() {
  return _dgGrid || (dungeonActive ? JSON.parse(dungeonActive.grid) : dungeonEmptyGrid());
}

function dungeonRenderEditor() {
  const el = document.getElementById('dg-editor-area');
  if(!el) return;
  if(!dungeonActive) {
    el.innerHTML = '<div class="empty-state" style="padding:40px">Crea o selecciona un dungeon para editar.</div>';
    return;
  }
  _dgGrid = JSON.parse(dungeonActive.grid);
  const W = dungeonActive.width || DG_W;
  const H = dungeonActive.height || DG_H;
  const CELL = 32;

  el.innerHTML = `
    <canvas id="dg-canvas" width="${W*CELL}" height="${H*CELL}"
      style="display:block;cursor:crosshair;border:1px solid #7c3aed;border-radius:3px"></canvas>`;

  const canvas = document.getElementById('dg-canvas');
  const ctx = canvas.getContext('2d');

  function drawGrid() {
    ctx.fillStyle = '#04030d'; ctx.fillRect(0,0,W*CELL,H*CELL);
    // Grid lines
    ctx.strokeStyle = 'rgba(168,85,247,0.2)'; ctx.lineWidth=1;
    for(let x=0;x<=W;x++){ctx.beginPath();ctx.moveTo(x*CELL,0);ctx.lineTo(x*CELL,H*CELL);ctx.stroke();}
    for(let y=0;y<=H;y++){ctx.beginPath();ctx.moveTo(0,y*CELL);ctx.lineTo(W*CELL,y*CELL);ctx.stroke();}
    // Tiles
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
      const t = _dgGrid[y][x];
      if(t===DUNGEON_TILE.WALL) {
        ctx.fillStyle='rgba(124,58,237,0.8)'; ctx.fillRect(x*CELL+1,y*CELL+1,CELL-2,CELL-2);
        ctx.strokeStyle='#a855f7'; ctx.lineWidth=1;
        ctx.strokeRect(x*CELL+1,y*CELL+1,CELL-2,CELL-2);
      } else if(t!==DUNGEON_TILE.EMPTY) {
        ctx.fillStyle='rgba(168,85,247,0.15)'; ctx.fillRect(x*CELL,y*CELL,CELL,CELL);
        ctx.font=`${CELL*0.6}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(DUNGEON_TILE_LABELS[t]||(t+''), x*CELL+CELL/2, y*CELL+CELL/2);
      }
    }
    // Player positions
    dungeonPlayers.forEach(p=>{
      if(!dungeonActive||p.map_id!==dungeonActive.id) return;
      const pc = (pcs||[]).find(c=>c.id===p.character_id);
      ctx.fillStyle='#fbbf24';
      ctx.beginPath(); ctx.arc(p.x*CELL+CELL/2, p.y*CELL+CELL/2, CELL/3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='#04030d'; ctx.font=`bold ${CELL*0.35}px sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText((pc?.nombre||'?')[0].toUpperCase(), p.x*CELL+CELL/2, p.y*CELL+CELL/2);
    });
  }

  drawGrid();

  function getCell(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX-r.left)/CELL*(W/(canvas.offsetWidth||W*CELL)*CELL)),
      y: Math.floor((e.clientY-r.top)/CELL*(H/(canvas.offsetHeight||H*CELL)*CELL))
    };
  }
  function paint(e) {
    const {x,y} = getCell(e);
    if(x<0||y<0||x>=W||y>=H) return;
    _dgGrid[y][x] = dungeonBrush;
    drawGrid();
  }
  canvas.onmousedown = e=>{ dungeonDrawing=true; paint(e); };
  canvas.onmousemove = e=>{ if(dungeonDrawing) paint(e); };
  canvas.onmouseup  = ()=>{ dungeonDrawing=false; };
  canvas.oncontextmenu = e=>{ e.preventDefault(); dungeonBrush=DUNGEON_TILE.EMPTY; paint(e); };
}

function dungeonRenderMapList() {
  const el = document.getElementById('dg-map-list');
  if(!el) return;
  if(!dungeonMaps.length) {
    el.innerHTML='<div class="empty-state">Sin dungeons. Crea uno con el botón +.</div>'; return;
  }
  el.innerHTML = dungeonMaps.map(m=>`
    <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--leather);cursor:pointer;background:${dungeonActive?.id===m.id?'rgba(168,85,247,0.1)':'transparent'}"
      onclick="dungeonSelectMap('${m.id}')">
      <span style="width:8px;height:8px;border-radius:50%;background:${m.active?'#34d399':'#555'};flex-shrink:0"></span>
      <span style="flex:1;font-size:13px;color:var(--cream)">${m.nombre}</span>
      <button class="btn small ${m.active?'gold':''}" onclick="event.stopPropagation();dungeonToggleActive('${m.id}')"
        style="${m.active?'background:#34d399;color:#000':''}">${m.active?'🟢 Activo':'Activar'}</button>
      <button class="btn small danger" onclick="event.stopPropagation();dungeonDeleteMap('${m.id}')">✕</button>
    </div>`).join('');
}

async function dungeonSelectMap(id) {
  await dungeonSaveGrid(); // save current before switching
  dungeonActive = dungeonMaps.find(m=>m.id===id);
  _dgGrid = null;
  dungeonRenderMapList();
  dungeonRenderEditor();
  dungeonRenderEnemyList();
}

// ── Enemy management ──
function dungeonRenderEnemyList() {
  const el = document.getElementById('dg-enemy-list');
  if(!el||!dungeonActive) return;
  const enemies = dungeonEnemies.filter(e=>e.map_id===dungeonActive.id);
  if(!enemies.length) { el.innerHTML='<div class="empty-state">Sin enemigos en este mapa.</div>'; return; }
  el.innerHTML = enemies.map(e=>`
    <div style="display:grid;grid-template-columns:1fr 60px 40px 60px;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--leather)">
      <div style="font-size:12px;color:${e.alive?'var(--cream)':'var(--cream-muted)'}">${e.nombre} <span class="card-detail">(${e.x},${e.y})</span></div>
      <div style="font-size:11px;color:${e.hp_curr<=0?'var(--dragon-bright)':'var(--cream-dim)'}">HP ${e.hp_curr}/${e.hp_max}</div>
      <div style="font-size:11px;color:var(--cream-muted)">CA ${e.ac}</div>
      <button class="btn small danger" onclick="dungeonRemoveEnemy('${e.id}')">✕</button>
    </div>`).join('');
}

async function dungeonAddEnemyFromBestiario(monIdx) {
  if(!dungeonActive) { showToast('Selecciona un dungeon primero'); return; }
  const m = (typeof MONSTERS !== 'undefined') ? MONSTERS[monIdx] : null;
  if(!m) return;
  const parseNum = s => { const x=(s||'').match(/^(\d+)/); return x?+x[1]:10; };
  const spawnCells = [];
  const g = JSON.parse(dungeonActive.grid);
  g.forEach((row,y)=>row.forEach((t,x)=>{ if(t===DUNGEON_TILE.SPAWN) spawnCells.push({x,y}); }));
  const pos = spawnCells.length
    ? spawnCells[Math.floor(Math.random()*spawnCells.length)]
    : {x:Math.floor(dungeonActive.width/2), y:Math.floor(dungeonActive.height/2)};
  const hp = parseNum(m.hp);
  const {error} = await sb.from('dungeon_enemies').insert({
    map_id: dungeonActive.id, campaign_id: campaignId,
    nombre: m.n, monster_key: m.n,
    hp_curr: hp, hp_max: hp, ac: parseNum(m.ac),
    x: pos.x, y: pos.y, alive: true,
    atk: JSON.stringify(m.atk||[])
  });
  if(error) { alert('Error: '+error.message); return; }
  showToast(m.n+' añadido al dungeon');
  await dungeonLoad();
}

async function dungeonRemoveEnemy(id) {
  await sb.from('dungeon_enemies').delete().eq('id',id);
  dungeonEnemies = dungeonEnemies.filter(e=>e.id!==id);
  dungeonRenderEnemyList();
}

// ── Realtime ──
function dungeonSubscribeDM() {
  if(!campaignId) return;
  sb.channel('dungeon-dm-'+campaignId)
    .on('postgres_changes',{event:'*',schema:'public',table:'dungeon_players',filter:`campaign_id=eq.${campaignId}`}, async()=>{
      const {data} = await sb.from('dungeon_players').select('*').eq('campaign_id',campaignId);
      dungeonPlayers = data||[];
      dungeonRenderEditor();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'dungeon_enemies',filter:`campaign_id=eq.${campaignId}`}, async()=>{
      const {data} = await sb.from('dungeon_enemies').select('*').eq('campaign_id',campaignId);
      dungeonEnemies = data||[];
      dungeonRenderEnemyList();
    })
    .subscribe();
}

let dungeonDMLoaded = false;
// ===== END DUNGEON DM MODULE =====


function dungeonSetBrush(t) {
  dungeonBrush = t;
  document.querySelectorAll('.dg-brush-btn').forEach((b,i)=>b.classList.toggle('active', i===t||
    [0,1,2,null,4,5,6,7][i]===t));
}


function goToDashboard() {
  if(confirm('¿Cambiar de campaña?')) {
    localStorage.removeItem('dm_session');
    if(_dmAuthUser) {
      // Still logged in — show campaign picker without full reload
      const ls = document.getElementById('lock-screen');
      const ma = document.getElementById('main-app');
      if(ls) { ls.style.setProperty('display','flex','important'); }
      if(ma) { ma.style.display = 'none'; }
      dmShowCampaignPicker();
    } else {
      window.location.href = 'login.html';
    }
  }
}

tryAutoLogin();
selectDie(20);