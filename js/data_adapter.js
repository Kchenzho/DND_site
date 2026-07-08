// ============================================================
// data_adapter.js
// Convierte los JSON del compendio (claves largas: name, type…)
// al formato interno que usa dm.js y character_creator.js
// (claves cortas: n, ty, ac…).
// Incluir ANTES de dm.js y character_creator.js.
// ============================================================

// ── Helpers ──────────────────────────────────────────────────
const _txt = (v) => (Array.isArray(v) ? v.join('\n') : (v || '')).trim();
const _arr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
const _int = (v) => parseInt(v) || 0;

function _parseAtk(atkVal) {
  // atkVal can be a string "Talon|4|1d4+2" OR array ["One Handed|9|1d6+6","Two Handed|9|1d8+6"]
  if (!atkVal) return null;
  // If array, use first entry
  const atkStr = Array.isArray(atkVal) ? atkVal[0] : atkVal;
  if (typeof atkStr !== 'string') return null;
  const p = atkStr.split('|');
  if (p.length < 3) return null;
  return { n: p[0].trim(), a: _int(p[1]), d: p[2].trim() };
}

function _parseAtkAll(atkVal) {
  // Returns ALL attack variants (for monsters with One Handed/Two Handed etc.)
  if (!atkVal) return [];
  const arr = Array.isArray(atkVal) ? atkVal : [atkVal];
  return arr.map(s => _parseAtk(s)).filter(Boolean);
}

function _parseAbilityBonuses(abilityStr) {
  // "Dexterity +2, Wisdom +1"  →  {DEX:2, WIS:1}
  const MAP = {
    Strength:'STR', Dexterity:'DEX', Constitution:'CON',
    Intelligence:'INT', Wisdom:'WIS', Charisma:'CHA'
  };
  const bonus = {};
  if (!abilityStr) return bonus;
  for (const [long, short] of Object.entries(MAP)) {
    const m = abilityStr.match(new RegExp(long + '\\s*\\+?(\\d+)'));
    if (m) bonus[short] = parseInt(m[1]);
  }
  return bonus;
}

const SCHOOL_MAP = {
  A:'Abjuración', C:'Conjuración', D:'Adivinación',
  EN:'Encantamiento', EV:'Evocación', I:'Ilusión',
  N:'Nigromancia', T:'Transmutación'
};
const SKILL_LIST = [
  'Acrobatics','Animal Handling','Arcana','Athletics','Deception',
  'History','Insight','Intimidation','Investigation','Medicine',
  'Nature','Perception','Performance','Persuasion','Religion',
  'Sleight of Hand','Stealth','Survival'
];
const CLASS_SAVES = {
  Artificer:['CON','INT'], Barbarian:['STR','CON'], Bard:['DEX','CHA'],
  'Blood Hunter':['STR','WIS'], Cleric:['WIS','CHA'], Druid:['INT','WIS'],
  Fighter:['STR','CON'], Monk:['STR','DEX'], Paladin:['WIS','CHA'],
  Ranger:['STR','DEX'], Rogue:['DEX','INT'], Sorcerer:['CON','CHA'],
  Warlock:['WIS','CHA'], Wizard:['INT','WIS'],
};
const CLASS_SKILL_CHOICES = {
  Barbarian:['Animal Handling','Athletics','Intimidation','Nature','Perception','Survival'],
  Bard:SKILL_LIST,
  Cleric:['History','Insight','Medicine','Persuasion','Religion'],
  Druid:['Arcana','Animal Handling','Insight','Medicine','Nature','Perception','Religion','Survival'],
  Fighter:['Acrobatics','Animal Handling','Athletics','History','Insight','Intimidation','Perception','Survival'],
  Monk:['Acrobatics','Athletics','History','Insight','Religion','Stealth'],
  Paladin:['Athletics','Insight','Intimidation','Medicine','Persuasion','Religion'],
  Ranger:['Animal Handling','Athletics','Insight','Investigation','Nature','Perception','Stealth','Survival'],
  Rogue:['Acrobatics','Athletics','Deception','Insight','Intimidation','Investigation','Perception','Performance','Persuasion','Sleight of Hand','Stealth'],
  Sorcerer:['Arcana','Deception','Insight','Intimidation','Persuasion','Religion'],
  Warlock:['Arcana','Deception','History','Intimidation','Investigation','Nature','Religion'],
  Wizard:['Arcana','History','Insight','Investigation','Medicine','Religion'],
  Artificer:['Arcana','History','Investigation','Medicine','Nature','Perception','Sleight of Hand'],
};

