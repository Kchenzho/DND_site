
// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const SUPABASE_URL = 'https://dgbgdymdtdhajztqdedb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnYmdkeW1kdGRoYWp6dHFkZWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODQwODksImV4cCI6MjA5ODM2MDA4OX0.iHsEAVVlxD5DxuHgHKHBPJKuPy73k98c8UkHF8hodZg';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let campaignId   = null;
let campaignCode = null;
let myCharacter  = null;
let combatants   = [];
let shopItems    = [];
let loreItems    = [];
let shopLocations = [];
let combatRound  = 1;
let combatTurn   = 0;
let diceRolls    = [];

// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function setSyncDot(live) {
  document.getElementById('sync-dot').classList.toggle('live', live);
}

function modStr(v) {
  const m = Math.floor(((+v||10)-10)/2);
  return (m>=0?'+':'')+m;
}

function hpColor(pct) {
  if(pct>0.6) return '#3a8a3a';
  if(pct>0.3) return '#c9a227';
  return '#8b1a1a';
}

function uid() {
  return Math.random().toString(36).slice(2)+Date.now().toString(36);
}

function xpForLevel(lv) {
  const t=[0,300,900,2700,6500,14000,23000,34000,48000,64000,85000,100000,120000,140000,165000,195000,225000,265000,305000,355000];
  return t[Math.min((+lv||1)-1, t.length-1)]||0;
}

function getProfBonus(nivel) {
  if(nivel>=17) return 6; if(nivel>=13) return 5;
  if(nivel>=9)  return 4; if(nivel>=5)  return 3; return 2;
}

// ═══════════════════════════════════════════
// ITEM CATEGORIES
// ═══════════════════════════════════════════
const ITEM_CATEGORIES = [
  { id:'arma_1m',  label:'Arma (una mano)',    slotGroup:['weapon_main'] },
  { id:'arma_2m',  label:'Arma (dos manos)',   slotGroup:['weapon_main','weapon_off'], twoHanded:true },
  { id:'escudo',   label:'Escudo',             slotGroup:['weapon_off'] },
  { id:'armadura', label:'Armadura',           slotGroup:['armor'] },
  { id:'casco',    label:'Casco',              slotGroup:['head'] },
  { id:'guantes',  label:'Guantes',            slotGroup:['hands'] },
  { id:'botas',    label:'Botas',              slotGroup:['feet'] },
  { id:'capa',     label:'Capa',              slotGroup:['cape'] },
  { id:'cinturon', label:'Cinturón',           slotGroup:['belt'] },
  { id:'anillo',   label:'Anillo',            slotGroup:['ring1','ring2'], flexible:true },
  { id:'amuleto',  label:'Amuleto',           slotGroup:['amulet'] },
  { id:'arete',    label:'Arete',             slotGroup:['earring1','earring2'], flexible:true },
  { id:'otro',     label:'Otro (sin ranura)', slotGroup:[] },
];
const CAT_MAP = Object.fromEntries(ITEM_CATEGORIES.map(c=>[c.id,c]));
function catLabel(id) { return (CAT_MAP[id]||CAT_MAP.otro).label; }

function normalizeItem(it) {
  if(typeof it === 'string') return {
    id:uid(), nombre:it, tipo:'', categoria:'otro',
    mod_stats:{}, equipped:false, precio:0, slots:[],
    ac:'', dmg_dice:'', atk_mod:0, dmg_mod:0, dice_type:'', hd:''
  };
  return {
    id: it.id||uid(), nombre: it.nombre||'', tipo: it.tipo||'',
    categoria: it.categoria||'otro', mod_stats: it.mod_stats||{},
    equipped: !!it.equipped, precio: it.precio||0, slots: it.slots||[],
    ac: it.ac||'', dmg_dice: it.dmg_dice||'', atk_mod: +it.atk_mod||0,
    dmg_mod: +it.dmg_mod||0, dice_type: it.dice_type||'', hd: it.hd||''
  };
}

function normalizeEquipo(arr) {
  return (arr||[]).map(normalizeItem);
}

function normHab(h) {
  if(typeof h === 'string') return { nombre:h, tipo:'', dice:'', mod:0, desc:'', spell_dc:'' };
  return { nombre:'', tipo:'', dice:'', mod:0, desc:'', spell_dc:'', ...h };
}

function occupiedSlotsMap(equipo, excludeId) {
  const map = {};
  (equipo||[]).forEach(it => {
    if(it.equipped && it.id!==excludeId && it.slots && it.slots.length) {
      it.slots.forEach(s => { map[s] = it; });
    }
  });
  return map;
}

function resolveEquip(equipo, item) {
  const cat = CAT_MAP[item.categoria] || CAT_MAP.otro;
  if(!cat.slotGroup.length) return { ok:true, slots:[], toUnequip:[] };
  const occ = occupiedSlotsMap(equipo, item.id);
  if(cat.flexible) {
    const free = cat.slotGroup.find(s=>!occ[s]);
    if(!free) return { ok:false, reason:`Todas las ranuras de "${cat.label}" están ocupadas.` };
    return { ok:true, slots:[free], toUnequip:[] };
  }
  const toUnequip = [];
  cat.slotGroup.forEach(s => { if(occ[s] && !toUnequip.includes(occ[s])) toUnequip.push(occ[s]); });
  return { ok:true, slots:[...cat.slotGroup], toUnequip };
}

// ═══════════════════════════════════════════
// STATS CALCULATIONS (no mutual recursion)
// ═══════════════════════════════════════════
function effectiveStats(pc) {
  const base = {
    str:+pc.str||10, dex:+pc.dex||10, con:+pc.con||10,
    int_:+pc.int_||10, wis:+pc.wis||10, cha:+pc.cha||10
  };
  (pc.equipo||[]).forEach(item => {
    if(item.equipped && item.mod_stats) {
      Object.entries(item.mod_stats).forEach(([k,v]) => {
        if(base[k] !== undefined) base[k] += (+v||0);
      });
    }
  });
  return base;
}

function effectiveHpMax(pc) {
  let hp = +pc.hp_max || 10;
  (pc.equipo||[]).forEach(item => {
    if(item.equipped && item.mod_stats && item.mod_stats.hp_max) {
      hp += +item.mod_stats.hp_max;
    }
  });
  return hp;
}

function parseACValue(acStr) {
  const m = (acStr||'').match(/^(\d+)/);
  return m ? +m[1] : null;
}

function calcCA(pc) {
  // Get DEX mod from base stats (not effectiveStats to avoid any loop)
  const dex = +pc.dex || 10;
  const dexMod = Math.floor((dex-10)/2);
  const equipped = (pc.equipo||[]).filter(i=>i.equipped);
  const armor  = equipped.find(i=>i.categoria==='armadura');
  const shield = equipped.find(i=>i.categoria==='escudo');

  let total = +pc.ca || 10;
  const parts = [];

  if(armor) {
    const parsed = parseACValue(armor.ac);
    if(parsed !== null) {
      const name = ((armor.nombre||'')+(armor.tipo||'')).toLowerCase();
      const heavy  = /heavy|plate|splint|chain mail|pesada/.test(name);
      const medium = /medium|scale|hide|breastplate|half plate|media/.test(name);
      if(heavy) {
        total = parsed;
        parts.push(armor.nombre+': '+parsed);
      } else if(medium) {
        const db = Math.min(dexMod, 2);
        total = parsed + db;
        parts.push(armor.nombre+': '+parsed+(db>=0?'+':'')+db+' DEX');
      } else {
        total = parsed + dexMod;
        parts.push(armor.nombre+': '+parsed+(dexMod>=0?'+':'')+dexMod+' DEX');
      }
    }
  }

  if(shield) {
    const sb = parseACValue(shield.ac);
    const bonus = (sb !== null && sb < 10) ? sb : 2;
    total += bonus;
    parts.push(shield.nombre+': +'+bonus);
  }

  // Other items with ac field or mod_stats.ca
  equipped.filter(i=>i.categoria!=='armadura'&&i.categoria!=='escudo').forEach(i=>{
    if(i.mod_stats && i.mod_stats.ca) {
      total += +i.mod_stats.ca;
      parts.push(i.nombre+': +'+i.mod_stats.ca+' CA');
    }
  });

  return { ca: total, detail: parts.join(' + '), hasArmor: !!armor };
}

// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════
// ── Auth via Supabase Auth ──
let _authUser = null;

async function authLogin() {
  const email = document.getElementById('lock-email').value.trim();
  const pass  = document.getElementById('lock-pass').value;
  const errEl = document.getElementById('lock-error');
  if(!email||!pass) { errEl.textContent='Ingresa correo y contraseña.'; return; }
  errEl.textContent = '';
  const {data, error} = await sb.auth.signInWithPassword({email, password:pass});
  if(error) { errEl.textContent = error.message; return; }
  _authUser = data.user;
  await showCharSelect();
}

async function authLogout() {
  await sb.auth.signOut();
  _authUser = null;
  localStorage.removeItem('player_session');
  document.getElementById('auth-state').style.display = 'block';
  document.getElementById('char-select-state').style.display = 'none';
}

async function showCharSelect() {
  if(!_authUser) return;
  // Show char select state
  document.getElementById('auth-state').style.display = 'none';
  document.getElementById('char-select-state').style.display = 'block';
  const name = _authUser.user_metadata?.display_name || _authUser.email?.split('@')[0] || 'Jugador';
  document.getElementById('auth-user-name').textContent = name;
  // Load characters for this user (assigned to any campaign OR unassigned)
  const {data:chars} = await sb.from('characters').select('*')
    .eq('user_id', _authUser.id).order('created_at', {ascending:false});
  renderCharList(chars||[]);
}

function renderCharList(chars) {
  const el = document.getElementById('char-list');
  if(!chars.length) {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--cream-muted);font-style:italic;font-size:13px">
      Sin personajes. Crea uno primero.
    </div>`;
    return;
  }
  el.innerHTML = chars.map(c => {
    const campBadge = c.campaign_id
      ? `<span style="font-family:'Cinzel',serif;font-size:8px;color:var(--gold-dim);letter-spacing:.5px">EN CAMPAÑA</span>`
      : `<span style="font-family:'Cinzel',serif;font-size:8px;color:#5a4a7a;letter-spacing:.5px">SIN CAMPAÑA</span>`;
    return `<div onclick="selectCharAndEnter('${c.id}')"
      style="background:var(--parchment-3);border:1px solid var(--leather);border-radius:3px;
        padding:12px 14px;cursor:pointer;transition:border-color .15s;display:flex;align-items:center;gap:12px"
      onmouseover="this.style.borderColor='var(--gold-dim)'"
      onmouseout="this.style.borderColor='var(--leather)'">
      <div style="flex:1">
        <div style="font-family:'Cinzel',serif;font-size:13px;color:var(--cream)">${c.nombre}</div>
        <div style="font-size:11px;color:var(--cream-dim);margin-top:2px">${c.raza||''} · ${c.clase||''} · Nivel ${c.nivel||1}</div>
        <div style="margin-top:4px">${campBadge}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;flex-shrink:0;min-width:80px">
        <div style="text-align:center;background:var(--parchment-2);border:1px solid var(--leather);border-radius:2px;padding:4px">
          <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--gold)">${c.hp_max||'?'}</div>
          <div style="font-family:'Cinzel',serif;font-size:7px;color:var(--cream-muted)">HP</div>
        </div>
        <div style="text-align:center;background:var(--parchment-2);border:1px solid var(--leather);border-radius:2px;padding:4px">
          <div style="font-family:'Cinzel',serif;font-size:14px;color:var(--gold)">${c.ca||10}</div>
          <div style="font-family:'Cinzel',serif;font-size:7px;color:var(--cream-muted)">CA</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function selectCharAndEnter(charId) {
  const errEl = document.getElementById('lock-error-2');
  errEl.textContent = '';
  // Load character
  const {data:char, error} = await sb.from('characters').select('*').eq('id', charId).single();
  if(error||!char) { errEl.textContent = 'Error cargando personaje.'; return; }
  // If char has a campaign_id, use it directly
  if(char.campaign_id) {
    // Get campaign code
    const {data:camp} = await sb.from('campaigns').select('code,id').eq('id', char.campaign_id).single();
    if(camp) {
      campaignId = camp.id; campaignCode = camp.code;
      myCharacter = char; myCharacter.equipo = normalizeEquipo(myCharacter.equipo);
      localStorage.setItem('player_session', JSON.stringify({
        campaignId, campaignCode, characterId: char.id, userId: _authUser?.id
      }));
      await startApp(); return;
    }
  }
  // No campaign — show campaign picker
  await showCampaignPicker(char);
}