// ── MONSTERS ─────────────────────────────────────────────────
function adaptMonsters(raw) {
  // Normalize a field that can be null, a single dict, or an array of dicts
  function toArr(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'object') return [v]; // single dict → wrap in array
    return [];
  }

  return raw.map(m => {
    const actions = toArr(m.action).map(a => {
      const atks = _parseAtkAll(a.attack); // handle string OR array
      const atk  = atks[0] || null;        // primary attack
      return { n: a.name || '', tx: _arr(a.text), atk, atks };
    });
    const traits = toArr(m.trait).map(t => ({
      n: t.name || '', tx: _arr(t.text)
    }));
    const reactions = toArr(m.reaction).map(r => ({
      n: r.name || '', tx: _arr(r.text)
    }));
    const legendary = toArr(m.legendary).map(l => ({
      n: l.name || '', tx: _arr(l.text)
    }));
    // All attacks across all actions (for combat)
    const atk = actions.flatMap(a => a.atks || (a.atk ? [a.atk] : []));

    return {
      n:   m.name,
      ty:  m.type || '',
      al:  m.alignment || '',
      ac:  m.ac || '',
      hp:  m.hp || '',
      spd: m.speed || '',
      str: m.str || '10', dex: m.dex || '10', con: m.con || '10',
      int: m.int || '10', wis: m.wis || '10', cha: m.cha || '10',
      sv:  _arr(m.save).join(', '),
      sk:  _arr(m.skill).join(', '),
      sen: m.senses || '',
      lng: m.languages || '',
      imm: m.immune || '',
      res: m.resist || '',
      ci:  m.conditionImmune || '',
      vul: m.vulnerable || '',
      cr:  m.cr || '0',
      sz:  m.size || 'M',
      env: m.environment || '',
      pas: m.passive || '',
      tr:  traits,
      ac_list: actions,
      rx:  reactions,
      lg:  legendary,
      atk, // short attack list for dungeon/combat
    };
  });
}

// ── SPELLS ───────────────────────────────────────────────────
function adaptSpells(raw) {
  return raw.map(s => {
    const textArr = _arr(s.text);
    const rolls   = _arr(s.roll);
    return {
      n:  s.name,
      lv: s.level || s.lv || '0',
      sc: SCHOOL_MAP[s.school] || s.school || '',
      ti: s.time || '',
      ra: s.range || '',
      co: s.components || '',
      du: s.duration || '',
      cl: s.classes || '',
      tx: textArr,
      dice: rolls[0] || '',
    };
  });
}

// ── ITEMS ────────────────────────────────────────────────────
const ITEM_TYPE_MAP = {
  A:'Ammunition', G:'Adventuring Gear', HA:'Heavy Armor',
  LA:'Light Armor', MA:'Medium Armor', M:'Melee Weapon',
  R:'Ranged Weapon', S:'Shield', RD:'Rod', SC:'Scroll',
  ST:'Staff', W:'Wondrous Item', WD:'Wand', P:'Potion', RG:'Ring',
};
function adaptItems(raw) {
  return raw.map(i => ({
    n:       i.name,
    ty:      ITEM_TYPE_MAP[i.type] || i.type || '',
    tipo:    ITEM_TYPE_MAP[i.type] || i.type || '',
    cat:     i.type || '',
    peso:    parseFloat(i.weight) || 0,
    valor:   parseFloat(i.value) || 0,
    ac:      i.ac != null && i.ac !== '-1' ? i.ac : '',
    dmg1:    i.dmg1 || '',
    dmg2:    i.dmg2 || '',
    dmgType: i.dmgType || '',
    rng:     i.range || '',
    prop:    _arr(i.property).join(', '),
    magic:   i.magic === 'YES',
    detail:  i.detail || '',
    text:    _txt(i.text),
    mod:     i.modifier
      ? { cat: i.modifier.category || '', txt: i.modifier['#text'] || '' }
      : null,
  }));
}