async function showCampaignPicker(char) {
  const errEl = document.getElementById('lock-error-2');
  // Get all campaigns user is member of
  const {data:memberships} = await sb.from('campaign_members')
    .select('*, campaigns(*)').eq('user_id', _authUser?.id).eq('role','player');
  const camps = (memberships||[]).map(m=>m.campaigns).filter(Boolean);

  const el = document.getElementById('char-list');
  if(!camps.length) {
    errEl.textContent = 'Este personaje no está en ninguna campaña. Únete primero desde el portal.';
    return;
  }
  el.innerHTML = `
    <div style="font-family:'Cinzel',serif;font-size:10px;color:var(--gold-dim);letter-spacing:.5px;margin-bottom:8px">
      SELECCIONA CAMPAÑA PARA "${char.nombre.toUpperCase()}"
    </div>
    ${camps.map(c=>`
      <div onclick="assignAndEnter('${char.id}','${c.id}','${c.code}')"
        style="background:var(--parchment-3);border:1px solid var(--leather);border-radius:3px;
          padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center"
        onmouseover="this.style.borderColor='var(--gold-dim)'"
        onmouseout="this.style.borderColor='var(--leather)'">
        <div>
          <div style="font-family:'Cinzel',serif;font-size:12px;color:var(--cream)">${c.name||c.code}</div>
          <div style="font-family:'Cinzel',serif;font-size:9px;color:var(--gold-dim);letter-spacing:1px">${c.code}</div>
        </div>
        <span style="color:var(--gold-dim);font-size:16px">→</span>
      </div>`).join('')}
    <button onclick="showCharSelect()" style="margin-top:8px;background:none;border:1px solid var(--leather);color:var(--cream-muted);padding:6px;cursor:pointer;font-family:'Cinzel',serif;font-size:9px;border-radius:2px;width:100%">← Volver</button>`;
}

async function assignAndEnter(charId, campId, campCode) {
  // Assign character to campaign
  await sb.from('characters').update({campaign_id: campId}).eq('id', charId);
  const {data:char} = await sb.from('characters').select('*').eq('id', charId).single();
  if(!char) return;
  campaignId = campId; campaignCode = campCode;
  myCharacter = char; myCharacter.equipo = normalizeEquipo(myCharacter.equipo);
  localStorage.setItem('player_session', JSON.stringify({
    campaignId, campaignCode, characterId: charId, userId: _authUser?.id
  }));
  await startApp();
}

// Legacy enterGame kept for backward compat (PIN flow)
async function enterGame() {
  // Redirect to auth flow
  await authLogin();
}

async function tryAutoLogin() {
  // Check Supabase Auth session first
  const {data:{session}} = await sb.auth.getSession();
  if(session?.user) {
    _authUser = session.user;
    // Check localStorage for saved character session
    const saved = localStorage.getItem('player_session');
    if(saved) {
      try {
        const d = JSON.parse(saved);
        if(d.campaignId && d.characterId) {
          campaignId = d.campaignId; campaignCode = d.campaignCode;
          const {data, error} = await sb.from('characters').select('*').eq('id',d.characterId).single();
          if(!error && data) {
            myCharacter = data; myCharacter.equipo = normalizeEquipo(myCharacter.equipo);
            await startApp(); return;
          }
        }
      } catch(e) { localStorage.removeItem('player_session'); }
    }
    // Logged in but no saved session — show char select
    await showCharSelect(); return;
  }
  // No auth session — show login form
  document.getElementById('auth-state').style.display = 'block';
  document.getElementById('char-select-state').style.display = 'none';
}

async function startApp() {
  document.getElementById('lock-screen').style.display='none';
  document.getElementById('main-app').style.display='block';
  document.getElementById('header-title').textContent = myCharacter.nombre.toUpperCase();
  await loadAll();
  subscribeRealtime();
  subscribeDiceRolls();
  await loadDiceRolls();
}

// ═══════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════
async function loadAll() {
  setSyncDot(false);
  try {
    if(!myCharacter?.id||!campaignId) throw new Error('Sin sesión');

    const [meRes, combRes, shopRes, loreRes, stateRes, locRes] = await Promise.all([
      sb.from('characters').select('*').eq('id',myCharacter.id).single(),
      sb.from('combatants').select('*').eq('campaign_id',campaignId).eq('visible_to_players',true).order('init',{ascending:false}),
      sb.from('shop_items').select('*').eq('campaign_id',campaignId).eq('visible',true).order('created_at'),
      sb.from('lore').select('*').eq('campaign_id',campaignId).eq('visible_to_players',true).order('created_at'),
      sb.from('combat_state').select('*').eq('campaign_id',campaignId).maybeSingle(),
      sb.from('locations').select('*').eq('campaign_id',campaignId)
    ]);

    if(meRes.error) throw new Error('characters: '+meRes.error.message);

    if(meRes.data) {
      myCharacter = meRes.data;
      myCharacter.equipo  = normalizeEquipo(myCharacter.equipo);
      myCharacter.dinero  = myCharacter.dinero || 0;
    }

    combatants    = combRes.data || [];
    shopLocations = locRes.data  || [];
    loreItems     = loreRes.data || [];

    const openIds = new Set((shopLocations).filter(l=>l.abierta).map(l=>l.id));
    shopItems = (shopRes.data||[]).filter(i=>{
      const ok  = !i.location_id || openIds.has(i.location_id);
      const stk = i.cantidad===null||i.cantidad===undefined||i.cantidad>0;
      return ok && stk;
    });

    if(stateRes.data) {
      combatRound = stateRes.data.round;
      combatTurn  = stateRes.data.turn;
    }

    render();
    setSyncDot(true);
  } catch(err) {
    console.error('loadAll error:', err);
    setSyncDot(false);
  }
}

function subscribeRealtime() {
  sb.channel('player-'+myCharacter.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'characters',  filter:`id=eq.${myCharacter.id}`}, loadAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'combatants',  filter:`campaign_id=eq.${campaignId}`}, loadAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'shop_items',  filter:`campaign_id=eq.${campaignId}`}, loadAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'lore',        filter:`campaign_id=eq.${campaignId}`}, loadAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'locations',   filter:`campaign_id=eq.${campaignId}`}, loadAll)
    .on('postgres_changes',{event:'*',schema:'public',table:'combat_state',filter:`campaign_id=eq.${campaignId}`}, payload=>{
      if(payload.new){ combatRound=payload.new.round; combatTurn=payload.new.turn; renderCombat(); }
    })
    .subscribe(status=>{
      console.log('[Realtime]', status);
      if(status==='SUBSCRIBED') setSyncDot(true);
    });
}

// ═══════════════════════════════════════════
// RENDER (all safe, no cross-calls)
// ═══════════════════════════════════════════
function render() {
  renderHero();
  renderEquipo();
  renderHabilidades();
  renderCombat();
  renderShop();
  renderLore();
  renderSkillsAndSaves();
}

function renderHero() {
  if(!myCharacter) return;
  const pc  = myCharacter;
  const eff = effectiveStats(pc);
  const ca  = calcCA(pc);                  // ← safe, no recursion
  const hpMax  = effectiveHpMax(pc);
  const hpCurr = Math.min(+pc.hp_curr||0, hpMax);
  const hpPct  = Math.max(0, hpCurr/hpMax);
  const xpThr  = xpForLevel(pc.nivel);
  const xpPct  = Math.min(1, (+pc.xp||0)/xpThr);
  const stats  = ['str','dex','con','int_','wis','cha'];
  const sNames = ['STR','DEX','CON','INT','WIS','CHA'];
  let anyBoost = false;

  const statsHtml = stats.map((s,i)=>{
    const base = +pc[s]||10, eff2 = +eff[s]||10, boost = eff2!==base;
    if(boost) anyBoost=true;
    const sm = Math.floor((eff2-10)/2);
    const smStr = (sm>=0?'+':'')+sm;
    return `<div class="stat-box click-die" onclick="quickRoll('${sNames[i]} — Prueba',${sm},true)" title="Tirar prueba de ${sNames[i]}">
      <div class="stat-val" style="${boost?'color:var(--gold-bright)':''}">${eff2}</div>
      <div class="stat-mod">${smStr}</div>
      <div class="stat-name">${sNames[i]}${boost?' *':''}</div>
    </div>`;
  }).join('');

  document.getElementById('hero-card').innerHTML = `
    <div class="hero-name">${pc.nombre}</div>
    <div class="hero-sub">${pc.clase||''} — Nivel ${pc.nivel||1}</div>
    <div style="margin-top:14px">
      <div class="stat-line"><span class="label">PUNTOS DE GOLPE</span><span>${hpCurr} / ${hpMax}</span></div>
      <div class="hp-bar"><div class="hp-fill" style="width:${Math.round(hpPct*100)}%;background:${hpColor(hpPct)}"></div></div>
    </div>
    <div style="margin-top:8px">
      <div class="stat-line"><span class="label">EXPERIENCIA</span><span>${pc.xp||0} / ${xpThr}</span></div>
      <div class="xp-bar"><div class="xp-fill" style="width:${Math.round(xpPct*100)}%"></div></div>
    </div>
    <div class="stat-line" style="margin-top:10px">
      <span class="label">CLASE DE ARMADURA</span>
      <span>
        <span class="gold-text" style="font-size:20px">${ca.ca}</span>
        ${ca.detail?`<span class="card-detail" style="font-size:10px;display:block">${ca.detail}</span>`:''}
      </span>
    </div>
    <div class="stat-line"><span class="label">DINERO</span><span class="gold-text">${pc.dinero||0} po</span></div>
    <div class="stats-grid">${statsHtml}</div>
    ${anyBoost?'<div style="font-size:10px;color:var(--cream-muted);margin-top:6px">* Bonificado por objeto equipado</div>':''}
  `;
}

function renderEquipo() {
  const el = document.getElementById('equipo-list');
  if(!myCharacter) return;
  const eq = myCharacter.equipo||[];
  if(!eq.length){ el.innerHTML='<div class="empty-state" style="padding:14px">Sin objetos.</div>'; return; }

  el.innerHTML = eq.map((item,i)=>{
    const mods = item.mod_stats||{};
    const modsHtml = Object.entries(mods).filter(([k,v])=>v&&v!=0)
      .map(([k,v])=>`<span class="badge badge-blue">${k.toUpperCase()} ${+v>0?'+':''}${v}</span>`).join(' ');
    const diceInfo = item.dmg_dice
      ? `<span class="badge badge-red" style="margin-left:4px">${item.dmg_dice}${item.dmg_mod?(item.dmg_mod>0?'+':'')+item.dmg_mod:''}</span>` : '';
    const acInfo   = item.ac
      ? `<span class="badge badge-blue" style="margin-left:4px">CA ${item.ac}</span>` : '';
    const canRoll  = (item.dmg_dice||(item.categoria||'').startsWith('arma')) && item.equipped;
    const rollBtn  = canRoll
      ? `<button class="btn small danger" onclick="rollItemAttack(${i})" title="Tirar ataque + daño">⚔</button>` : '';

    return `<div class="equip-row ${item.equipped?'equipped':''}">
      <div style="flex:1;min-width:0">
        <div class="equip-name">${item.nombre}${diceInfo}${acInfo}
          <span class="badge badge-gray" style="margin-left:4px">${catLabel(item.categoria)}</span>
        </div>
        ${modsHtml?`<div style="margin-top:3px">${modsHtml}</div>`:''}
      </div>
      <div class="equip-actions">
        ${rollBtn}
        <button class="btn small" onclick="editItemDice(${i})" title="Editar dados">✏</button>
        <button class="btn small ${item.equipped?'gold':''}" onclick="toggleEquipItem(${i})">${item.equipped?'Dseq.':'Eq.'}</button>
        <button class="btn small danger" onclick="removeEquipo(${i})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderHabilidades() {
  const el = document.getElementById('habilidades-list');
  if(!myCharacter) return;
  const hbs = (myCharacter.habilidades||[]).map(normHab);
  if(!hbs.length){ el.innerHTML='<div class="empty-state" style="padding:14px">Sin habilidades.</div>'; return; }

  el.innerHTML = hbs.map((h,i)=>{
    const diceLabel = h.dice?`<span class="badge badge-blue" style="margin-left:4px">${h.dice}${h.mod?(h.mod>0?'+':'')+h.mod:''}</span>`:'';
    const dcLabel   = h.spell_dc?`<span class="badge badge-gray" style="margin-left:4px">${h.spell_dc}</span>`:'';
    const icon = h.tipo==='hechizo'?'✨':h.tipo==='weapon'?'⚔':h.tipo==='heal'?'💚':'';
    const rollBtn = h.dice
      ? `<button class="btn small danger" onclick="rollHabilidad(${i})">🎲</button>` : '';
    return `<div class="hab-row">
      <div class="hab-name">${icon} ${h.nombre}${diceLabel}${dcLabel}
        ${h.desc?`<div class="card-detail">${h.desc}</div>`:''}
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        ${rollBtn}
        <button class="btn small" onclick="editHabilidad(${i})">✏</button>
        <button class="btn small danger" onclick="removeHabilidad(${i})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderCombat() {
  document.getElementById('round-display').textContent = `Ronda ${combatRound}`;
  const el = document.getElementById('combat-list');
  if(!combatants.length){ el.innerHTML='<div class="empty-state">No hay combate activo.</div>'; return; }

  const eff    = effectiveStats(myCharacter);
  const strMod = Math.floor(((eff.str||10)-10)/2);
  const dexMod = Math.floor(((eff.dex||10)-10)/2);

  el.innerHTML = combatants.map((c,i)=>{
    const isDead = c.hp_curr<=0;
    const isMe   = c.character_id === myCharacter.id;
    const isMyTurn = isMe && i===combatTurn;
    const typeBadge = c.tipo==='enemy'?'badge-red':c.tipo==='neutral'?'badge-blue':'badge-green';
    const typeLabel = c.tipo==='enemy'?'Enemigo':c.tipo==='neutral'?'Aliado':'Jugador';

    let statsHtml = '';
    if(c.show_stats_to_players) {
      const hpPct = Math.max(0,c.hp_curr/c.hp_max);
      statsHtml = `<div class="hp-bar" style="margin-top:4px"><div class="hp-fill" style="width:${Math.round(hpPct*100)}%;background:${hpColor(hpPct)}"></div></div>
        <div class="card-detail">HP ${c.hp_curr}/${c.hp_max} · CA ${c.ca}</div>`;
    }

    // My action buttons
    let actionHtml = '';
    if(isMe) {
      const wpns = (myCharacter.equipo||[]).filter(e=>e.equipped&&(e.categoria||'').startsWith('arma'));
      const habs = (myCharacter.habilidades||[]).map(normHab).filter(h=>h.dice);
      const wpnBtns = wpns.map((w,wi)=>{
        const atk = (w.atk_mod||0)+Math.max(strMod,dexMod);
        const dmg = w.dmg_dice||'1d6';
        return `<button class="btn small danger" onclick="rollAttack('${w.nombre.slice(0,20)}',${atk},'${dmg}',${w.dmg_mod||0})">⚔ ${w.nombre.slice(0,14)}</button>`;
      }).join('');
      const habBtns = habs.map((h,hi)=>{
        const idx = (myCharacter.habilidades||[]).map(normHab).indexOf(h);
        return `<button class="btn small" style="background:var(--parchment-3)" onclick="rollHabilidad(${idx})">🎲 ${h.nombre.slice(0,14)}</button>`;
      }).join('');
      if(wpnBtns||habBtns) {
        actionHtml = `<div style="margin-top:6px">
          <div style="font-family:'Cinzel',serif;font-size:9px;color:${isMyTurn?'var(--gold)':'var(--cream-muted)'};letter-spacing:.5px;margin-bottom:4px">
            ${isMyTurn?'⚡ ¡TU TURNO!':'MIS ACCIONES'}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:3px">${wpnBtns}${habBtns}</div>
        </div>`;
      }
    }

    return `<div class="combatant-row ${i===combatTurn?'turn':''} ${isDead?'dead':''} ${isMe?'mine':''}">
      <div>
        <div style="font-size:13px;font-weight:600;color:${isMe?'var(--gold-bright)':'var(--cream)'}">${c.nombre}${isMe?' <span class="badge badge-gold">TÚ</span>':''}</div>
        ${statsHtml}
        ${actionHtml}
      </div>
      <div style="text-align:right">
        <span class="badge ${typeBadge}">${typeLabel}</span>
        ${i===combatTurn?'<div style="font-family:Cinzel,serif;font-size:9px;color:var(--gold);margin-top:4px">TURNO</div>':''}
        <div style="font-size:10px;color:var(--cream-muted);margin-top:3px">Init ${c.init}</div>
      </div>
    </div>`;
  }).join('');
}

function renderShop() {
  const el = document.getElementById('shop-list');
  if(!shopItems.length){ el.innerHTML='<div class="empty-state">La tienda está vacía.</div>'; return; }
  const byShop = {};
  shopItems.forEach(i=>{ (byShop[i.shop_name]=byShop[i.shop_name]||[]).push(i); });
  el.innerHTML = Object.entries(byShop).map(([shop,items])=>`
    <div class="card">
      <div style="font-family:'Cinzel',serif;color:var(--gold);font-size:14px;margin-bottom:8px">${shop}</div>
      ${items.map(i=>`
        <div class="shop-row">
          <div>
            <div style="font-size:13px">${i.nombre}</div>
            ${i.tipo?`<div class="card-detail">${i.tipo}</div>`:''}
          </div>
          <div style="font-family:'Cinzel',serif;color:var(--gold);text-align:right">${i.precio} po</div>
        </div>`).join('')}
    </div>`).join('');
}

function renderLore() {
  const el = document.getElementById('lore-list');
  if(!loreItems.length){ el.innerHTML='<div class="empty-state">Aún no se ha revelado historia.</div>'; return; }
  el.innerHTML = loreItems.map(l=>`
    <div class="card">
      <div class="card-name">${l.titulo} <span class="badge badge-blue" style="margin-left:6px">${l.categoria||''}</span></div>
      ${l.contenido?`<div class="card-detail" style="margin-top:6px">${l.contenido}</div>`:''}
    </div>`).join('');
}

// ── Skills & Saves ──
const SKILLS_DEF = [
  {n:'Acrobacias',key:'acrobatics',stat:'dex'},{n:'Adiestramiento de animales',key:'animal_handling',stat:'wis'},
  {n:'Arcanos',key:'arcana',stat:'int_'},{n:'Atletismo',key:'athletics',stat:'str'},
  {n:'Engaño',key:'deception',stat:'cha'},{n:'Historia',key:'history',stat:'int_'},
  {n:'Intuición',key:'insight',stat:'wis'},{n:'Intimidación',key:'intimidation',stat:'cha'},
  {n:'Investigación',key:'investigation',stat:'int_'},{n:'Medicina',key:'medicine',stat:'wis'},
  {n:'Naturaleza',key:'nature',stat:'int_'},{n:'Percepción',key:'perception',stat:'wis'},
  {n:'Actuación',key:'performance',stat:'cha'},{n:'Persuasión',key:'persuasion',stat:'cha'},
  {n:'Religión',key:'religion',stat:'int_'},{n:'Juego de manos',key:'sleight_of_hand',stat:'dex'},
  {n:'Sigilo',key:'stealth',stat:'dex'},{n:'Supervivencia',key:'survival',stat:'wis'},
];
const SAVE_DEFS = [
  {n:'Fuerza',s:'str'},{n:'Destreza',s:'dex'},{n:'Constitución',s:'con'},
  {n:'Inteligencia',s:'int_'},{n:'Sabiduría',s:'wis'},{n:'Carisma',s:'cha'}
];
const STAT_NAMES = {str:'FUE',dex:'DES',con:'CON',int_:'INT',wis:'SAB',cha:'CAR'};

function renderSkillsAndSaves() {
  if(!myCharacter) return;
  const pc        = myCharacter;
  const eff       = effectiveStats(pc);
  const profBonus = getProfBonus(pc.nivel||1);
  const saveProfs = pc.save_profs||{};
  const skills    = pc.skills||{};
  const overrides = pc.skill_overrides||{};

  const el = document.getElementById('prof-bonus-display');
  if(el) el.textContent = '+'+profBonus;

  const saveEl = document.getElementById('saving-throws-list');
  if(saveEl) saveEl.innerHTML = SAVE_DEFS.map(sv=>{
    const val   = +eff[sv.s]||10;
    const base  = Math.floor((val-10)/2);
    const isP   = !!saveProfs[sv.s];
    const total = base+(isP?profBonus:0);
    const ts    = (total>=0?'+':'')+total;
    return `<div class="skill-row">
      <input type="checkbox" class="skill-check" ${isP?'checked':''} onchange="toggleSaveProf('${sv.s}',this.checked)">
      <div><div class="skill-name">${sv.n}</div><div class="skill-stat">${STAT_NAMES[sv.s]}</div></div>
      <div class="skill-mod ${isP?'prof':''}" onclick="quickRoll('ST: ${sv.n}',${total},true)" title="Tirar">${ts}</div>
      <div></div>
    </div>`;
  }).join('');

  const skillEl = document.getElementById('skills-list');
  if(skillEl) skillEl.innerHTML = SKILLS_DEF.map(sk=>{
    const val   = +eff[sk.stat]||10;
    const base  = Math.floor((val-10)/2);
    const isP   = !!skills[sk.key];
    const total = overrides[sk.key]!==undefined ? overrides[sk.key] : base+(isP?profBonus:0);
    const ts    = (total>=0?'+':'')+total;
    return `<div class="skill-row">
      <input type="checkbox" class="skill-check" ${isP?'checked':''} onchange="toggleSkillProf('${sk.key}',this.checked)">
      <div><div class="skill-name">${sk.n}</div><div class="skill-stat">${STAT_NAMES[sk.stat]}</div></div>
      <div class="skill-mod ${isP?'prof':''}" onclick="quickRoll('${sk.n}',${total},true)" title="Tirar">${ts}</div>
      <input type="number" class="input" style="padding:3px;text-align:center;font-size:11px;max-width:44px"
        value="${overrides[sk.key]!==undefined?overrides[sk.key]:''}"
        placeholder="${ts}" onchange="setSkillOverride('${sk.key}',this.value)">
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
// ACTIONS — EQUIPO
// ═══════════════════════════════════════════
async function addEquipo() {
  const val = document.getElementById('equipo-input').value.trim();
  if(!val) return;
  const cat   = document.getElementById('equipo-categoria')?.value||'otro';
  const equipo = [...(myCharacter.equipo||[]), normalizeItem({nombre:val,categoria:cat})];
  myCharacter.equipo = equipo;
  await sb.from('characters').update({equipo}).eq('id',myCharacter.id);
  document.getElementById('equipo-input').value='';
}

async function removeEquipo(i) {
  const equipo = [...(myCharacter.equipo||[])];
  equipo.splice(i,1);
  myCharacter.equipo = equipo;
  await sb.from('characters').update({equipo}).eq('id',myCharacter.id);
}

async function toggleEquipItem(i) {
  const equipo = [...(myCharacter.equipo||[])];
  const item   = equipo[i];
  if(!item) return;
  if(item.equipped) {
    equipo[i] = {...item, equipped:false, slots:[]};
  } else {
    const res = resolveEquip(equipo, item);
    if(!res.ok){ showToast(res.reason); return; }
    res.toUnequip.forEach(conf=>{
      const idx = equipo.findIndex(x=>x.id===conf.id);
      if(idx>=0) equipo[idx]={...equipo[idx],equipped:false,slots:[]};
    });
    equipo[i] = {...item, equipped:true, slots:res.slots};
  }
  myCharacter.equipo = equipo;
  await sb.from('characters').update({equipo}).eq('id',myCharacter.id);
}

function editItemDice(i) {
  const item = (myCharacter.equipo||[])[i];
  if(!item) return;
  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-modal-title').textContent = '✏ Dados: '+item.nombre;
  document.getElementById('edit-modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Dado de daño</label>
        <input class="input" id="em-dice" value="${item.dmg_dice||''}" placeholder="1d8"></div>
      <div class="form-group"><label class="form-label">Mod. ataque/daño</label>
        <input class="input" id="em-mod" type="number" value="${item.atk_mod||0}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">CA del objeto</label>
        <input class="input" id="em-ac" value="${item.ac||''}" placeholder="16"></div>
      <div class="form-group"><label class="form-label">Dado de curación</label>
        <input class="input" id="em-hd" value="${item.hd||''}" placeholder="2d4+2"></div>
    </div>`;
  modal._type  = 'item';
  modal._index = i;
  modal.style.display='flex';
}

async function saveEditModal() {
  const modal = document.getElementById('edit-modal');
  if(modal._type==='item') {
    const equipo = [...(myCharacter.equipo||[])];
    equipo[modal._index] = {
      ...equipo[modal._index],
      dmg_dice: document.getElementById('em-dice')?.value.trim()||null,
      atk_mod:  +document.getElementById('em-mod')?.value||0,
      dmg_mod:  +document.getElementById('em-mod')?.value||0,
      ac:       document.getElementById('em-ac')?.value.trim()||'',
      hd:       document.getElementById('em-hd')?.value.trim()||'',
    };
    myCharacter.equipo = equipo;
    await sb.from('characters').update({equipo}).eq('id',myCharacter.id);
  } else if(modal._type==='hab') {
    const habilidades = (myCharacter.habilidades||[]).map(normHab);
    habilidades[modal._index] = {
      ...habilidades[modal._index],
      tipo:     document.getElementById('em-tipo')?.value||'',
      dice:     document.getElementById('em-dice')?.value.trim()||'',
      mod:      +document.getElementById('em-mod')?.value||0,
      spell_dc: document.getElementById('em-dc')?.value.trim()||'',
    };
    myCharacter.habilidades = habilidades;
    await sb.from('characters').update({habilidades}).eq('id',myCharacter.id);
  }
  closeEditModal();
  showToast('Guardado');
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display='none';
}

// ═══════════════════════════════════════════
// ACTIONS — HABILIDADES
// ═══════════════════════════════════════════
async function addHabilidad() {
  const val = document.getElementById('habilidad-input').value.trim();
  if(!val) return;
  const habilidades = [...(myCharacter.habilidades||[]), {nombre:val,tipo:'',dice:'',mod:0,desc:'',spell_dc:''}];
  myCharacter.habilidades = habilidades;
  await sb.from('characters').update({habilidades}).eq('id',myCharacter.id);
  document.getElementById('habilidad-input').value='';
}

async function removeHabilidad(i) {
  const habilidades = (myCharacter.habilidades||[]).map(normHab);
  habilidades.splice(i,1);
  myCharacter.habilidades = habilidades;
  await sb.from('characters').update({habilidades}).eq('id',myCharacter.id);
}

function editHabilidad(i) {
  const h = normHab((myCharacter.habilidades||[])[i]||{});
  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-modal-title').textContent = '✏ Dados: '+(h.nombre||'Habilidad');
  document.getElementById('edit-modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="select" id="em-tipo">
          <option value="" ${h.tipo===''?'selected':''}>General</option>
          <option value="weapon" ${h.tipo==='weapon'?'selected':''}>⚔ Arma</option>
          <option value="hechizo" ${h.tipo==='hechizo'?'selected':''}>✨ Hechizo (ataque)</option>
          <option value="heal" ${h.tipo==='heal'?'selected':''}>💚 Curación</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Dado (ej: 2d6)</label>
        <input class="input" id="em-dice" value="${h.dice||''}" placeholder="1d8"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Modificador</label>
        <input class="input" id="em-mod" type="number" value="${h.mod||0}"></div>
      <div class="form-group"><label class="form-label">CD / nota</label>
        <input class="input" id="em-dc" value="${h.spell_dc||''}" placeholder="CD 13"></div>
    </div>`;
  modal._type  = 'hab';
  modal._index = i;
  modal.style.display='flex';
}

// ═══════════════════════════════════════════
// ACTIONS — SKILLS
// ═══════════════════════════════════════════
async function toggleSkillProf(key,val) {
  const skills = {...(myCharacter.skills||{})}; skills[key]=val;
  myCharacter.skills=skills;
  await sb.from('characters').update({skills}).eq('id',myCharacter.id);
  renderSkillsAndSaves();
}
async function toggleSaveProf(stat,val) {
  const save_profs={...( myCharacter.save_profs||{})}; save_profs[stat]=val;
  myCharacter.save_profs=save_profs;
  await sb.from('characters').update({save_profs}).eq('id',myCharacter.id);
  renderSkillsAndSaves();
}
async function setSkillOverride(key,val) {
  const skill_overrides={...(myCharacter.skill_overrides||{})};
  if(val===''||isNaN(+val)) delete skill_overrides[key]; else skill_overrides[key]=+val;
  myCharacter.skill_overrides=skill_overrides;
  await sb.from('characters').update({skill_overrides}).eq('id',myCharacter.id);
  renderSkillsAndSaves();
}

// ═══════════════════════════════════════════
// DICE ENGINE
// ═══════════════════════════════════════════
const _dice = { sel:20, adv:'normal', trayOpen:false, logOpen:false };

function rollDie(s){ return Math.floor(Math.random()*s)+1; }

function diceRoll(label, sides, qty, modifier, advantage, visible, charId, charName) {
  let used=[], dropped=[];
  if(advantage!=='normal' && qty===1) {
    const a=rollDie(sides), b=rollDie(sides);
    used  = [advantage==='adv'?Math.max(a,b):Math.min(a,b)];
    dropped=[advantage==='adv'?Math.min(a,b):Math.max(a,b)];
  } else {
    for(let i=0;i<qty;i++) used.push(rollDie(sides));
  }
  const sum   = used.reduce((a,b)=>a+b,0);
  const total = sum+modifier;
  const isCrit= sides===20&&qty===1&&used[0]===20;
  const isFail= sides===20&&qty===1&&used[0]===1;
  showRollPop(label, used, dropped, modifier, total, isCrit, isFail, advantage);
  saveRollToDB(label, qty+'d'+sides, used, sum, modifier, total, advantage, visible, charId, charName);
  return total;
}

function showRollPop(label, used, dropped, mod, total, isCrit, isFail, adv) {
  const pop = document.getElementById('dice-result-pop');
  pop.className = 'dice-result-pop show'+(isCrit?' crit':isFail?' fail':'');
  const cls   = isCrit?'crit':isFail?'fail':'normal';
  const advB  = adv==='adv'?'<span style="font-size:10px;background:#1a4a1a;color:#7cca7c;padding:2px 6px;border-radius:2px;margin-left:4px;font-family:Cinzel,serif">VENTAJA</span>'
              : adv==='dis'?'<span style="font-size:10px;background:var(--dragon);color:var(--cream);padding:2px 6px;border-radius:2px;margin-left:4px;font-family:Cinzel,serif">DESVENTAJA</span>':'';
  const critB = isCrit?'<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-top:6px">¡CRÍTICO!</div>'
              : isFail?'<div style="font-family:Cinzel,serif;color:var(--dragon-bright);font-size:13px;margin-top:6px">PIFIA</div>':'';
  const bd    = dropped.length?`[${used.join(',')}] ~~${dropped.join(',')}~~`:`[${used.join(' + ')}]`;
  const modS  = mod?(mod>0?' +':' ')+mod:'';
  pop.innerHTML = `<div class="roll-label">${label}${advB}</div>
    <div class="roll-total ${cls}">${total}</div>${critB}
    <div class="roll-breakdown">${bd}${modS}</div>
    <button class="btn small" onclick="closeRollPop()" style="margin-top:12px">Cerrar</button>`;
  clearTimeout(window._rpt);
  window._rpt = setTimeout(closeRollPop, 4000);
}
function closeRollPop(){ document.getElementById('dice-result-pop').classList.remove('show'); }

async function saveRollToDB(rollType, dice, results, sum, modifier, grandTotal, advantage, visible, charId, charName) {
  if(!campaignId) return;
  await sb.from('dice_rolls').insert({
    campaign_id:campaignId, character_id:charId||myCharacter?.id||null,
    character_name:charName||myCharacter?.nombre||'?',
    roll_type:rollType, dice, results, total:sum,
    modifier, grand_total:grandTotal, advantage,
    is_dm:false, visible_to_players:visible
  });
}

function renderDiceLog() { /* players don't see roll log */ }

function subscribeDiceRolls() {
  if(!campaignId) return;
  sb.channel('dice-player-'+myCharacter.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'dice_rolls',filter:'campaign_id=eq.'+campaignId},
      payload=>{
        const r=payload.new;
        if(r.visible_to_players||r.character_id===myCharacter?.id){
          diceRolls.unshift(r);
          if(diceRolls.length>60) diceRolls.pop();
          renderDiceLog();

        }
      }).subscribe();
}

async function loadDiceRolls() {
  if(!campaignId) return;
  const {data} = await sb.from('dice_rolls').select('*')
    .eq('campaign_id',campaignId).eq('visible_to_players',true)
    .order('created_at',{ascending:false}).limit(60);
  diceRolls = data||[];
  renderDiceLog();
}

// Tray UI
function toggleTray(){
  _dice.trayOpen=!_dice.trayOpen;
  document.getElementById('dice-tray').classList.toggle('open',_dice.trayOpen);
  document.getElementById('dice-tray-toggle').textContent=_dice.trayOpen?'✕':'🎲';
}
function toggleLog(){ /* log hidden for players */ }
function selectDie(s){
  _dice.sel=s;
  document.querySelectorAll('.dice-btn').forEach(b=>b.classList.toggle('active',+b.dataset.sides===s));
}
function setAdv(mode){
  _dice.adv=_dice.adv===mode?'normal':mode;
  document.getElementById('adv-btn').classList.toggle('active-adv',_dice.adv==='adv');
  document.getElementById('dis-btn').classList.toggle('active-dis',_dice.adv==='dis');
}
function rollSelected(){
  const qty=+document.getElementById('dice-qty').value||1;
  const mod=+document.getElementById('dice-mod').value||0;
  diceRoll('d'+_dice.sel, _dice.sel, qty, mod, _dice.adv, true, myCharacter?.id, myCharacter?.nombre);
}
function quickRoll(label, mod, visible){
  diceRoll(label, 20, 1, mod||0, _dice.adv, visible!==false, myCharacter?.id, myCharacter?.nombre);
}
function rollAttack(name, atkMod, dmgDice, dmgMod){
  diceRoll('Ataque: '+name, 20, 1, atkMod||0, _dice.adv, true, myCharacter?.id, myCharacter?.nombre);
  setTimeout(()=>{
    const parts=(dmgDice||'1d6').split('d');
    diceRoll('Daño: '+name, +parts[1]||6, +parts[0]||1, dmgMod||0, 'normal', true, myCharacter?.id, myCharacter?.nombre);
  }, 350);
}
function rollItemAttack(i){
  const item=(myCharacter.equipo||[])[i]; if(!item) return;
  const eff=effectiveStats(myCharacter);
  const strM=Math.floor(((eff.str||10)-10)/2);
  const dexM=Math.floor(((eff.dex||10)-10)/2);
  const atk=(item.atk_mod||0)+Math.max(strM,dexM);
  const dmg=item.dmg_dice||'1d6';
  rollAttack(item.nombre, atk, dmg, item.dmg_mod||0);
}
function rollHabilidad(i){
  const h=normHab((myCharacter.habilidades||[])[i]||{}); if(!h.dice) return;
  const parts=h.dice.split('d');
  const sides=+parts[1]||6, qty=+parts[0]||1;
  if(h.tipo==='weapon'||h.tipo==='hechizo'){
    diceRoll('Ataque: '+h.nombre, 20, 1, h.mod||0, _dice.adv, true, myCharacter?.id, myCharacter?.nombre);
    setTimeout(()=>diceRoll('Daño: '+h.nombre, sides, qty, 0, 'normal', true, myCharacter?.id, myCharacter?.nombre), 350);
  } else {
    const label=h.tipo==='heal'?'Curación: '+h.nombre:'Daño: '+h.nombre;
    diceRoll(label, sides, qty, h.mod||0, _dice.adv, true, myCharacter?.id, myCharacter?.nombre);
  }
}

// ═══════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    if(tab.dataset.tab==='pericias') renderSkillsAndSaves();
    if(tab.dataset.tab==='dungeon') {
      if(!dgLoaded) { dgLoaded=true; setTimeout(()=>dgInit(), 80); }
      else { if(!dgCtx) dgInit(); else dgRender(); }
    }
    if(tab.dataset.tab==='vtt') {
      if(!pvttLoaded) { pvttLoaded=true; setTimeout(()=>{ pvttInit(); pvttLoad(); pvttSubscribe(); }, 80); }
      else pvttRender();
    }
  });
});

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
selectDie(20);

// ===== VTT PLAYER =====
let pvttTokens   = [];
let pvttMapImg   = null;
let pvttMapUrl   = '';
let pvttGridSize = 50;
let pvttCanvas   = null, pvttCtx = null;
let pvttDragging = null, pvttDragOffX = 0, pvttDragOffY = 0;
let pvttLoaded   = false;

function pvttInit() {
  pvttCanvas = document.getElementById('pvtt-canvas');
  if(!pvttCanvas) return;
  pvttCtx = pvttCanvas.getContext('2d');
  pvttCanvas.addEventListener('mousedown',  pvttOnDown);
  pvttCanvas.addEventListener('mousemove',  pvttOnMove);
  pvttCanvas.addEventListener('mouseup',    pvttOnUp);
  pvttCanvas.addEventListener('mouseleave', pvttOnUp);
  pvttCanvas.addEventListener('touchstart', e=>{ e.preventDefault(); pvttOnDown(e.touches[0]); }, {passive:false});
  pvttCanvas.addEventListener('touchmove',  e=>{ e.preventDefault(); pvttOnMove(e.touches[0]); }, {passive:false});
  pvttCanvas.addEventListener('touchend',   e=>{ e.preventDefault(); pvttOnUp(e.changedTouches[0]); }, {passive:false});
  pvttRender();
}

async function pvttLoad() {
  if(!campaignId) return;
  try {
    const [tokRes, mapRes] = await Promise.all([
      sb.from('vtt_tokens').select('*').eq('campaign_id', campaignId).eq('visible_to_players', true),
      sb.from('vtt_maps').select('*').eq('campaign_id', campaignId).eq('active', true).maybeSingle()
    ]);
    pvttTokens = tokRes.data || [];
    const mapData = mapRes.data;
    if(mapData) {
      pvttGridSize = mapData.grid_size || 50;
      if(mapData.url && mapData.url !== pvttMapUrl) {
        pvttMapUrl = mapData.url;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          pvttMapImg = img;
          const ratio = Math.min(900/img.width, 600/img.height, 1);
          pvttCanvas.width  = Math.round(img.width  * ratio);
          pvttCanvas.height = Math.round(img.height * ratio);
          pvttRender();
        };
        img.onerror = () => pvttRender();
        img.src = mapData.url;
        return; // render called after image loads
      }
    }
    pvttRender();
  } catch(e) { console.error('pvttLoad:', e); }
}

function pvttSubscribe() {
  if(!campaignId) return;
  sb.channel('pvtt-' + myCharacter.id)
    .on('postgres_changes', {event:'*', schema:'public', table:'vtt_tokens', filter:`campaign_id=eq.${campaignId}`}, pvttLoad)
    .on('postgres_changes', {event:'*', schema:'public', table:'vtt_maps',   filter:`campaign_id=eq.${campaignId}`}, pvttLoad)
    .subscribe();
}

function pvttGetPos(e) {
  const rect = pvttCanvas.getBoundingClientRect();
  const sx = pvttCanvas.width / rect.width;
  const sy = pvttCanvas.height / rect.height;
  return { x: (e.clientX - rect.left)*sx, y: (e.clientY - rect.top)*sy };
}

function pvttTokenAt(x, y) {
  return [...pvttTokens].reverse().find(t => Math.hypot(x-t.x, y-t.y) <= (t.size||40)/2);
}

function pvttOnDown(e) {
  const {x,y} = pvttGetPos(e);
  const t = pvttTokenAt(x,y);
  if(t && t.entity_id === myCharacter?.id && t.entity_type === 'player') {
    pvttDragging = t;
    pvttDragOffX = x - t.x;
    pvttDragOffY = y - t.y;
    pvttCanvas.style.cursor = 'grabbing';
  }
}

function pvttOnMove(e) {
  if(!pvttDragging) return;
  const {x,y} = pvttGetPos(e);
  pvttDragging.x = x - pvttDragOffX;
  pvttDragging.y = y - pvttDragOffY;
  pvttRender();
}

function pvttOnUp() {
  if(!pvttDragging) return;
  const t = pvttDragging;
  pvttDragging = null;
  pvttCanvas.style.cursor = 'default';
  const g = pvttGridSize || 50;
  t.x = Math.round(t.x/g)*g + g/2;
  t.y = Math.round(t.y/g)*g + g/2;
  sb.from('vtt_tokens').update({x: t.x, y: t.y}).eq('id', t.id);
  pvttRender();
}

function pvttRender() {
  if(!pvttCtx) return;
  const ctx = pvttCtx;
  const W = pvttCanvas.width, H = pvttCanvas.height;
  const g = pvttGridSize || 50;
  const myId = myCharacter?.id;

  // Background + map
  ctx.fillStyle = '#111a0a';
  ctx.fillRect(0, 0, W, H);
  if(pvttMapImg) ctx.drawImage(pvttMapImg, 0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(201,162,39,0.12)';
  ctx.lineWidth = 1;
  for(let x=0; x<W; x+=g){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0; y<H; y+=g){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Tokens
  pvttTokens.forEach(t => {
    const r     = (t.size||40) / 2;
    const isMe  = t.entity_id === myId && t.entity_type === 'player';
    const dead  = t.hp_curr <= 0;
    const color = isMe ? '#c9a227' : (t.color || '#8b1a1a');

    // Glow ring for own token
    if(isMe) {
      ctx.beginPath(); ctx.arc(t.x, t.y, r+5, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(240,200,64,0.35)'; ctx.lineWidth = 4; ctx.stroke();
    }

    // Token body
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = isMe ? 12 : 5;
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI*2);
    ctx.fillStyle = dead ? '#333' : color; ctx.fill();
    ctx.strokeStyle = isMe ? '#f0c840' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = isMe ? 3 : 2; ctx.stroke();
    ctx.shadowBlur = 0;

    // Initial letter
    ctx.fillStyle = dead ? '#666' : '#fff';
    ctx.font = `bold ${Math.round(r*0.8)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((t.nombre||'?')[0].toUpperCase(), t.x, t.y);

    // Name
    ctx.font = '11px serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3;
    ctx.strokeText(t.nombre||'', t.x, t.y+r+13);
    ctx.fillStyle = isMe ? '#f0c840' : '#f0e6c8';
    ctx.fillText(t.nombre||'', t.x, t.y+r+13);

    // HP bar
    if(t.hp_max > 0) {
      const bW = r*2, bH = 5;
      const bx = t.x - r, by = t.y - r - 9;
      const pct = Math.max(0, t.hp_curr / t.hp_max);
      const bc  = pct>0.6 ? '#3a8a3a' : pct>0.3 ? '#c9a227' : '#8b1a1a';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx, by, bW, bH);
      ctx.fillStyle = bc;              ctx.fillRect(bx, by, Math.round(bW*pct), bH);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bW, bH);
    }
  });
}

// Lazy init when tab clicked
document.querySelector('.tab[data-tab="vtt"]')?.addEventListener('click', () => {
  if(!pvttLoaded) {
    pvttLoaded = true;
    setTimeout(() => { pvttInit(); pvttLoad(); pvttSubscribe(); }, 80);
  } else {
    pvttRender();
  }
});
// ===== END VTT PLAYER =====

// ===== DUNGEON CRAWLER — PLAYER MODULE =====
// Wireframe neon raycaster (tile-based perspective)

const DG_DIRS = { N:{dx:0,dy:-1,left:'W',right:'E',back:'S'}, S:{dx:0,dy:1,left:'E',right:'W',back:'N'},
                  E:{dx:1,dy:0,left:'N',right:'S',back:'W'}, W:{dx:-1,dy:0,left:'S',right:'N',back:'E'} };

let dgMap    = null;  // current dungeon_map row
let dgGrid   = null;  // 2D array
let dgPlayer = null;  // dungeon_players row
let dgEnemies= [];    // dungeon_enemies for current map
let dgInCombat = false;
let dgCombatEnemy = null;
let dgCombatLog = [];
let dgCanvas = null, dgCtx = null;
let dgSubscribed = false;
let dgLoaded = false;
let dgMoveQueue = []; // prevent rapid moves
let dgMoving = false;

// ── Init ──
async function dgInit() {
  dgCanvas = document.getElementById('dg-player-canvas');
  if(!dgCanvas) return;
  dgCtx = dgCanvas.getContext('2d');
  await dgLoadWorld();
  dgRender();
  if(!dgSubscribed) { dgSubscribed=true; dgSubscribe(); }
  dgSetupControls();
}

async function dgLoadWorld() {
  if(!campaignId) { console.warn('[Dungeon] no campaignId'); return; }
  // Find active dungeon map
  const {data:maps, error:mapErr} = await sb.from('dungeon_maps').select('*')
    .eq('campaign_id',campaignId).eq('active',true).maybeSingle();
  if(mapErr) { console.error('[Dungeon] maps error:', mapErr.message); dgMap=null; dgGrid=null; dgRender(); return; }
  console.log('[Dungeon] active map:', maps?.nombre||'none');
  if(!maps) { dgMap=null; dgGrid=null; dgRender(); return; }
  dgMap  = maps;
  dgGrid = JSON.parse(maps.grid);

  // Load enemies
  const {data:enemies} = await sb.from('dungeon_enemies').select('*')
    .eq('map_id',maps.id).eq('alive',true);
  dgEnemies = enemies||[];

  // Find or create player record
  const {data:existing} = await sb.from('dungeon_players').select('*')
    .eq('campaign_id',campaignId).eq('character_id',myCharacter.id).maybeSingle();

  if(existing) {
    dgPlayer = existing;
  } else {
    // Find start tile
    let sx=1, sy=1;
    dgGrid.forEach((row,y)=>row.forEach((t,x)=>{ if(t===4){sx=x;sy=y;} }));
    const {data:np, error:insErr} = await sb.from('dungeon_players').insert({
      campaign_id:campaignId, character_id:myCharacter.id,
      map_id:maps.id, x:sx, y:sy, direction:'S',
      hp_curr: myCharacter.hp_curr||10, in_combat:false
    }).select().single();
    if(insErr) { console.error('[Dungeon] insert player error:', insErr.message); }
    dgPlayer = np;
  }
  dgRender();
}

// ── Movement ──
async function dgMove(action) {
  if(!dgPlayer||!dgGrid||dgInCombat||dgMoving) return;
  dgMoving = true;
  const dir = DG_DIRS[dgPlayer.direction||'S'];
  let nx=dgPlayer.x, ny=dgPlayer.y, newDir=dgPlayer.direction;

  if(action==='forward')  { nx+=dir.dx; ny+=dir.dy; }
  else if(action==='back'){ nx-=dir.dx; ny-=dir.dy; }
  else if(action==='left' ){ newDir=dir.left; }
  else if(action==='right'){ newDir=dir.right; }

  const H=dgGrid.length, W=dgGrid[0].length;
  if(nx<0||ny<0||nx>=W||ny>=H) { dgMoving=false; return; }

  const tile = dgGrid[ny][nx];
  // Can't walk through walls
  if(tile===1) { dgMoving=false; dgRender(); return; }
  // Open closed door
  if(tile===2) { dgGrid[ny][nx]=3; }
  // Check exit
  if(tile===5) { dgShowMessage('¡Salida encontrada! Has completado el dungeon.','#34d399'); }
  // Check trap
  if(tile===6) { dgTrapTriggered(nx,ny); }

  dgPlayer.x=nx; dgPlayer.y=ny; dgPlayer.direction=newDir;

  // Save to Supabase
  await sb.from('dungeon_players').update({x:nx,y:ny,direction:newDir}).eq('id',dgPlayer.id);

  // Check enemy collision
  const enemy = dgEnemies.find(e=>e.alive&&e.x===nx&&e.y===ny);
  if(enemy) { dgStartCombat(enemy); dgMoving=false; return; }

  dgRender();
  setTimeout(()=>{ dgMoving=false; }, 150);
}

function dgTrapTriggered(x,y) {
  const eff = effectiveStats(myCharacter);
  const dex = Math.floor(((eff.dex||10)-10)/2);
  const roll = Math.floor(Math.random()*20)+1+dex;
  if(roll>=12) {
    dgShowMessage(`Trampa! Tiro DEX: ${roll} — ¡Esquivada!`,'#fbbf24');
  } else {
    const dmg = Math.floor(Math.random()*6)+1;
    dgPlayer.hp_curr = Math.max(0, dgPlayer.hp_curr-dmg);
    sb.from('dungeon_players').update({hp_curr:dgPlayer.hp_curr}).eq('id',dgPlayer.id);
    dgCombatLog.push(`⚠ Trampa! ${dmg} de daño. HP: ${dgPlayer.hp_curr}`);
    dgShowMessage(`Trampa! ${dmg} de daño.`,'#ef4444');
  }
}

// ── Combat ──
function dgStartCombat(enemy) {
  dgInCombat    = true;
  dgCombatEnemy = enemy;
  dgCombatLog   = [`⚔ ¡Encuentras a ${enemy.nombre}! HP:${enemy.hp_curr} CA:${enemy.ac}`];
  dgRender();
}

async function dgCombatAttack() {
  if(!dgInCombat||!dgCombatEnemy) return;
  const eff   = effectiveStats(myCharacter);
  const strMod= Math.floor(((eff.str||10)-10)/2);
  const dexMod= Math.floor(((eff.dex||10)-10)/2);
  const profB = Math.ceil(((myCharacter.nivel||1)+7)/4); // approx prof bonus
  const atkMod= Math.max(strMod,dexMod)+profB;

  // Attack roll
  const atkRoll = Math.floor(Math.random()*20)+1;
  const atkTotal= atkRoll+atkMod;
  const isCrit  = atkRoll===20;
  const isMiss  = atkRoll===1;

  if(isMiss) {
    dgCombatLog.push(`🎲 Ataque: 1 — PIFIA! Fallas el golpe.`);
  } else if(isCrit||atkTotal>=dgCombatEnemy.ac) {
    // Damage
    const wpn = (myCharacter.equipo||[]).find(e=>e.equipped&&(e.categoria||'').startsWith('arma'));
    const dmgDice = wpn?.dmg_dice||'1d6';
    const [qty,sides] = dmgDice.split('d').map(Number);
    let dmg = 0;
    const rolls = [];
    const times = isCrit ? 2 : 1;
    for(let t=0;t<times;t++) for(let i=0;i<(qty||1);i++) { const r=Math.floor(Math.random()*(sides||6))+1; rolls.push(r); dmg+=r; }
    dmg += Math.max(strMod,dexMod);
    if(wpn?.dmg_mod) dmg+=wpn.dmg_mod;
    dmg = Math.max(1,dmg);

    dgCombatEnemy.hp_curr = Math.max(0, dgCombatEnemy.hp_curr-dmg);
    await sb.from('dungeon_enemies').update({hp_curr:dgCombatEnemy.hp_curr}).eq('id',dgCombatEnemy.id);

    dgCombatLog.push(`🎲 Ataque:${atkRoll}+${atkMod}=${atkTotal}${isCrit?' CRÍTICO!':''} → ${dmg} daño${isCrit?' (dados dobles)':''}. [${rolls.join(',')}]+${Math.max(strMod,dexMod)}`);

    if(dgCombatEnemy.hp_curr<=0) {
      dgCombatLog.push(`💀 ${dgCombatEnemy.nombre} derrotado!`);
      await sb.from('dungeon_enemies').update({alive:false}).eq('id',dgCombatEnemy.id);
      dgEnemies = dgEnemies.filter(e=>e.id!==dgCombatEnemy.id);
      dgInCombat=false; dgCombatEnemy=null;
      dgRender(); return;
    }
  } else {
    dgCombatLog.push(`🎲 Ataque:${atkRoll}+${atkMod}=${atkTotal} vs CA${dgCombatEnemy.ac} — Falla.`);
  }

  // Enemy turn
  await dgEnemyTurn();
  dgRender();
}

async function dgCombatSpell(habIdx) {
  if(!dgInCombat||!dgCombatEnemy) return;
  const h = ((myCharacter.habilidades||[]).map(x=>typeof x==='string'?{nombre:x,tipo:'',dice:'',mod:0}:x))[habIdx];
  if(!h||!h.dice) { dgCombatLog.push('Sin dado configurado para esta habilidad.'); dgRender(); return; }
  const [qty,sides] = h.dice.split('d').map(Number);
  const eff = effectiveStats(myCharacter);
  const intMod=Math.floor(((eff.int_||10)-10)/2);
  const wisMod=Math.floor(((eff.wis||10)-10)/2);

  if(h.tipo==='hechizo'||h.tipo==='weapon') {
    const atkRoll=Math.floor(Math.random()*20)+1;
    const atkMod =Math.max(intMod,wisMod);
    const atkTotal=atkRoll+atkMod;
    if(atkRoll===1||atkTotal<dgCombatEnemy.ac) {
      dgCombatLog.push(`✨ ${h.nombre}: ${atkTotal} vs CA${dgCombatEnemy.ac} — Falla.`);
    } else {
      let dmg=0; const rolls=[];
      for(let i=0;i<(qty||1);i++){const r=Math.floor(Math.random()*(sides||6))+1;rolls.push(r);dmg+=r;}
      dmg+=h.mod||0; dmg=Math.max(1,dmg);
      dgCombatEnemy.hp_curr=Math.max(0,dgCombatEnemy.hp_curr-dmg);
      await sb.from('dungeon_enemies').update({hp_curr:dgCombatEnemy.hp_curr}).eq('id',dgCombatEnemy.id);
      dgCombatLog.push(`✨ ${h.nombre}: ${atkRoll}+${atkMod}=${atkTotal} impacta → ${dmg} daño. [${rolls.join(',')}]`);
      if(dgCombatEnemy.hp_curr<=0){
        dgCombatLog.push(`💀 ${dgCombatEnemy.nombre} derrotado!`);
        await sb.from('dungeon_enemies').update({alive:false}).eq('id',dgCombatEnemy.id);
        dgEnemies=dgEnemies.filter(e=>e.id!==dgCombatEnemy.id);
        dgInCombat=false;dgCombatEnemy=null;dgRender();return;
      }
    }
  } else {
    // Healing
    let heal=0; const rolls=[];
    for(let i=0;i<(qty||1);i++){const r=Math.floor(Math.random()*(sides||6))+1;rolls.push(r);heal+=r;}
    heal+=h.mod||0;
    const hpMax=effectiveHpMax(myCharacter);
    dgPlayer.hp_curr=Math.min(hpMax,dgPlayer.hp_curr+heal);
    await sb.from('dungeon_players').update({hp_curr:dgPlayer.hp_curr}).eq('id',dgPlayer.id);
    dgCombatLog.push(`💚 ${h.nombre}: +${heal} HP. [${rolls.join(',')}]`);
    dgRender(); return;
  }
  await dgEnemyTurn();
  dgRender();
}

async function dgEnemyTurn() {
  if(!dgCombatEnemy||dgCombatEnemy.hp_curr<=0) return;
  const atks = JSON.parse(typeof dgCombatEnemy.atk==='string'?dgCombatEnemy.atk:JSON.stringify(dgCombatEnemy.atk||[]));
  const atk  = atks[Math.floor(Math.random()*atks.length)];
  if(!atk) {
    const dmg=Math.max(1,Math.floor(Math.random()*6)+1);
    dgPlayer.hp_curr=Math.max(0,dgPlayer.hp_curr-dmg);
    await sb.from('dungeon_players').update({hp_curr:dgPlayer.hp_curr}).eq('id',dgPlayer.id);
    dgCombatLog.push(`👹 ${dgCombatEnemy.nombre} ataca: ${dmg} daño.`);
    return;
  }
  const eff=effectiveStats(myCharacter);
  const ca=typeof calcCA==='function'?calcCA(myCharacter).ca:(myCharacter.ca||10);
  const atkRoll=Math.floor(Math.random()*20)+1+(+atk.a||0);
  if(atkRoll>=ca) {
    const dmg=atk.d?(()=>{const p=atk.d.match(/^(\d+)d(\d+)([+-]\d+)?/);if(!p)return 1;
      let d=0;for(let i=0;i<+p[1];i++)d+=Math.floor(Math.random()*+p[2])+1;
      return Math.max(1,d+(p[3]?+p[3]:0));})():Math.floor(Math.random()*6)+1;
    dgPlayer.hp_curr=Math.max(0,dgPlayer.hp_curr-dmg);
    await sb.from('dungeon_players').update({hp_curr:dgPlayer.hp_curr}).eq('id',dgPlayer.id);
    dgCombatLog.push(`👹 ${dgCombatEnemy.nombre} — ${atk.n}: ${atkRoll} impacta! ${dmg} daño.`);
    if(dgPlayer.hp_curr<=0) {
      dgCombatLog.push('☠ ¡Caes inconsciente!');
      dgInCombat=false; dgCombatEnemy=null;
    }
  } else {
    dgCombatLog.push(`👹 ${dgCombatEnemy.nombre} — ${atk.n}: ${atkRoll} vs CA${ca} — Falla.`);
  }
}

async function dgCombatFlee() {
  if(!dgInCombat) return;
  const eff=effectiveStats(myCharacter);
  const dex=Math.floor(((eff.dex||10)-10)/2);
  const roll=Math.floor(Math.random()*20)+1+dex;
  if(roll>=12) {
    dgCombatLog.push(`🏃 Huyes con éxito! (DEX ${roll})`);
    dgInCombat=false; dgCombatEnemy=null;
    // Move back one step
    const dir=DG_DIRS[dgPlayer.direction||'S'];
    const bx=dgPlayer.x-dir.dx, by=dgPlayer.y-dir.dy;
    if(dgGrid[by]&&dgGrid[by][bx]!==1){dgPlayer.x=bx;dgPlayer.y=by;}
    await sb.from('dungeon_players').update({x:dgPlayer.x,y:dgPlayer.y,in_combat:false}).eq('id',dgPlayer.id);
  } else {
    dgCombatLog.push(`🏃 Intentas huir (DEX ${roll}) — ¡Falla! El enemigo ataca.`);
    await dgEnemyTurn();
  }
  dgRender();
}

// ── Renderer — wireframe neon ──
function dgRender() {
  if(!dgCtx) return;
  const ctx=dgCtx, W=dgCanvas.width, H=dgCanvas.height;
  ctx.fillStyle='#04030d'; ctx.fillRect(0,0,W,H);

  if(!dgMap||!dgGrid||!dgPlayer) {
    // No active dungeon
    ctx.fillStyle='rgba(168,85,247,0.3)';
    ctx.font='bold 18px Cinzel,serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('Sin dungeon activo', W/2, H/2-20);
    ctx.font='13px serif'; ctx.fillStyle='rgba(168,85,247,0.5)';
    ctx.fillText('El DM debe activar un dungeon', W/2, H/2+10);
    return;
  }

  if(dgInCombat) { dgRenderCombat(ctx,W,H); }
  else { dgRenderView(ctx,W,H); dgRenderHUD(ctx,W,H); }

  // Sync combat UI buttons
  const combatEl = document.getElementById('dg-combat-actions');
  const spellEl  = document.getElementById('dg-spell-actions');
  if(combatEl) combatEl.style.display = dgInCombat ? 'flex' : 'none';
  if(spellEl && dgInCombat) {
    const habs = (myCharacter?.habilidades||[])
      .map(h=>typeof h==='string'?{nombre:h,tipo:'',dice:''}:h).filter(h=>h.dice);
    spellEl.style.display = habs.length ? 'flex' : 'none';
    spellEl.innerHTML = habs.map((h,i)=>
      `<button class="dg-action-btn ${h.tipo==='heal'?'heal':''}" onclick="dgCombatSpell(${i})">
        ${h.tipo==='heal'?'💚':h.tipo==='hechizo'?'✨':'⚡'} ${h.nombre.slice(0,14)} (${h.dice})
      </button>`).join('');
  } else if(spellEl) { spellEl.style.display='none'; }
}

function dgRenderView(ctx,W,H) {
  const COLS=9, MID=4; // 9 column slices: left3 side left2 side left1 | front | right1 side right2 side right3
  const px=dgPlayer.x, py=dgPlayer.y, dir=dgPlayer.direction||'S';
  const d=DG_DIRS[dir];
  const ldir=DG_DIRS[d.left], rdir=DG_DIRS[d.right];

  // Neon palette
  const NEON  = 'rgba(168,85,247,';
  const NEON2 = 'rgba(232,121,249,';
  const DIM   = 'rgba(100,40,160,';

  // Draw floor and ceiling gradient
  const skyGrad=ctx.createLinearGradient(0,0,0,H*0.5);
  skyGrad.addColorStop(0,'#08041a'); skyGrad.addColorStop(1,'#0d0730');
  ctx.fillStyle=skyGrad; ctx.fillRect(0,0,W,H*0.5);
  const floorGrad=ctx.createLinearGradient(0,H*0.5,0,H);
  floorGrad.addColorStop(0,'#0d0730'); floorGrad.addColorStop(1,'#04030d');
  ctx.fillStyle=floorGrad; ctx.fillRect(0,H*0.5,W,H*0.5);

  // Floor grid lines (perspective)
  ctx.strokeStyle='rgba(124,58,237,0.2)'; ctx.lineWidth=1;
  for(let i=0;i<=8;i++){
    const t=i/8;
    const y=H*0.5+t*H*0.5;
    const spread=(1-t)*W*0.6;
    ctx.beginPath();ctx.moveTo(W/2-spread,y);ctx.lineTo(W/2+spread,y);ctx.stroke();
  }
  for(let i=-4;i<=4;i++){
    ctx.beginPath();ctx.moveTo(W/2+i*(W/8),H*0.5);ctx.lineTo(W/2+i*W*0.8,H);ctx.stroke();
  }

  // Look up to 3 tiles deep
  function getRelTile(fwd,side) {
    const tx=px+d.dx*fwd+ldir.dx*(-side)+rdir.dx*side;
    const ty=py+d.dy*fwd+ldir.dy*(-side)+rdir.dy*side;
    if(ty<0||ty>=dgGrid.length||tx<0||tx>=dgGrid[0].length) return 1;
    return dgGrid[ty][tx];
  }

  function isWall(fwd,side) {
    const t=getRelTile(fwd,side);
    return t===1||(t===2); // wall or closed door
  }

  // Draw walls — simplified perspective boxes
  function drawWallSlice(xCenter, yTop, yBot, distFactor, side) {
    const alpha = Math.max(0.1, 1-distFactor*0.3);
    const lw    = Math.max(1, 4-distFactor*1.2);
    // Wall face
    const sliceW = (W/(COLS+1))*(1/(distFactor||1));
    ctx.strokeStyle = `${side?DIM:NEON}${alpha})`;
    ctx.lineWidth   = lw;
    // Left edge
    ctx.beginPath(); ctx.moveTo(xCenter-sliceW/2,yTop); ctx.lineTo(xCenter-sliceW/2,yBot); ctx.stroke();
    // Right edge
    ctx.beginPath(); ctx.moveTo(xCenter+sliceW/2,yTop); ctx.lineTo(xCenter+sliceW/2,yBot); ctx.stroke();
    // Top edge
    ctx.beginPath(); ctx.moveTo(xCenter-sliceW/2,yTop); ctx.lineTo(xCenter+sliceW/2,yTop); ctx.stroke();
    // Bottom edge
    ctx.beginPath(); ctx.moveTo(xCenter-sliceW/2,yBot); ctx.lineTo(xCenter+sliceW/2,yBot); ctx.stroke();
    // Scanlines for texture
    ctx.strokeStyle=`rgba(168,85,247,${alpha*0.15})`; ctx.lineWidth=1;
    for(let y=yTop;y<yBot;y+=8){
      ctx.beginPath();ctx.moveTo(xCenter-sliceW/2,y);ctx.lineTo(xCenter+sliceW/2,y);ctx.stroke();
    }
  }

  // 3-depth view: front=1tile, mid=2tiles, far=3tiles
  const depths=[
    {fwd:3,scale:0.25,yOff:0.38},
    {fwd:2,scale:0.45,yOff:0.32},
    {fwd:1,scale:0.75,yOff:0.18},
  ];
  const xPositions=[-3,-2,-1,0,1,2,3]; // relative column positions

  depths.forEach(({fwd,scale,yOff})=>{
    xPositions.forEach(col=>{
      if(!isWall(fwd,col)) return;
      const xCenter=W/2+col*(W*scale*1.2);
      const yTop=H*yOff, yBot=H*(1-yOff);
      drawWallSlice(xCenter,yTop,yBot,fwd,col!==0);
    });
    // Front wall at this depth
    if(isWall(fwd,0)){
      const yTop=H*yOff, yBot=H*(1-yOff);
      const xL=W/2-W*scale, xR=W/2+W*scale;
      ctx.strokeStyle=`${NEON}${1-fwd*0.25})`; ctx.lineWidth=Math.max(1,4-fwd);
      ctx.beginPath();ctx.moveTo(xL,yTop);ctx.lineTo(xR,yTop);ctx.stroke();
      ctx.beginPath();ctx.moveTo(xL,yBot);ctx.lineTo(xR,yBot);ctx.stroke();
      ctx.beginPath();ctx.moveTo(xL,yTop);ctx.lineTo(xL,yBot);ctx.stroke();
      ctx.beginPath();ctx.moveTo(xR,yTop);ctx.lineTo(xR,yBot);ctx.stroke();
      ctx.fillStyle=`rgba(124,58,237,${0.15-fwd*0.04})`;
      ctx.fillRect(xL,yTop,xR-xL,yBot-yTop);
    }
  });

  // Corridor lines (depth guides)
  ctx.strokeStyle='rgba(168,85,247,0.5)'; ctx.lineWidth=2;
  [[0.18,0.32],[0.32,0.38]].forEach(([y1,y2])=>{
    // Top
    ctx.beginPath();ctx.moveTo(W/2-W*0.75,H*y1);ctx.lineTo(W/2-W*0.25,H*y2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(W/2+W*0.75,H*y1);ctx.lineTo(W/2+W*0.25,H*y2);ctx.stroke();
    // Bottom
    ctx.beginPath();ctx.moveTo(W/2-W*0.75,H*(1-y1));ctx.lineTo(W/2-W*0.25,H*(1-y2));ctx.stroke();
    ctx.beginPath();ctx.moveTo(W/2+W*0.75,H*(1-y1));ctx.lineTo(W/2+W*0.25,H*(1-y2));ctx.stroke();
  });

  // Door glow if in front
  if(getRelTile(1,0)===2||getRelTile(1,0)===3) {
    const open=getRelTile(1,0)===3;
    ctx.fillStyle=open?'rgba(52,211,153,0.15)':'rgba(199,125,255,0.2)';
    ctx.fillRect(W*0.25,H*0.18,W*0.5,H*0.64);
    ctx.strokeStyle=open?'#34d399':'#c77dff'; ctx.lineWidth=3;
    ctx.strokeRect(W*0.25,H*0.18,W*0.5,H*0.64);
    ctx.font='13px Cinzel,serif'; ctx.textAlign='center'; ctx.fillStyle=open?'#34d399':'#c77dff';
    ctx.fillText(open?'[ABIERTA]':'[PUERTA]',W/2,H*0.5);
  }

  // Enemy nearby indicator
  const nearEnemy=dgEnemies.find(e=>e.alive&&Math.hypot(e.x-px,e.y-py)<=3);
  if(nearEnemy) {
    ctx.fillStyle='rgba(239,68,68,0.15)';
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(239,68,68,0.6)'; ctx.lineWidth=3;
    ctx.strokeRect(2,2,W-4,H-4);
    const dist=Math.hypot(nearEnemy.x-px,nearEnemy.y-py);
    if(dist<=1) {
      // Enemy directly visible
      ctx.fillStyle='rgba(239,68,68,0.3)';
      ctx.fillRect(W*0.3,H*0.2,W*0.4,H*0.6);
      ctx.strokeStyle='#ef4444'; ctx.lineWidth=2;
      ctx.strokeRect(W*0.3,H*0.2,W*0.4,H*0.6);
      ctx.font='bold 14px Cinzel,serif'; ctx.textAlign='center'; ctx.fillStyle='#ef4444';
      ctx.fillText(nearEnemy.nombre.toUpperCase(),W/2,H*0.45);
      ctx.font='11px serif'; ctx.fillText(`HP:${nearEnemy.hp_curr}/${nearEnemy.hp_max} CA:${nearEnemy.ac}`,W/2,H*0.55);
    } else {
      ctx.font='11px Cinzel,serif'; ctx.textAlign='center'; ctx.fillStyle='rgba(239,68,68,0.9)';
      ctx.fillText(`⚠ ${nearEnemy.nombre} a ${Math.round(dist)} casillas`,W/2,H-20);
    }
  }

  // Exit glow
  if(getRelTile(1,0)===5) {
    ctx.fillStyle='rgba(52,211,153,0.2)'; ctx.fillRect(0,0,W,H);
    ctx.font='bold 16px Cinzel,serif'; ctx.textAlign='center'; ctx.fillStyle='#34d399';
    ctx.fillText('[ SALIDA ]',W/2,H*0.5);
  }
}

function dgRenderHUD(ctx,W,H) {
  if(!dgPlayer) return;
  const hpMax=typeof effectiveHpMax==='function'?effectiveHpMax(myCharacter):(myCharacter.hp_max||10);
  const hpPct=Math.max(0,dgPlayer.hp_curr/hpMax);
  const hpCol=hpPct>0.6?'#34d399':hpPct>0.3?'#fbbf24':'#ef4444';
  // HP bar
  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(10,10,160,14);
  ctx.fillStyle=hpCol; ctx.fillRect(10,10,Math.round(160*hpPct),14);
  ctx.strokeStyle='rgba(168,85,247,0.6)'; ctx.lineWidth=1; ctx.strokeRect(10,10,160,14);
  ctx.font='10px Cinzel,serif'; ctx.textAlign='left'; ctx.fillStyle='#fff';
  ctx.fillText(`HP ${dgPlayer.hp_curr}/${hpMax}`,14,21);
  // Direction compass
  const compass={'N':'↑','S':'↓','E':'→','W':'←'};
  ctx.font='bold 16px Cinzel,serif'; ctx.textAlign='right'; ctx.fillStyle='rgba(168,85,247,0.9)';
  ctx.fillText(compass[dgPlayer.direction||'S']+' '+dgPlayer.direction,W-12,22);
  // Minimap (small)
  dgRenderMinimap(ctx, W-70, 30);
}

function dgRenderMinimap(ctx, ox, oy) {
  if(!dgGrid||!dgPlayer) return;
  const S=5, G=dgGrid, H=G.length, W2=G[0].length;
  const visR=3;
  for(let y=Math.max(0,dgPlayer.y-visR);y<=Math.min(H-1,dgPlayer.y+visR);y++) {
    for(let x=Math.max(0,dgPlayer.x-visR);x<=Math.min(W2-1,dgPlayer.x+visR);x++) {
      const t=G[y][x];
      ctx.fillStyle=t===1?'rgba(124,58,237,0.8)':t===0?'rgba(168,85,247,0.15)':
        t===5?'rgba(52,211,153,0.6)':'rgba(200,125,255,0.4)';
      ctx.fillRect(ox+(x-dgPlayer.x+visR)*S, oy+(y-dgPlayer.y+visR)*S, S-1, S-1);
    }
  }
  // Player dot
  ctx.fillStyle='#fbbf24';
  ctx.fillRect(ox+visR*S, oy+visR*S, S-1, S-1);
  // Enemy dots
  dgEnemies.filter(e=>e.alive).forEach(e=>{
    if(Math.abs(e.x-dgPlayer.x)<=visR&&Math.abs(e.y-dgPlayer.y)<=visR) {
      ctx.fillStyle='#ef4444';
      ctx.fillRect(ox+(e.x-dgPlayer.x+visR)*S, oy+(e.y-dgPlayer.y+visR)*S, S-1, S-1);
    }
  });
}

function dgRenderCombat(ctx,W,H) {
  const en=dgCombatEnemy;
  // Background
  ctx.fillStyle='rgba(60,0,80,0.3)'; ctx.fillRect(0,0,W,H);
  // Scanlines effect
  ctx.strokeStyle='rgba(168,85,247,0.06)'; ctx.lineWidth=1;
  for(let y=0;y<H;y+=4){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  // Enemy display
  const eyTop=H*0.08, eyH=H*0.42;
  ctx.strokeStyle='rgba(239,68,68,0.7)'; ctx.lineWidth=2;
  ctx.strokeRect(W*0.15,eyTop,W*0.7,eyH);
  ctx.fillStyle='rgba(100,0,0,0.2)'; ctx.fillRect(W*0.15,eyTop,W*0.7,eyH);
  // Enemy wireframe figure (simple geometric shapes)
  dgDrawEnemyFigure(ctx,W/2,eyTop+eyH*0.5,eyH*0.35);
  // Enemy name & HP
  const hpPct=en?Math.max(0,en.hp_curr/en.hp_max):0;
  const hpCol=hpPct>0.6?'#34d399':hpPct>0.3?'#fbbf24':'#ef4444';
  ctx.font='bold 16px Cinzel,serif'; ctx.textAlign='center'; ctx.fillStyle='#ef4444';
  ctx.fillText(en?en.nombre.toUpperCase():'???', W/2, eyTop+eyH+20);
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(W*0.2,eyTop+eyH+28,W*0.6,8);
  ctx.fillStyle=hpCol; ctx.fillRect(W*0.2,eyTop+eyH+28,Math.round(W*0.6*hpPct),8);
  ctx.strokeStyle='rgba(168,85,247,0.5)'; ctx.lineWidth=1;
  ctx.strokeRect(W*0.2,eyTop+eyH+28,W*0.6,8);
  ctx.font='10px Cinzel,serif'; ctx.fillStyle='#c4b08a';
  ctx.fillText(`HP ${en?en.hp_curr:0}/${en?en.hp_max:0}  CA ${en?en.ac:0}`,W/2,eyTop+eyH+50);

  // Player HP
  const hpMax=typeof effectiveHpMax==='function'?effectiveHpMax(myCharacter):10;
  const phpPct=Math.max(0,(dgPlayer?.hp_curr||0)/hpMax);
  const phpCol=phpPct>0.6?'#34d399':phpPct>0.3?'#fbbf24':'#ef4444';
  ctx.font='10px Cinzel,serif'; ctx.textAlign='left'; ctx.fillStyle='#c4b08a';
  ctx.fillText(`TÚ — HP ${dgPlayer?.hp_curr||0}/${hpMax}`,W*0.05,H-80);
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(W*0.05,H-70,W*0.4,6);
  ctx.fillStyle=phpCol; ctx.fillRect(W*0.05,H-70,Math.round(W*0.4*phpPct),6);
  ctx.strokeStyle='rgba(168,85,247,0.4)'; ctx.lineWidth=1;
  ctx.strokeRect(W*0.05,H-70,W*0.4,6);

  // Combat log (last 4 entries)
  const logStart=H*0.54;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(0,logStart,W,H-logStart-90);
  const log=[...dgCombatLog].slice(-4);
  log.forEach((line,i)=>{
    ctx.font=`${i===log.length-1?'11':'10'}px serif`;
    ctx.fillStyle=i===log.length-1?'#e8d5f0':'rgba(196,176,138,0.7)';
    ctx.textAlign='left';
    ctx.fillText(line, 12, logStart+18+i*18, W-24);
  });
}

function dgDrawEnemyFigure(ctx,cx,cy,size) {
  ctx.strokeStyle='rgba(239,68,68,0.8)'; ctx.lineWidth=2;
  // Head
  ctx.beginPath(); ctx.arc(cx,cy-size*0.55,size*0.18,0,Math.PI*2); ctx.stroke();
  // Body
  ctx.beginPath(); ctx.moveTo(cx,cy-size*0.37); ctx.lineTo(cx,cy+size*0.2); ctx.stroke();
  // Arms
  ctx.beginPath(); ctx.moveTo(cx-size*0.3,cy-size*0.1); ctx.lineTo(cx,cy-size*0.27);
  ctx.lineTo(cx+size*0.3,cy-size*0.1); ctx.stroke();
  // Legs
  ctx.beginPath(); ctx.moveTo(cx,cy+size*0.2); ctx.lineTo(cx-size*0.2,cy+size*0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx,cy+size*0.2); ctx.lineTo(cx+size*0.2,cy+size*0.5); ctx.stroke();
  // Glow
  ctx.shadowColor='#ef4444'; ctx.shadowBlur=15;
  ctx.beginPath(); ctx.arc(cx,cy-size*0.55,size*0.18,0,Math.PI*2); ctx.stroke();
  ctx.shadowBlur=0;
}

let _dgMsgTimer=null;
function dgShowMessage(msg,color='#c77dff') {
  const el=document.getElementById('dg-message');
  if(!el) return;
  el.textContent=msg; el.style.color=color; el.style.opacity='1';
  clearTimeout(_dgMsgTimer);
  _dgMsgTimer=setTimeout(()=>{el.style.opacity='0';},3000);
}

// ── Controls ──
function dgSetupControls() {
  // Keyboard
  const keyMap={'ArrowUp':'forward','w':'forward','W':'forward',
    'ArrowDown':'back','s':'back','S':'back',
    'ArrowLeft':'left','a':'left','A':'left',
    'ArrowRight':'right','d':'right','D':'right'};
  document.addEventListener('keydown', e=>{
    if(document.activeElement?.tagName==='INPUT') return;
    if(!document.getElementById('tab-dungeon')?.classList.contains('active')) return;
    const action=keyMap[e.key];
    if(action){e.preventDefault(); dgMove(action);}
  });
}

// ── Subscribe ──
function dgSubscribe() {
  if(!campaignId) return;
  sb.channel('dungeon-player-'+campaignId)
    .on('postgres_changes',{event:'*',schema:'public',table:'dungeon_maps',filter:`campaign_id=eq.${campaignId}`},async()=>{
      await dgLoadWorld(); dgRender();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'dungeon_enemies',filter:`campaign_id=eq.${campaignId}`},async()=>{
      if(!dgMap) return;
      const {data}=await sb.from('dungeon_enemies').select('*').eq('map_id',dgMap.id).eq('alive',true);
      dgEnemies=data||[]; dgRender();
    })
    .subscribe();
}
// ===== END DUNGEON PLAYER MODULE =====


// Combat UI sync is inside base dgRender

tryAutoLogin();