// ── FEATS ────────────────────────────────────────────────────
function adaptFeats(raw) {
  return raw.map(f => ({
    n:  f.name,
    pr: f.prerequisite || '',
    tx: _arr(f.text),
  }));
}

// ── RACES ────────────────────────────────────────────────────
function adaptRaces(raw) {
  return raw.map(r => {
    const traits = _arr(r.trait).map(t => ({
      n: t.name || '', tx: _arr(t.text)
    }));
    const skillProfs = [];
    traits.forEach(t => {
      t.tx.forEach(line => {
        SKILL_LIST.forEach(sk => { if (line.includes(sk)) skillProfs.push(sk); });
      });
    });
    return {
      n:      r.name,
      sz:     r.size || 'M',
      spd:    r.speed || '30',
      lng:    r.languages || r.proficiency || '',
      abi:    r.ability || '',
      bonus:  _parseAbilityBonuses(r.ability),
      skills: [...new Set(skillProfs)],
      traits,
    };
  });
}

// ── CLASSES ──────────────────────────────────────────────────
function adaptClasses(raw) {
  return raw.map(c => {
    const autolevels = _arr(c.autolevel);
    const levels = autolevels.map(al => {
      const lv = _int(al['@attributes']?.level || al.level || 1);
      const features = _arr(al.feature).map(f => ({
        n:  f.name || '',
        tx: _arr(f.text),
      }));
      const slots = al.slots || '';
      return { lv, features, slots };
    });

    const saves = CLASS_SAVES[c.name] || ['CON','WIS'];
    const skillChoices = CLASS_SKILL_CHOICES[c.name] || SKILL_LIST;
    const spellcaster = !!c.spellAbility ||
      levels.some(l => l.features.some(f =>
        f.n.toLowerCase().includes('spellcast') || f.n.toLowerCase().includes('pact magic')
      ));

    // L1 features for quick display
    const l1 = levels.find(l => l.lv === 1);

    return {
      n:            c.name,
      hd:           c.hd || '8',
      prof:         c.proficiency || '',
      saves,
      skillChoices,
      nSkills:      _int(c.numSkills) || 2,
      spellcaster,
      spellAbility: c.spellAbility || '',
      armor:        c.armor || '',
      weapons:      c.weapons || '',
      tools:        c.tools || '',
      equip:        l1?.features.find(f => f.n.includes('Equipment'))?.tx.join(' ') || '',
      features:     l1?.features || [],
      levels,       // full progression
    };
  });
}

// ── BACKGROUNDS ──────────────────────────────────────────────
function adaptBackgrounds(raw) {
  return raw.map(b => {
    const traits = _arr(b.trait).map(t => ({
      n:  t.name || '',
      tx: _arr(t.text),
    }));
    const prof = b.proficiency || '';
    const skills = prof.split(',').map(s => s.trim()).filter(s => SKILL_LIST.includes(s));
    const equipTrait = traits.find(t => t.n.toLowerCase().includes('equipment'));
    return {
      n:      b.name,
      prof,
      skills,
      traits,
      equip:  equipTrait?.tx.join(' ') || '',
    };
  });
}

// ── MASTER LOADER ─────────────────────────────────────────────
// Called by dm.js and character_creator.js instead of their own fetch
async function loadAndAdaptData(needed = ['monsters','spells','items','feats','races','classes','backgrounds']) {
  const BASE = './data/';
  const MAP  = {
    monsters:    { file: 'monsters.json',    adapt: adaptMonsters },
    spells:      { file: 'spells.json',      adapt: adaptSpells   },
    items:       { file: 'items.json',       adapt: adaptItems    },
    feats:       { file: 'feats.json',       adapt: adaptFeats    },
    races:       { file: 'races.json',       adapt: adaptRaces    },
    classes:     { file: 'classes.json',     adapt: adaptClasses  },
    backgrounds: { file: 'backgrounds.json', adapt: adaptBackgrounds },
  };

  const entries = needed.filter(k => MAP[k]);
  const results = await Promise.all(
    entries.map(k => fetch(BASE + MAP[k].file).then(r => r.json()))
  );

  const adapted = {};
  entries.forEach((k, i) => {
    adapted[k] = MAP[k].adapt(results[i]);
  });
  return adapted;
}