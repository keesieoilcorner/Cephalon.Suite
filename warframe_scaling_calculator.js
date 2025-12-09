let fullyInitialized = false;
let targetPlotVisible = true;

// Warframe Scaling Calculator driver.
// Handles scaling math, plot rendering, UI wiring, and share/reset helpers.
// Section headers are organized in the order the data flows: math -> rendering -> UI wiring -> share/reset.

// Detect embed mode (iframe or ?embed) and add a body flag for CSS tweaks (e.g., hide sticky bar)
const isEmbedded = (window.self !== window.top) || new URLSearchParams(window.location.search).has('embed');
if (isEmbedded) document.body.classList.add('embedded');

// Prepare fullscreen section entrance animation (skipped when embedded)
function prepareSectionEntrance() {
    if (isEmbedded) {
        document.body.classList.remove('calc-prefade');
        document.body.classList.add('plot-ready');
        return;
    }
    const container = document.querySelector('.container');
    const hubHeader = document.querySelector('.hub-header');
    if (!container) {
        document.body.classList.remove('calc-prefade');
        return;
    }
    const ordered = [hubHeader, ...Array.from(container.children).filter(el => el && el.nodeType === 1)];
    let delay = 0;
    ordered.forEach(el => {
        if (!el || !el.classList) return;
        el.classList.add('calc-stagger');
        el.style.setProperty('--stagger-delay', `${delay}ms`);
        delay += 55;
    });
    document.body.classList.add('calc-prepare');
    requestAnimationFrame(() => document.body.classList.remove('calc-prefade'));
}

function startSectionEntrance() {
    if (isEmbedded || !document.body.classList.contains('calc-prepare')) return;
    document.body.classList.add('calc-animate');
    if (typeof window.__releaseTransition === 'function') {
        window.__releaseTransition();
        window.__releaseTransition = null;
    }
    setTimeout(() => {
        document.body.classList.remove('calc-prepare');
        document.body.classList.add('plot-ready');
        if (targetPlotVisible && !plotVisible && !isEmbedded) {
            requestAnimationFrame(() => {
                triggerPlotWipe();
                const params = readParams();
                const toggles = readToggles();
                applyEffectiveEnemyType(params, toggles);
                animateTo(params, toggles, 600, { unfold: true });
                syncPlotUi(true);
                plotVisible = true;
            });
        }
    }, 900);
}

prepareSectionEntrance();

// ---------- Faction background gradients ----------
const factionGradients = {
    grineer: 'radial-gradient(1200px 800px at 20% 0%, #3f0d0d 0%, #7f1d1d 35%, #0b1020 100%)',
    corpus:  'radial-gradient(1200px 800px at 20% 0%, #0a1a3a 0%, #1e3a8a 35%, #0b1020 100%)',
    infested:'radial-gradient(1200px 800px at 20% 0%, #062515 0%, #065f46 35%, #0b1020 100%)',
    corrupted:'radial-gradient(1200px 800px at 20% 0%, #3a2a06 0%, #a16207 35%, #0b1020 100%)',
    sentient:'radial-gradient(1200px 800px at 20% 0%, #24053a 0%, #6d28d9 35%, #0b1020 100%)',
    murmur:  'radial-gradient(1200px 800px at 20% 0%, #24053a 0%, #6d28d9 35%, #0b1020 100%)',
    unaffiliated:'radial-gradient(1200px 800px at 20% 0%, #24053a 0%, #6d28d9 35%, #0b1020 100%)',
    techrot: 'radial-gradient(1200px 800px at 20% 0%, #3a1706 0%, #ea580c 35%, #0b1020 100%)',
    default: 'radial-gradient(1200px 800px at 20% 0%, #0b1222 0%, #111827 50%, #030712 100%)',
};

const bgA = document.getElementById('bgA');
const bgB = document.getElementById('bgB');
let bgOnA = true;
function setFactionBackground(f) {
    const grad = factionGradients[f] || factionGradients.default;
    if (bgOnA) { bgB.style.background = grad; bgB.classList.add('on'); bgA.classList.remove('on'); }
    else { bgA.style.background = grad; bgA.classList.add('on'); bgB.classList.remove('on'); }
    bgOnA = !bgOnA;
}

// Factions with no true shield scaling
const factionsWithoutShieldScaling = new Set(['infested']);
function factionHasShieldScaling(faction) {
    return !factionsWithoutShieldScaling.has(faction);
}
function compareLegendInfo(faction) {
    const label = (() => {
    if (faction === 'grineer') return 'Grineer / Scaldra';
    if (faction === 'corpus') return 'Corpus';
    if (faction === 'infested') return 'Infested';
    if (faction === 'corrupted') return 'Corrupted';
    if (faction === 'murmur' || faction === 'sentient' || faction === 'unaffiliated') return 'Murmur / Sentient / Unaffiliated';
    if (faction === 'techrot') return 'Techrot';
    return faction;
    })();
    if (faction === 'grineer') return { color: '#ef4444', dash: [], label };
    if (faction === 'corpus') return { color: '#3b82f6', dash: [], label };
    if (faction === 'infested') return { color: '#22c55e', dash: [], label };
    if (faction === 'corrupted') return { color: '#f59e0b', dash: [], label };
    if (faction === 'murmur' || faction === 'sentient' || faction === 'unaffiliated') return { color: '#8b5cf6', dash: [], label };
    if (faction === 'techrot') return { color: '#f97316', dash: [], label };
    return { color: '#9ca3af', dash: [], label };
}
// Limit comparison chips to the factions that actually have toggles in the UI.
const factionList = ['grineer','corpus','infested','corrupted','murmur','techrot'];
const metricLabels = { health: 'Health', shield: 'Shield', damage: 'Enemy Damage', ehp: 'EHP', scaling: 'Scaling Damage' };
const compareActive = new Set(factionList);
const presetActive = new Set(['A','B']);
let abPresets = { A: null, B: null };
const axisState = {
    base:    { maxY: null, start: null, end: null },
    compare: { maxY: null, start: null, end: null },
    preset:  { maxY: null, start: null, end: null }
};
let lastCompareSignature = null;
let lastCompareMode = 'none';
let lastPresetCompareSignature = null;
const initialUrl = location.pathname + location.search + location.hash;
let initialShareState = null;

function resetBaseAxisState() {
    axisState.base = { maxY: null, start: null, end: null };
}

function triggerPlotWipe() {
    triggerWipe(plotWrapEl);
}
function triggerWipe(el) {
    if (!el) return;
    el.classList.remove('wiping');
    // force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('wiping');
}
function setCompareCardsVisible(on) {
    if (resultCard) resultCard.style.display = on ? 'none' : '';
    if (compareResultCard) compareResultCard.style.display = on ? '' : 'none';
}
function getSelectedComparisonFactions() {
    const active = Array.from(compareActive);
    return active;
}
function getCompareSignature(params) {
    const metric = (compareMetricEl?.value || 'health');
    const factions = Array.from(compareActive).sort().join(',');
    return [
    metric,
    factions,
    params.targetLevel,
    params.baseLevel,
    params.baseHealth,
    params.baseShield,
    params.baseDamage,
    params.enemyDifficulty,
    params.enemyType,
    params.statusStacks,
    params.radiationStacks,
    params.scalingMode,
    params.levelScaling,
    params.healthScaling,
    params.smiteSingleEnabled,
    params.smiteAoEEnabled,
    params.smiteSubsumeEnabled,
    params.smiteMfdEnabled,
    params.reaveEnthrallEnabled,
    params.reapEnemyCount,
    params.yAxisMax,
    params.abilityStrengthPct,
    params.abilityDamagePct,
    params.nourishEnabled,
    params.nourishSubsume,
    params.roarEnabled,
    params.roarSubsume,
    params.trueDamageEnabled,
    params.mindControlPct,
    params.mindControlEnabled,
    params.nekrosMult,
    params.nekrosEnabled,
    params.summWrath,
    params.summWrathEnabled,
    params.damageDecoyMult,
    params.damageDecoyEnabled,
    params.coldWardEnabled,
    params.linkEnabled,
    params.reverseRotorEnabled,
    params.mesmerSkinEnabled,
    params.thornsEnabled,
    params.shatterShieldEnabled,
    params.trueToxinEnabled,
    params.atlasPetrifyEnabled,
    params.calibanWrathEnabled,
    params.equinoxRageEnabled,
    params.garaMassEnabled,
    params.garaSplinterEnabled,
    params.jadeJudgementsEnabled,
    params.khoraDomeEnabled,
    params.nezhaChakramEnabled,
    params.novaPrimeEnabled,
    params.oraxiaEmbraceEnabled,
    params.qorvexWallEnabled,
    params.yareliSeaEnabled,
    params.yareliMerulinaEnabled,
    params.destructRank,
    params.destructStacks,
    params.absorbEnabled,
    params.regurgitateGastroEnabled,
    compareShowBaseEl?.checked ? 1 : 0,
    compareShowExDefEl?.checked ? 1 : 0,
    compareShowExNoDefEl?.checked ? 1 : 0
    ].join('|');
}
function formatStatNumber(v) {
    if (v == null || !isFinite(v)) return '-';
    return Math.round(v).toLocaleString();
}
function updateCompareOutputs(series, params) {
    if (!compareStatsList || !series) return;
    const metricLabel = metricLabels[series.metric] || series.metric;
    if (compareMetricLabelEl) compareMetricLabelEl.textContent = metricLabel;
    const targetLevel = Number.isFinite(series.targetLevel) ? series.targetLevel : params.targetLevel;
    if (compareMetricSubEl) compareMetricSubEl.textContent = `Values at Level ${targetLevel}`;

    const N = series.xs.length;
    let idx = N - 1;
    if (Number.isFinite(targetLevel) && Array.isArray(series.xs)) {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < series.xs.length; i++) {
        const diff = Math.abs(series.xs[i] - targetLevel);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    idx = best;
    }

    compareStatsList.innerHTML = '';
    series.factions.forEach(fc => {
    const row = document.createElement('div');
    row.className = 'compare-stat-row';

    const labelWrap = document.createElement('div');
    labelWrap.className = 'compare-stat-label';
    const dot = document.createElement('span');
    dot.className = 'compare-color';
    dot.style.background = fc.color || '#e5e7eb';
    labelWrap.appendChild(dot);
    const text = document.createElement('span');
    const cleanedLabel = (fc.label || fc.faction || '').replace(/^(Health|Shield|Enemy Damage|EHP)\s+-\s+/i, '') || fc.faction || fc.label;
    text.textContent = cleanedLabel;
    labelWrap.appendChild(text);

    const val = document.createElement('div');
    val.className = 'compare-stat-value';
    val.textContent = formatStatNumber(fc.vals[idx]);

    row.appendChild(labelWrap);
    row.appendChild(val);
    compareStatsList.appendChild(row);
    });
}
function toggleCompareChip(chip) {
    chip.classList.toggle('off');
    const f = chip.getAttribute('data-faction');
    if (!f) return;
    if (chip.classList.contains('off')) compareActive.delete(f);
    else compareActive.add(f);
}
function setCompareActive(factions) {
    compareActive.clear();
    (factions || []).forEach(f => {
    if (factionList.includes(f)) compareActive.add(f);
    });
    colorCompareChips();
}
function colorCompareChips() {
    getCompareChips().forEach(ch => {
    const f = ch.getAttribute('data-faction');
    const info = compareLegendInfo(f);
    ch.style.color = info.color;
    const swatch = ch.querySelector('i');
    if (swatch) {
        swatch.style.borderTopColor = info.color;
        swatch.style.borderTopStyle = 'solid';
    }
    ch.classList.toggle('off', !compareActive.has(f));
    });
}

// ---------- Math helpers ----------
const SQRT5 = Math.sqrt(5);
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const smoothstep01 = (t) => { const u = clamp01(t); return 3*u*u - 2*u*u*u; };
function smoothMaxY(rawMax, start, end, state, { track = true, snapUp = true } = {}) {
    const padded = Math.max(10, rawMax * 1.08 + 5);
    if (!track) return { maxY: padded, state };

    const rangeShrank = state && state.end != null && end < state.end;
    const prev = rangeShrank ? null : state?.maxY;

    let smoothed;
    if (prev == null) {
    smoothed = padded;
    } else {
    const delta = padded - prev;
    if (delta > 0) {
        smoothed = snapUp ? padded : prev + delta * 0.35; // ease up if requested
    } else {
        smoothed = prev + delta * 0.35; // ease down
    }
    // Avoid undershooting below the raw max (with tiny headroom)
    const floor = Math.max(rawMax * 1.01, padded * 0.98);
    if (smoothed < floor) smoothed = floor;
    }

    return { maxY: smoothed, state: { maxY: smoothed, start, end } };
}

// ---------- Lightweight base64url + LZ compression helpers ----------
function base64UrlEncode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// Minimal LZ-based compressor (adapted from LZ-String, Uint8Array flavor)
function lzCompress(uncompressed) {
    if (uncompressed == null) return new Uint8Array();
    const dict = new Map();
    const data = uncompressed;
    let dictSize = 256;
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
    let w = '';
    const result = [];
    for (let i = 0; i < data.length; i++) {
    const c = data.charAt(i);
    const wc = w + c;
    if (dict.has(wc)) {
        w = wc;
    } else {
        result.push(dict.get(w));
        dict.set(wc, dictSize++);
        w = String(c);
    }
    }
    if (w !== '') result.push(dict.get(w));

    // pack 16-bit codes to bytes (big endian)
    const out = new Uint8Array(result.length * 2);
    for (let i = 0; i < result.length; i++) {
    const code = result[i] || 0;
    out[i * 2] = (code >> 8) & 0xff;
    out[i * 2 + 1] = code & 0xff;
    }
    return out;
}

function lzDecompress(bytes) {
    if (!bytes || bytes.length === 0) return '';
    const codes = new Uint16Array(bytes.length / 2);
    for (let i = 0; i < codes.length; i++) {
    codes[i] = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
    }
    const dict = [];
    for (let i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);
    let w = String.fromCharCode(codes[0]);
    let result = w;
    let entry = '';
    for (let i = 1; i < codes.length; i++) {
    const k = codes[i];
    if (dict[k] !== undefined) {
        entry = dict[k];
    } else if (k === dict.length) {
        entry = w + w.charAt(0);
    } else {
        return '';
    }
    result += entry;
    dict.push(w + entry.charAt(0));
    w = entry;
    }
    return result;
}

// Health piecewise
function healthPiecewise(level, baseLevel, a, p, k, q) {
    const d = Math.max(level - baseLevel, 0);
    if (d < 70) return 1 + a * Math.pow(d, p);
    if (d <= 80) {
    const S = smoothstep01((d - 70) / 10);
    const f_lo = 1 + a * Math.pow(d, p);
    const f_hi = 1 + k * Math.pow(d, q);
    return (1 - S) * f_lo + S * f_hi;
    }
    return 1 + k * Math.pow(d, q);
}

// Shield piecewise
function shieldPiecewise(level, baseLevel, a, p1, b, p2) {
    const d = Math.max(level - baseLevel, 0);
    if (d < 70) return 1 + a * Math.pow(d, p1);
    if (d <= 80) {
    const S = smoothstep01((d - 70) / 10);
    const f_lo = 1 + a * Math.pow(d, p1);
    const f_hi = 1 + b * Math.pow(d, p2);
    return (1 - S) * f_lo + S * f_hi;
    }
    return 1 + b * Math.pow(d, p2);
}

// Health multipliers
const healthScaling = {
    grineer:  (x, base) => healthPiecewise(x, base, 0.015, 2.12, (24*SQRT5)/5, 0.72),
    corpus:   (x, base) => healthPiecewise(x, base, 0.015, 2.12, (30*SQRT5)/5, 0.55),
    infested: (x, base) => healthPiecewise(x, base, 0.0225,2.12, (36*SQRT5)/5, 0.72),
    corrupted:(x, base) => healthPiecewise(x, base, 0.015, 2.10, (24*SQRT5)/5, 0.685),
    sentient: (x, base) => healthPiecewise(x, base, 0.015, 2.0,  (24*SQRT5)/5, 0.5),
    murmur:   (x, base) => healthPiecewise(x, base, 0.015, 2.0,  (24*SQRT5)/5, 0.5),
    unaffiliated:(x, base) => healthPiecewise(x, base, 0.015, 2.0,  (24*SQRT5)/5, 0.5),
    techrot:  (x, base) => healthPiecewise(x, base, 0.02,  2.12, 15.1,        0.7),
};

// Shield multipliers
const shieldScaling = {
    corpus:    (x, base) => shieldPiecewise(x, base, 0.02, 1.76, 2.0, 0.76),
    corrupted: (x, base) => shieldPiecewise(x, base, 0.02, 1.75, 2.0, 0.75),
    grineer:   (x, base) => shieldPiecewise(x, base, 0.02, 1.75, 1.6, 0.75),
    techrot:   (x, base) => shieldPiecewise(x, base, 0.02, 1.76, 3.5, 0.76),
    infested:  () => 1,
    sentient:  (x, base) => shieldPiecewise(x, base, 0.02, 1.75, 2.0, 0.75),
    murmur:    (x, base) => shieldPiecewise(x, base, 0.02, 1.75, 2.0, 0.75),
    unaffiliated:(x, base) => shieldPiecewise(x, base, 0.02, 1.75, 2.0, 0.75),
};

// Armor scaling + damage reduction
function armorMultiplier(level, baseLevel) {
    const d = Math.max(level - baseLevel, 0);
    const f1 = 1 + 0.005 * Math.pow(d, 1.75);
    const f2 = 1 + 0.4 * Math.pow(d, 0.75);
    const S = smoothstep01((d - 70) / 10);
    return f1 * (1 - S) + f2 * S;
}

function armorAt(level, baseLevel, baseArmor) {
    if (baseArmor <= 0) return 0;
    return baseArmor * armorMultiplier(level, baseLevel);
}

function netArmorForDR(rawArmor) {
    // Prevent negative armor or negative strip math
    const net = Math.max(0, rawArmor);
    return Math.min(net, 2700);
}

function armorDamageReduction(netArmor) {
    if (netArmor <= 0) return 0;
    const dr = 0.9 * Math.sqrt(netArmor / 2700);
    return Math.max(0, Math.min(0.9, dr));
}

function applyArmorDR(val, armorDR, { isTrueDamage = false } = {}) {
    if (isTrueDamage) return val;
    return val * (1 - Math.max(0, Math.min(0.9, armorDR || 0)));
}

function toxinDotFromInitial(initialToxinFinal, params, { toxinEnabled = true } = {}) {
    if (!toxinEnabled || initialToxinFinal <= 0) return 0;
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * roarStrength / 100) : 1;
    const toxinShardMul = 1 + Math.max(0, (params.toxinDamagePct || 0)) / 100;
    return initialToxinFinal * 0.5 * roarMul * toxinShardMul * 6;
}

// Calculating Armor Strip Multiplier
function armorStripMultiplier({ heat, corrosiveStacks, cpPct }) {
    // Heat = multiplicative 50%
    const heatMul = heat ? 0.5 : 1.0;

    // Corrosive Status stacks = 14 stacks = 100% strip
    const s = Math.min(25, Math.max(0, corrosiveStacks));
    const corrosiveStrip = Math.min(1, s / 14);
    const corrosiveMul = 1 - corrosiveStrip;

    // Corrosive Projection % (0–100%)
    const cpMul = 1 - Math.min(1, Math.max(0, cpPct / 100));

    return heatMul * corrosiveMul * cpMul;
}

// Calculating the Final Armor Value
function scaledArmorWithStrip(level, params) {
    // 1. Scaled armor
    let rawArmor = armorAt(level, params.baseLevel, params.baseArmor);

    // 2. HARD CAP at 2700 before strip
    rawArmor = Math.min(2700, Math.max(0, rawArmor));

    // 3. Apply armor strip (heat, corrosive, CP)
    const stripMul = armorStripMultiplier({
        heat: params.heatEnabled,
        corrosiveStacks: params.corrosiveStacks,
        cpPct: params.cpPct
    });

    const strippedArmor = rawArmor * stripMul;

    // 4. Clamp AGAIN (cannot exceed 2700 and cannot go negative)
    const finalArmor = Math.max(0, Math.min(2700, strippedArmor));

    // 5. DR calculation (uses finalArmor)
    const dr = armorDamageReduction(finalArmor);

    return {
        rawArmor,       // capped pre-strip armor
        netArmor: finalArmor,
        dr
    };
}

// ---------- Damage scaling ----------
function damageMultiplierGeneric(level, baseLevel) {
    const d = Math.max(level - baseLevel, 0);
    return 1 + 0.015 * Math.pow(d, 1.55);
}

function damageMultiplierCGT(level, baseLevel) {
    const d = Math.max(level - baseLevel, 0);
    const f1 = 1 + 0.015  * Math.pow(d, 1.75);
    const f2 = 1 + 0.0075 * Math.pow(d, 1.55);

    let S2;
    if (d < 1) {
    S2 = 0;
    } else if (d > 25) {
    S2 = 1;
    } else {
    const T = (d - 1) / 24;
    S2 = 3 * T * T - 2 * T * T * T;
    }
    return f1 * (1 - S2) + f2 * S2;
}

function factionDamageBaseMultiplier(faction) {
    if (faction === 'corpus' || faction === 'grineer' || faction === 'techrot') return 2;
    if (faction === 'infested') return 3;
    return 1;
}

function damageMultiplier(level, baseLevel, faction) {
    const scale =
    (faction === 'corpus' || faction === 'grineer' || faction === 'techrot')
        ? damageMultiplierCGT(level, baseLevel)
        : damageMultiplierGeneric(level, baseLevel);

    const baseMul = factionDamageBaseMultiplier(faction);
    return scale * baseMul;
}

// Status (Viral/Magnetic) stacks: 0–10 => up to 4.25x
function statusDamageMultiplier(stacks) {
    const s = Math.max(0, Math.min(10, stacks|0));
    if (s === 0) return 1;
    return 2 + 0.25 * (s - 1);
}

// Mind Control %: when disabled => 1x; when enabled => 1 + max(pct, 750)/100
function mindControlMultiplier(pct, enabled) {
    if (!enabled) return 1;
    const v = Math.max(0, pct|0);
    const clamped = v < 750 ? 750 : v;
    return 1 + clamped / 100;
}

// Nekros Shadows of the Dead Multiplier: when disabled => 1x; when enabled => value as-is (e.g. 3.78x)
function nekrosMultiplier(mult, enabled) {
    if (!enabled) return 1;
    const v = parseFloat(mult);
    if (!isFinite(v) || v <= 0) return 1;
    return v;
}

// Summoners Wrath Multiplier: when disabled => 0%; when enabled => value as-is
function summonersWrathMultiplier(pct, enabled) {
    if (!enabled) return 1;
    const v = Math.max(0, pct|0);
    return 1 + v / 100;
}

// Damage Decoy derived multiplier (already in "x"): when disabled => 1x; when enabled => value as-is
function damageDecoyMultiplier(mult, enabled) {
    if (!enabled) return 1;
    const v = parseFloat(mult);
    if (!isFinite(v) || v <= 0) return 1;
    return v;
}

function getMfdBonus(strengthPct) {
    const markPct = Math.min(1.5, Math.max(0.75, 0.75 * Math.max(0, strengthPct) / 100)); // 75% base to 150% cap
    return { markPct, markMul: 1 + markPct };
}

function applyMfdBonus(baseDamage, params, hpCap) {
    if (!baseDamage || baseDamage <= 0 || !params?.smiteMfdEnabled) return { total: baseDamage, bonus: 0, mfdPct: 0 };
    const { markPct } = getMfdBonus(params.abilityStrengthPct || 0);
    const cap = Math.max(0, hpCap || 0);
    if (markPct <= 0 || cap === 0) return { total: baseDamage, bonus: 0, mfdPct: 0 };
    const bonusRaw = baseDamage * markPct;
    const bonusCapped = Math.min(bonusRaw, cap);
    return { total: baseDamage + bonusCapped, bonus: bonusCapped, mfdPct: markPct * 100 };
}

function getRoarStrengthPct(params) {
    if (!params) return 0;
    const derived = params.roarAbilityStrengthPct;
    if (Number.isFinite(derived)) return Math.max(0, derived);
    const base = Math.max(0, params.abilityStrengthPct || 0);
    const bonus = params.roarPrecisionIntensify ? 90 : 0;
    return base + bonus;
}

function getNourishStrengthPct(params) {
    if (!params) return 0;
    const derived = params.nourishAbilityStrengthPct;
    if (Number.isFinite(derived)) return Math.max(0, derived);
    const base = Math.max(0, params.abilityStrengthPct || 0);
    const bonus = params.nourishPrecisionIntensify ? 90 : 0;
    return base + bonus;
}

function smiteDamageAtLevel(params, level, baseHealth, baseShield, faction) {
    const spec = getHealthScalingSpec('smite');
    if (!spec) return { main: 0, aoe: 0 };
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const baseMain = spec.baseMainPct * strengthMul;
    const baseAoe = spec.baseAoePct * strengthMul;
    const capMain = params.smiteSubsumeEnabled ? spec.capMainSubsume : spec.capMain;
    const capAoe = params.smiteSubsumeEnabled ? spec.capAoeSubsume : spec.capAoe;
    const mainPct = Math.min(capMain, baseMain);
    const aoePct = Math.min(capAoe, baseAoe);

    // Current HP at level (ignore shields/OG for both; AoE ignores shields as per toxin-like)
    const { hp } = healthShieldForScaling(level, params, baseHealth, baseShield, faction);

    const statusMul = statusDamageMultiplier(params.statusStacks);
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * roarStrength / 100) : 1;
    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
    const diffMul = difficultyFactor(params.enemyDifficulty);

    const mainDamageRaw = params.smiteSingleEnabled ? (hp * diffMul * mainPct) : 0;
    const aoeDamageRaw = params.smiteAoEEnabled ? (hp * diffMul * aoePct) : 0;

    const baseMainOut = mainDamageRaw * statusMul * roarMul * abilityDamageMul;
    const mfdApplied = (params.smiteMfdEnabled && params.smiteSingleEnabled)
        ? applyMfdBonus(baseMainOut, params, hp * diffMul)
        : { total: baseMainOut, bonus: 0, mfdPct: 0 };
    const mainDamage = mfdApplied.total;
    const aoeDamage = params.smiteAoEEnabled ? (aoeDamageRaw * statusMul * roarMul * abilityDamageMul) : 0;

    return { main: mainDamage, aoe: aoeDamage, pctMain: mainPct, pctAoe: aoePct, mfdPct: mfdApplied.mfdPct };
}

function energyVampireDamageAt(params, level, baseHealth, faction) {
    const spec = getHealthScalingSpec('energy_vampire');
    if (!spec) return { val: 0, pct: 0, mfdPct: 0 };
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const pct = (spec.basePct || 0) * strengthMul;
    const { hp } = healthShieldForScaling(level, params, baseHealth, params.baseShield, faction);
    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * roarStrength / 100) : 1;
    const statusMul = statusDamageMultiplier(params.statusStacks);
    const baseOut = hp * pct * abilityDamageMul * roarMul * statusMul;
    const mfdApplied = params.smiteMfdEnabled
        ? applyMfdBonus(baseOut, params, hp)
        : { total: baseOut, bonus: 0, mfdPct: 0 };
    return { val: mfdApplied.total, pct, mfdPct: mfdApplied.mfdPct };
}

function regurgitateDamageAt(params) {
    const spec = getHealthScalingSpec('regurgitate');
    if (!spec) return { val: 0, base: 0 };
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const baseDmg = spec.baseDamage * strengthMul;
    const level = Math.max(1, params.targetLevel || params.baseLevel || 1);
    const { baseLevel, baseHealth, faction, enemyType } = params;
    const diffMul = difficultyFactor(params.enemyDifficulty);
    let hp = 0;
    if (enemyType === 'eximus_def') {
    hp = healthEximusDefAt(level, baseLevel, faction, baseHealth);
    } else if (enemyType === 'eximus_nodef') {
    hp = healthEximusNoDefAt(level, baseLevel, faction, baseHealth);
    } else {
    hp = healthAt(level, baseLevel, faction, baseHealth);
    }
    hp *= diffMul;
    const hpBonus = 0.10 * hp; // 10% enemy max HP added before multipliers
    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * roarStrength / 100) : 1;
    const statusMul = statusDamageMultiplier(params.statusStacks);
    const dmg = (baseDmg + hpBonus) * abilityDamageMul * roarMul * statusMul * vulnerabilityMultiplier(params);
    return { val: dmg, base: baseDmg + hpBonus };
}

function reaveDamageAtLevel(params, level, baseHealth, faction) {
    const spec = getHealthScalingSpec('reave');
    if (!spec) return { val: 0, pct: 0 };
    const basePct = params.reaveEnthrallEnabled ? spec.enthrallPct : spec.basePct;
    const effPct = basePct * Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const { hp } = healthShieldForScaling(level, params, baseHealth, params.baseShield, faction);
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * roarStrength / 100) : 1;
    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
    const dmg = hp * effPct * roarMul * abilityDamageMul;
    return { val: dmg, pct: effPct };
}

function reapSowDamageAtLevel(params, level, baseHealth, baseShield, faction, { globalVuln = 1 } = {}) {
    const spec = getHealthScalingSpec('reap_sow');
    if (!spec) {
    return { total: 0, trueDamage: 0, blastDamage: 0, pct: 0, vulnPct: 0, blastHits: 0 };
    }
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const basePct = (spec.basePct || 0); // Damage is fixed and does not scale with Ability Strength
    const vulnPct = (spec.vulnBasePct || 0) * strengthMul;
    const vulnMul = 1 + vulnPct;

    const statusMul = statusDamageMultiplier(params.statusStacks);
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * roarStrength / 100) : 1;
    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
    const diffMul = difficultyFactor(params.enemyDifficulty);

    const { hp, sh } = healthShieldForScaling(level, params, baseHealth, baseShield, faction);
    const armorInfo = scaledArmorWithStrip(level, params);
    const armorDR = armorInfo.dr;

    const enemyCountRaw = parseInt(params.reapEnemyCount || '1', 10);
    const enemyCount = Math.max(1, isFinite(enemyCountRaw) ? enemyCountRaw : 1);
    const blastHits = Math.max(0, enemyCount - 1);

    const buffMul = statusMul * roarMul * abilityDamageMul * vulnMul * globalVuln;
    const rawTrue = hp * basePct;
    const trueDamage = rawTrue * buffMul;

    const blastPerHitRaw = hp * basePct;
    const blastPerHit = blastPerHitRaw * buffMul;
    const totalBlastRaw = blastPerHit * blastHits;

    const applyMitigation = (raw, shieldVal, dr) => {
    const dmg = Math.max(0, raw);
    const shBlock = Math.min(shieldVal, dmg);
    const afterShield = dmg - shBlock;
    const healthPortion = afterShield * (1 - dr);
    return shBlock + healthPortion;
    };
    const blastDamage = applyMitigation(totalBlastRaw, sh, armorDR);

    const total = trueDamage + blastDamage;
    return { total, trueDamage, blastDamage, pct: basePct, vulnPct, blastHits };
}
// Build reflective multipliers with clear exclusions/stack order.
function buildReflectiveMultiplierParts(params, { useNourish = false } = {}) {
    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;

    // Buffs that can be excluded per-source.
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;

    // Summoner's Wrath only applies when Nekros (Shadows) or Damage Decoy are active.
    const swAllowed = params.nekrosEnabled || params.damageDecoyEnabled;
    const swMul = swAllowed ? summonersWrathMultiplier(params.summWrath, params.summWrathEnabled) : 1;

    const nourishBlocked = params.coldWardEnabled
        || params.linkEnabled
        || params.damageDecoyEnabled
        || params.reflectiveAbility === 'damage_decoy'
        || params.reverseRotorEnabled
        || params.mesmerSkinEnabled
        || params.thornsEnabled
        || params.shatterShieldEnabled;
    const nourishMul = (useNourish && params.nourishEnabled && !nourishBlocked)
        ? (1 + Math.max(0, params.nourishPct || 0) / 100)
        : 1;

    // Radiation stacks: first = 100%, +50% each to 550% cap (10 stacks)
    let radiationMul = 1;
    if (params.reflectiveAbility === 'mind_control'
        || params.reflectiveAbility === 'nekros'
        || params.reflectiveAbility === 'damage_decoy'
        || params.reflectiveAbility === 'accuse') {
    const radStacks = Math.max(0, Math.min(10, params.radiationStacks || 0));
    const radPct = radStacks === 0 ? 0 : Math.min(550, 100 + 50 * (radStacks - 1));
    radiationMul = 1 + radPct / 100;
    }

    const coldWardMul = params.coldWardEnabled
        ? 3 * Math.max(0, 1 + ((params.abilityStrengthPct || 0) - 100) / 100)
        : 1;
    const linkMul = params.linkEnabled ? 0.75 : 1;
    const reverseRotorMul = params.reverseRotorEnabled
        ? Math.min(0.75, 0.35 * Math.max(0, 1 + ((params.abilityStrengthPct || 0) - 100) / 100))
        : 1;
    const mesmerSkinMul = params.mesmerSkinEnabled ? 1.0 : 1;
    const thornsMul = params.thornsEnabled ? 0.5 : 1;
    const shatterShieldMul = params.shatterShieldEnabled ? 1.0 : 1;

    const mindMul = mindControlMultiplier(params.mindControlPct, params.mindControlEnabled);
    const nekMul = nekrosMultiplier(params.nekrosMult, params.nekrosEnabled);
    const decoyMul = damageDecoyMultiplier(params.damageDecoyMult, params.damageDecoyEnabled);
    const malletBaseMul = params.malletEnabled
        ? 2.5 * Math.max(0, (params.abilityStrengthPct || 0) / 100)
        : 1;

    const parts = {
        status: statusDamageMultiplier(params.statusStacks),
        radiation: radiationMul,
        abilityDamage: abilityDamageMul,
        roar: roarMul,
        summonersWrath: swMul,
        nourish: nourishMul,
        coldWard: coldWardMul,
        link: linkMul,
        mesmerSkin: mesmerSkinMul,
        reverseRotor: reverseRotorMul,
        thorns: thornsMul,
        shatterShield: shatterShieldMul,
        mindControl: mindMul,
        nekros: nekMul,
        damageDecoy: decoyMul,
        mallet: malletBaseMul
    };
    const total = Object.values(parts).reduce((acc, v) => acc * v, 1);
    return { ...parts, total };
}

function updateVulnerabilityDisplays(params) {
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const setPct = (el, pct) => { if (el) el.textContent = `${(pct * 100).toFixed(0)}%`; };

    setPct(atlasPetrifyDisplayEl, 0.50 * strengthMul);
    setPct(calibanWrathDisplayEl, 0.35 * strengthMul);
    setPct(equinoxRageDisplayEl, 0.50 * strengthMul);
    setPct(garaMassDisplayEl, 0.50 * strengthMul);
    setPct(garaSplinterDisplayEl, 0.35 * strengthMul);
    setPct(jadeJudgementsDisplayEl, 0.50);
    setPct(khoraDomeDisplayEl, 2.0);
    setPct(nezhaChakramDisplayEl, 1.0 * strengthMul);
    setPct(novaPrimeDisplayEl, 1.0);
    setPct(oraxiaEmbraceDisplayEl, 0.50 * strengthMul);
    setPct(qorvexWallDisplayEl, 0.25 * strengthMul);
    const seaPct = 2.0 * strengthMul;
    setPct(yareliSeaDisplayEl, seaPct);
    setPct(yareliMerulinaDisplayEl, seaPct);
    // Iron Skin displays
    const ironSkinInfo = ironSkinOverguardAt(params, params.targetLevel);
    const ironSkinOG = ironSkinInfo.og;
    const ironSkinActive = params.reflectiveAbility === 'iron_skin';
    if (destructRankEl) destructRankEl.disabled = !ironSkinActive;
    if (destructStacksEl) destructStacksEl.disabled = !ironSkinActive;
    if (ironSkinDisplayEl) ironSkinDisplayEl.textContent = ironSkinActive ? formatStatNumber(ironSkinOG) : '-';
    if (ironShrapnelDisplayEl) ironShrapnelDisplayEl.textContent = (ironSkinActive && params.ironShrapnelEnabled) ? formatStatNumber(ironSkinOG) : '-';
    if (destructRankDisplayEl) {
    const rankVal = Math.max(0, params.destructRank || 0);
    const pct = params.destructPct ?? getDestructPct(rankVal);
    const stacks = Math.max(0, params.destructStacks || 0);
    destructRankDisplayEl.textContent = `Rank ${rankVal} • ${pct}% • x${stacks}`;
    }
}

function vulnerabilityMultiplier(params) {
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const entries = [
    params.atlasPetrifyEnabled ? (0.50 * strengthMul) : 0,
    params.calibanWrathEnabled ? (0.35 * strengthMul) : 0,
    params.equinoxRageEnabled ? (0.50 * strengthMul) : 0,
    params.garaMassEnabled ? (0.50 * strengthMul) : 0,
    params.garaSplinterEnabled ? (0.35 * strengthMul) : 0,
    params.jadeJudgementsEnabled ? 0.50 : 0,
    params.khoraDomeEnabled ? 2.0 : 0,
    params.nezhaChakramEnabled ? (1.0 * strengthMul) : 0,
    params.novaPrimeEnabled ? 1.0 : 0,
    params.oraxiaEmbraceEnabled ? (0.50 * strengthMul) : 0,
    params.qorvexWallEnabled ? (0.25 * strengthMul) : 0,
    params.yareliSeaEnabled ? (2.0 * strengthMul) : 0,
    (params.yareliMerulinaEnabled && params.yareliSeaEnabled) ? (2.0 * strengthMul) : 0
    ];
    return entries.reduce((acc, pct) => acc * (1 + Math.max(0, pct)), 1);
}

// Iron Skin helpers to keep displays, scaling, and plotting in sync
function ironSkinOverguardAt(params, level, enemyDamageOverride = null) {
    const strengthFactor = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const baseArmorModded = (params.wfBaseArmor || 0) * (1 + (params.wfArmorIncreasePct || 0) / 100);
    const totalArmor = baseArmorModded + (params.wfArmorAdded || 0);
    const baseOG = 1200 * strengthFactor; // max rank base overguard scaled by strength
    const armorMult = 2.5 * strengthFactor; // max rank armor multiplier scaled by strength
    const enemyDamageAtLevel = enemyDamageOverride != null
        ? enemyDamageOverride
        : ((params.baseDamage > 0)
            ? params.baseDamage
                * damageMultiplier(level, params.baseLevel, params.faction)
                * difficultyFactor(params.enemyDifficulty)
            : 0);
    const og = baseOG + armorMult * totalArmor + enemyDamageAtLevel;
    return { og, baseOG, armorMult, totalArmor, enemyDamageAtLevel };
}

function ironSkinDetonationDamage(params, level, { vulnMul = null, enemyDamageOverride = null } = {}) {
    const ogInfo = ironSkinOverguardAt(params, level, enemyDamageOverride);
    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;
    const statusMulLocal = statusDamageMultiplier(params.statusStacks);
    const vuln = vulnMul == null ? vulnerabilityMultiplier(params) : vulnMul;
    const destructPct = (params.destructPct ?? getDestructPct(params.destructRank || 0)) / 100;
    const destructStacks = Math.max(0, params.destructStacks || 0);
    const destructMul = 1 + destructPct * destructStacks;
    const dmg = ogInfo.og * abilityDamageMul * roarMul * statusMulLocal * vuln * destructMul;
    return { dmg, ogInfo };
}

function scalingMultiplierFromParams(params, { useNourish = true } = {}) {
    const mode = params.scalingMode || 'reflective';
    const baseAddMul = statusDamageMultiplier(params.statusStacks);
    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;
    const nourishMul = (useNourish && params.nourishEnabled) ? (1 + Math.max(0, params.nourishPct || 0) / 100) : 1;
    const vulnMul = vulnerabilityMultiplier(params);
    if (mode === 'reflective') {
    const parts = buildReflectiveMultiplierParts(params, { useNourish: useNourish && params.reflectiveAbility !== 'damage_decoy' });
    return parts.total * vulnMul;
    }
    // Level and Health scaling placeholders (future abilities can be added)
    return baseAddMul * abilityDamageMul * roarMul * nourishMul * vulnMul;
}

// ---------- Eximus multipliers ----------
function _eximusStep(d){
    if (d <= 15)  return 1.0;
    if (d <= 25)  return 1.0 + 0.025 * (d - 15);
    if (d <= 35)  return 1.25 + 0.125 * (d - 25);
    if (d <= 50)  return 2.5 + (2/15) * (d - 35);
    if (d <= 100) return 4.5 + 0.03 * (d - 50);
    return 6.0;
}
function eximusHealthMultiplier(level, baseLevel, baseHealth) {
    const d = Math.max(level - baseLevel, 0);
    const step = _eximusStep(d);
    const m = 0.25 * ((baseHealth + 900) / baseHealth) * step;
    return Math.max(1.1, m);
}
function eximusHealthNSAMultiplier(level, baseLevel, baseHealth) {
    const d = Math.max(level - baseLevel, 0);
    const step = _eximusStep(d);
    const m = 0.375 * ((baseHealth + 900) / baseHealth) * step;
    return Math.max(1.1, m);
}
function eximusShieldMultiplier(level, baseLevel) {
    const d = Math.max(level - baseLevel, 0);
    if (d <= 15)  return 1.1;
    if (d <= 25)  return Math.max(1.1, 1 + 0.025 * (d - 15));
    if (d <= 35)  return Math.max(1.1, 1.25 + 0.125 * (d - 25));
    if (d <= 50)  return Math.max(1.1, 2.5 + (2/15) * (d - 35));
    if (d <= 100) return Math.max(1.1, 4.5 + 0.03 * (d - 50));
    return Math.max(1.1, 6.0);
}

// ---------- Overguard ----------
const BASE_OVERGUARD = 12;
const OVERGUARD_COLOR = '#a7fff3';
const DAMAGE_COLOR = '#f97316';
const SCALING_DAMAGE_COLOR = '#0f9d58';
const EHP_COLOR = '#a855f7';
const INTERSECTION_COLOR = '#fbbf24';

function overguardF1(level) {
    const d = level - 1;
    return 1 + 0.0015 * Math.pow(d, 4);
}
function overguardF2(level) {
    const d = level - 1;
    return 1 + 260 * Math.pow(d, 0.9);
}
function overguardSmooth(level) {
    const d = level - 1;
    if (d < 45) return 0;
    if (d <= 50) {
    const T = (d - 45) / 5;
    return 3 * T * T - 2 * T * T * T;
    }
    return 1;
}
function overguardMultiplier(level) {
    const f1 = overguardF1(level);
    const f2 = overguardF2(level);
    const S2 = overguardSmooth(level);
    return f1 * (1 - S2) + f2 * S2;
}
function overguardAt(level) {
    return BASE_OVERGUARD * overguardMultiplier(level);
}

// ---------- Difficulty ----------
function difficultyFactor(diff) { return diff === 'steel' ? 2.5 : 1; }

// ---------- Sticky Target Level Controls ----------
function setTargetLevelFromControls(newValue) {
    const clamped = Math.max(1, Math.min(9999, parseInt(newValue || '1', 10)));

    if (targetLevelEl) targetLevelEl.value = clamped;
    if (targetLevelRangeEl) targetLevelRangeEl.value = clamped;

    // Recompute everything
    scheduleHandleChange('input');
}

// ---------- DOM refs ----------
const getEl = (id) => document.getElementById(id);
const pick = (ids) => Object.fromEntries(ids.map(id => [id, getEl(id)]));

const dom = {
    // Core enemy stats and their slider pairs
    base: pick(['baseLevel','baseLevelRange','baseHealth','baseHealthRange','baseShield','baseShieldRange','baseArmor','baseArmorRange']),
    // Armor strip controls
    strip: pick(['heatEnabled','corrosiveStacks','corrosiveStacksRange','cp','cpRange']),
    // Incoming damage + status stacks
    damage: pick(['baseDamage','baseDamageRange','statusStacks','statusStacksVal','radiationStacks','radiationStacksVal']),
// Multipliers (mind control, Summoner's Wrath, toggles for reflective scaling)
    multipliers: pick(['mindControl','mindControlRange','mindControlEnabled','nekrosEnabled','summWrath','summWrathRange','summWrathEnabled','damageDecoyEnabled','malletEnabled','accuseEnabled','roarEnabled','roarSubsume','roarPrecisionIntensify','roarDisplay','atlasPetrifyEnabled','calibanWrathEnabled','equinoxRageEnabled','garaMassEnabled','garaSplinterEnabled','jadeJudgementsEnabled','khoraDomeEnabled','nezhaChakramEnabled','novaPrimeEnabled','oraxiaEmbraceEnabled','qorvexWallEnabled','yareliSeaEnabled','yareliMerulinaEnabled','absorbEnabled']),
    // Warframe stats
    warframe: pick(['wfAbilityStrength','wfAbilityDamage','wfToxinDamage','wfBaseArmor','wfArmorIncrease','wfArmorAdded','ironShrapnelEnabled','ironSkinDisplay','ironShrapnelDisplay','destructRank','destructRankDisplay','destructStacks','absorbEnabled','nourishEnabled','nourishSubsume','nourishPrecisionIntensify','trueToxinEnabled','trueDamageEnabled','nekrosMultDisplay','damageDecoyDisplay','nourishDisplay','coldWardEnabled','coldWardDisplay','linkEnabled','linkDisplay','reverseRotorEnabled','reverseRotorDisplay','mesmerSkinEnabled','thornsEnabled','thornsDisplay','shatterShieldEnabled','shatterShieldDisplay']),
    // Target selection and faction/difficulty
    target: pick(['targetLevel','targetLevelRange','faction','enemyType','enemyDifficulty']),
    // UI controls/toggles
    controls: pick(['togglePlot','shareBtn','showBase','showExDef','showExNoDef','showDamage','showScaling','showEHP','transparentBgToggle','exportPlotPng','exportPlotMp4','exportMp4Quality','exportDpiScale','factionSticky','steelPathSticky','compareModeBottom','compareMetricBottom','xAxisFrom','xAxisTo','yAxisMax']),
    levelScaling: pick(['levelScalingSelect','vaubanPassiveEnabled','overdriverEnabled','feastEnemyCount','arachneEnabled','arachneRank','holsterAmpEnabled','vigorousSwapEnabled']),
    healthScaling: pick(['healthScalingSelect','smiteSingleEnabled','smiteAoEEnabled','smiteSubsumeEnabled','smiteMfdEnabled','reaveEnthrallEnabled','reapEnemyCount','regurgitateGastroEnabled']),
    reflectiveSelect: pick(['reflectiveSelect']),
    ab: pick(['abCompareToggle','abLabelA','abLabelB','abSaveA','abSaveB','abLoadA','abLoadB','abClearA','abClearB','abCopyAToB','abCopyBToA','abSwapPresets','abResetPresets','abStatusA','abStatusB','abToast']),
    // Output readouts and plot visibility helpers
    outputs: pick(['lvlOut','lvlOut2','lvlOut3','lvlOut4','lvlOutDmg','lvlOutScaling','hpOut','hpMulOut','shOut','shMulOut','ogOut','ogMulOut','armorOut','armorDROut','ehpOut','dmgOut','dmgMulOut','scalingOut','scalingMulOut','shieldBlock']),
    // Plot container + canvas
    plot: pick(['plotCard','plot']),
    // Summary bar + annotations
    summary: pick(['sumHp','sumShield','sumDR','sumEhp','sumDmg','sumScaling','intersectionNote','sumTargetLevel','lvlUpBtn','lvlDownBtn'])
};

// Preserve existing variable names for downstream code
const {
    baseLevel: baseLevelEl,
    baseLevelRange: baseLevelRangeEl,
    baseHealth: baseHealthEl,
    baseHealthRange: baseHealthRangeEl,
    baseShield: baseShieldEl,
    baseShieldRange: baseShieldRangeEl,
    baseArmor: baseArmorEl,
    baseArmorRange: baseArmorRangeEl
} = dom.base;

const {
    heatEnabled: heatEnabledEl,
    corrosiveStacks: corrosiveStacksEl,
    corrosiveStacksRange: corrosiveStacksRangeEl,
    cp: cpEl,
    cpRange: cpRangeEl
} = dom.strip;

const {
    baseDamage: baseDamageEl,
    baseDamageRange: baseDamageRangeEl,
    statusStacks: statusStacksEl,
    statusStacksVal,
    radiationStacks: radiationStacksEl,
    radiationStacksVal
} = dom.damage;

const {
    mindControl: mindControlEl,
    mindControlRange: mindControlRangeEl,
    mindControlEnabled: mindControlEnabledEl,
    nekrosEnabled: nekrosEnabledEl,
    summWrath: summWrathEl,
    summWrathRange: summWrathRangeEl,
    summWrathEnabled: summWrathEnabledEl,
    damageDecoyEnabled: damageDecoyEnabledEl,
    accuseEnabled: accuseEnabledEl,
    roarEnabled: roarEnabledEl,
    roarSubsume: roarSubsumeEl,
    roarPrecisionIntensify: roarPrecisionIntensifyEl,
    roarDisplay: roarDisplayEl,
    atlasPetrifyEnabled: atlasPetrifyEnabledEl,
    calibanWrathEnabled: calibanWrathEnabledEl,
    equinoxRageEnabled: equinoxRageEnabledEl,
    garaMassEnabled: garaMassEnabledEl,
    garaSplinterEnabled: garaSplinterEnabledEl,
    jadeJudgementsEnabled: jadeJudgementsEnabledEl,
    khoraDomeEnabled: khoraDomeEnabledEl,
    nezhaChakramEnabled: nezhaChakramEnabledEl,
    novaPrimeEnabled: novaPrimeEnabledEl,
    oraxiaEmbraceEnabled: oraxiaEmbraceEnabledEl,
    qorvexWallEnabled: qorvexWallEnabledEl,
    yareliSeaEnabled: yareliSeaEnabledEl,
    yareliMerulinaEnabled: yareliMerulinaEnabledEl
} = dom.multipliers;
const malletEnabledEl = document.getElementById('malletEnabled');

const {
    wfAbilityStrength: abilityStrengthEl,
    wfAbilityDamage: abilityDamageEl,
    wfToxinDamage: toxinDamageEl,
    wfBaseArmor: wfBaseArmorEl,
    wfArmorIncrease: wfArmorIncreaseEl,
    wfArmorAdded: wfArmorAddedEl,
    ironShrapnelEnabled: ironShrapnelEnabledEl,
    ironSkinDisplay: ironSkinDisplayEl,
    ironShrapnelDisplay: ironShrapnelDisplayEl,
    destructRank: destructRankEl,
    destructRankDisplay: destructRankDisplayEl,
    destructStacks: destructStacksEl,
    absorbEnabled: absorbEnabledEl,
    nourishEnabled: nourishEnabledEl,
    nourishSubsume: nourishSubsumeEl,
    nourishPrecisionIntensify: nourishPrecisionIntensifyEl,
    nourishDisplay: nourishDisplayEl,
    coldWardEnabled: coldWardEnabledEl,
    linkEnabled: linkEnabledEl,
    reverseRotorEnabled: reverseRotorEnabledEl,
    mesmerSkinEnabled: mesmerSkinEnabledEl,
    thornsEnabled: thornsEnabledEl,
    shatterShieldEnabled: shatterShieldEnabledEl,
    trueToxinEnabled: trueToxinEnabledEl,
    trueDamageEnabled: trueDamageEnabledEl,
    nekrosMultDisplay: nekrosMultDisplayEl,
    damageDecoyDisplay: damageDecoyDisplayEl,
    coldWardDisplay: coldWardDisplayEl,
    linkDisplay: linkDisplayEl,
    reverseRotorDisplay: reverseRotorDisplayEl,
    mesmerSkinDisplay: mesmerSkinDisplayEl,
    thornsDisplay: thornsDisplayEl,
    shatterShieldDisplay: shatterShieldDisplayEl
} = dom.warframe;

const {
    targetLevel: targetLevelEl,
    targetLevelRange: targetLevelRangeEl,
    faction: factionEl,
    enemyType: enemyTypeEl,
    enemyDifficulty: enemyDifficultyEl
} = dom.target;

const {
    togglePlot: togglePlotBtn,
    shareBtn,
    showBase: showBaseEl,
    showExDef: showExDefEl,
    showExNoDef: showExNoDefEl,
    showDamage: showDamageEl,
    showScaling: showScalingEl,
    showEHP: showEHPEl,
    transparentBgToggle,
    exportPlotPng,
    exportPlotMp4,
    exportMp4Quality,
    exportDpiScale,
    factionSticky,
    steelPathSticky,
    compareModeBottom,
    compareMetricBottom
} = dom.controls;
const xAxisFromEl = dom.controls?.xAxisFrom;
const xAxisToEl = dom.controls?.xAxisTo;
const yAxisMaxEl = dom.controls?.yAxisMax;
const {
    levelScalingSelect: levelScalingEl
} = dom.levelScaling;
const feastEnemyCountEl = dom.levelScaling?.feastEnemyCount;
const feastEnemyCountValEl = document.getElementById('feastEnemyCountVal');
const {
    healthScalingSelect: healthScalingSelectEl,
    smiteSingleEnabled: smiteSingleEnabledEl,
    smiteAoEEnabled: smiteAoEEnabledEl,
    smiteSubsumeEnabled: smiteSubsumeEnabledEl,
    smiteMfdEnabled: smiteMfdEnabledEl,
    reaveEnthrallEnabled: reaveEnthrallEnabledEl,
    reapEnemyCount: reapEnemyCountEl,
    regurgitateGastroEnabled: regurgitateGastroEnabledEl
} = dom.healthScaling;
const reflectiveSelectEl = dom.reflectiveSelect?.reflectiveSelect;
const {
    abCompareToggle,
    abLabelA,
    abLabelB,
    abSaveA,
    abSaveB,
    abLoadA,
    abLoadB,
    abClearA,
    abClearB,
    abCopyAToB,
    abCopyBToA,
    abSwapPresets,
    abResetPresets,
    abStatusA,
    abStatusB,
    abToast
} = dom.ab;
const flechetteDisplayRowEl = document.getElementById('flechetteDisplayRow');
const flechetteDisplayEl = document.getElementById('flechetteDisplay');
const levelScalingLabelEl = document.getElementById('levelScalingLabel');
const levelScalingTooltipEl = document.getElementById('levelScalingTooltip');
const healthScalingDisplayRowEl = document.getElementById('healthScalingDisplayRow');
const healthScalingDisplayEl = document.getElementById('healthScalingDisplay');
const healthScalingLabelEl = document.getElementById('healthScalingLabel');
const healthScalingTooltipEl = document.getElementById('healthScalingTooltip');
const atlasPetrifyDisplayEl = document.getElementById('atlasPetrifyDisplay');
const calibanWrathDisplayEl = document.getElementById('calibanWrathDisplay');
const equinoxRageDisplayEl = document.getElementById('equinoxRageDisplay');
const garaMassDisplayEl = document.getElementById('garaMassDisplay');
const garaSplinterDisplayEl = document.getElementById('garaSplinterDisplay');
const jadeJudgementsDisplayEl = document.getElementById('jadeJudgementsDisplay');
const khoraDomeDisplayEl = document.getElementById('khoraDomeDisplay');
const nezhaChakramDisplayEl = document.getElementById('nezhaChakramDisplay');
const novaPrimeDisplayEl = document.getElementById('novaPrimeDisplay');
const oraxiaEmbraceDisplayEl = document.getElementById('oraxiaEmbraceDisplay');
const qorvexWallDisplayEl = document.getElementById('qorvexWallDisplay');
const yareliSeaDisplayEl = document.getElementById('yareliSeaDisplay');
const yareliMerulinaDisplayEl = document.getElementById('yareliMerulinaDisplay');
const malletDisplayEl = document.getElementById('malletDisplay');
const vaubanPassiveEl = document.getElementById('vaubanPassiveEnabled');
const overdriverEnabledEl = document.getElementById('overdriverEnabled');
const overdriverDisplayEl = document.getElementById('overdriverDisplay');
const arachneEnabledEl = document.getElementById('arachneEnabled');
const arachneRankEl = document.getElementById('arachneRank');
const arachneDisplayEl = document.getElementById('arachneDisplay');
const arachneRankValEl = document.getElementById('arachneRankVal');
const holsterAmpEnabledEl = document.getElementById('holsterAmpEnabled');
const vigorousSwapEnabledEl = document.getElementById('vigorousSwapEnabled');
const graspVastUntimeEl = document.getElementById('graspVastUntimeEnabled');
const graspUntimeRiftEl = document.getElementById('graspUntimeRiftEnabled');
const graspVastUntimeDisplayEl = document.getElementById('graspVastUntimeDisplay');
const healthScalingEl = dom.healthScaling?.healthScalingSelect;
const smiteSingleEl = dom.healthScaling?.smiteSingleEnabled;
const smiteAoEEl = dom.healthScaling?.smiteAoEEnabled;
const smiteSubsumeEl = dom.healthScaling?.smiteSubsumeEnabled;
const smiteMfdEl = document.getElementById('smiteMfdEnabled');
const smiteMfdDisplayEl = document.getElementById('smiteMfdDisplay');
const reaveEnthrallEl = dom.healthScaling?.reaveEnthrallEnabled;

const scalingModeReflectiveEl = document.getElementById('scalingModeReflective');
const scalingModeLevelEl = document.getElementById('scalingModeLevel');
const scalingModeHealthEl = document.getElementById('scalingModeHealth');

// Prevent radio clicks from collapsing dropdowns
[scalingModeReflectiveEl, scalingModeLevelEl, scalingModeHealthEl].forEach(el => {
    if (!el) return;
    el.addEventListener('click', ev => ev.stopPropagation());
});

[levelScalingEl].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => {
    if (scalingModeLevelEl) scalingModeLevelEl.checked = true;
    // Immediate UI refresh for level scaling displays
    const params = readParams();
    updateLevelScalingUI(params);
    scheduleHandleChange('change');
    });
});
if (feastEnemyCountEl) {
    const syncFeastLabel = () => {
    if (feastEnemyCountValEl) {
        const v = Math.max(1, Math.min(5, parseInt(feastEnemyCountEl.value || '1', 10)));
        feastEnemyCountValEl.textContent = `${v} ${v === 1 ? 'enemy' : 'enemies'}`;
    }
    };
    feastEnemyCountEl.addEventListener('input', () => { syncFeastLabel(); scheduleHandleChange('input'); });
    feastEnemyCountEl.addEventListener('change', () => { syncFeastLabel(); scheduleHandleChange('change'); });
    syncFeastLabel();
}
if (arachneRankEl) {
    const syncArachneLabel = () => {
    const rank = clampArachneRank(arachneRankEl.value);
    const pct = getArcaneArachnePct(rank);
    arachneRankEl.value = rank;
    if (arachneRankValEl) arachneRankValEl.textContent = `Rank ${rank} (+${pct.toFixed(0)}%)`;
    if (arachneDisplayEl) arachneDisplayEl.textContent = `${pct.toFixed(0)}%`;
    };
    arachneRankEl.addEventListener('input', () => { syncArachneLabel(); scheduleHandleChange('input'); });
    arachneRankEl.addEventListener('change', () => { syncArachneLabel(); scheduleHandleChange('change'); });
    syncArachneLabel();
}

function setScalingModeFromGroup(name) {
    if (!name) return;
    const map = {
    reflective: scalingModeReflectiveEl,
    level: scalingModeLevelEl,
    health: scalingModeHealthEl
    };
    const target = map[name];
    if (target && !target.checked) {
    target.checked = true;
    updateMindControlEnabledState();
    updateRadiationEnabledState();
    if (name === 'reflective' && reflectiveSelectEl) {
        applyReflectiveSelection(reflectiveSelectEl.value || 'none');
    }
    scheduleHandleChange('change');
    }
}

// Reflective ability selection helper: activates only the chosen toggle
function clearReflectiveSelection() {
    const map = {
    mind_control: mindControlEnabledEl,
    nekros: nekrosEnabledEl,
    damage_decoy: damageDecoyEnabledEl,
    mallet: malletEnabledEl,
    accuse: accuseEnabledEl,
    iron_skin: null,
    cold_ward: coldWardEnabledEl,
    link: linkEnabledEl,
    reverse_rotor: reverseRotorEnabledEl,
    mesmer_skin: mesmerSkinEnabledEl,
    thorns: thornsEnabledEl,
    shatter_shield: shatterShieldEnabledEl,
    absorb: absorbEnabledEl
    };
    Object.values(map).forEach(el => { if (el) el.checked = false; });
    document.querySelectorAll('.reflective-option').forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
    });
}

// Reflective ability selection helper: activates only the chosen toggle
function applyReflectiveSelection(key) {
    const map = {
    mind_control: mindControlEnabledEl,
    nekros: nekrosEnabledEl,
    damage_decoy: damageDecoyEnabledEl,
    mallet: malletEnabledEl,
    accuse: accuseEnabledEl,
    cold_ward: coldWardEnabledEl,
    link: linkEnabledEl,
    reverse_rotor: reverseRotorEnabledEl,
    mesmer_skin: mesmerSkinEnabledEl,
    thorns: thornsEnabledEl,
    shatter_shield: shatterShieldEnabledEl,
    absorb: absorbEnabledEl
    };
    const target = map[key];
    if (key === 'iron_skin') {
    // Clear other reflective toggles; Iron Skin is driven by the select itself
    Object.values(map).forEach(el => { if (el) el.checked = false; });
    if (ironShrapnelEnabledEl) {
        ironShrapnelEnabledEl.disabled = false;
        ironShrapnelEnabledEl.checked = true; // auto-enable when selecting Iron Skin
    }
    if (destructRankEl) destructRankEl.disabled = false;
    if (destructStacksEl) destructStacksEl.disabled = false;
    } else if (!target) {
    clearReflectiveSelection();
    if (destructRankEl) destructRankEl.disabled = true;
    if (destructStacksEl) destructStacksEl.disabled = true;
    updateMindControlEnabledState();
    refreshOpenDropdownHeights();
    return;
    }
    enforceReflectiveExclusive(target);
    if (target) {
    target.checked = true;
    Object.values(map).forEach(el => {
        if (el && el !== target) el.checked = false;
    });
    } else {
    Object.values(map).forEach(el => { if (el) el.checked = false; });
    }
    document.querySelectorAll('.reflective-option').forEach(el => {
    const match = el.getAttribute('data-reflective-key') === key;
    el.classList.toggle('active', match);
    if (!match) {
        el.style.display = 'none';
    } else {
        el.style.display = '';
    }
    });
    if (ironShrapnelEnabledEl) {
    if (key !== 'iron_skin') {
        ironShrapnelEnabledEl.checked = false;
        ironShrapnelEnabledEl.disabled = true;
    } else {
        ironShrapnelEnabledEl.disabled = false;
    }
    }
    const ironActive = key === 'iron_skin';
    if (destructRankEl) destructRankEl.disabled = !ironActive;
    if (destructStacksEl) destructStacksEl.disabled = !ironActive;
    updateMindControlEnabledState();
    refreshOpenDropdownHeights();
}

const {
    lvlOut,
    lvlOut2,
    lvlOut3,
    lvlOut4,
    lvlOutDmg,
    lvlOutScaling,
    hpOut,
    hpMulOut,
    shOut,
    shMulOut,
    ogOut,
    ogMulOut,
    armorOut,
    armorDROut,
    ehpOut,
    dmgOut,
    dmgMulOut,
    scalingOut,
    scalingMulOut,
    shieldBlock
} = dom.outputs;

const {
    plotCard,
    plot: canvas
} = dom.plot;
const ctx = canvas.getContext('2d');
let exportDimensions = null;
let recordingFillColor = null;
let recordingActive = false;
let recordingIncludeLegend = false;
let recordingLegendEntries = null;
let recordingLegendLayout = null;
const plotWrapEl = document.querySelector('.plot-wrap');
const resultCard = document.getElementById('resultCard');
const compareResultCard = document.getElementById('compareResultCard');
const compareStatsList = document.getElementById('compareStatsList');
const compareMetricLabelEl = document.getElementById('compareMetricLabel');
const compareMetricSubEl = document.getElementById('compareMetricSub');
const abPanelEl = document.querySelector('.ab-panel');

const {
    sumHp: sumHpEl,
    sumShield: sumShieldEl,
    sumDR: sumDREl,
    sumEhp: sumEhpEl,
    sumDmg: sumDmgEl,
    sumScaling: sumScalingEl,
    intersectionNote: intersectionNoteEl,
    sumTargetLevel: sumTargetLevelEl,
    lvlUpBtn,
    lvlDownBtn
} = dom.summary;

// Plot export controls
const transparentBgToggleEl = transparentBgToggle;
const exportPlotPngBtn = exportPlotPng;
const exportPlotMp4Btn = exportPlotMp4;
const exportMp4QualityEl = exportMp4Quality;
const exportDpiScaleEl = exportDpiScale;
const compareModeEl = compareModeBottom;
const compareMetricEl = compareMetricBottom;
const compareShowBaseEl = document.getElementById('compareShowBase');
const compareShowExDefEl = document.getElementById('compareShowExDef');
const compareShowExNoDefEl = document.getElementById('compareShowExNoDef');
function getCompareChips() { return Array.from(document.querySelectorAll('.comp-chip[data-faction]')); }

// Central map for fields that participate in sharing/reset/query restore.
const queryFields = {
    baseLevel:      { els: [baseLevelEl, baseLevelRangeEl], def: 1 },
    targetLevel:    { els: [targetLevelEl, targetLevelRangeEl], def: 100 },
    faction:        { els: [factionEl], def: 'grineer' },
    enemyType:      { els: [enemyTypeEl], def: 'normal' },
    enemyDifficulty:{ els: [enemyDifficultyEl], def: 'normal' },
    baseHealth:     { els: [baseHealthEl, baseHealthRangeEl], def: 300 },
    baseShield:     { els: [baseShieldEl, baseShieldRangeEl], def: 100 },
    baseArmor:      { els: [baseArmorEl, baseArmorRangeEl], def: 0 },
    baseDamage:     { els: [baseDamageEl, baseDamageRangeEl], def: 1 },
    statusStacks:   { els: [statusStacksEl], def: 0 },
    heat:           { els: [heatEnabledEl], def: false, bool: true },
    corrosiveStacks:{ els: [corrosiveStacksEl, corrosiveStacksRangeEl], def: 0 },
    cpPct:          { els: [cpEl, cpRangeEl], def: 0 },
    mindOn:         { els: [mindControlEnabledEl], def: true, bool: true },
    mindPct:        { els: [mindControlEl, mindControlRangeEl], def: 0 },
    nekOn:          { els: [nekrosEnabledEl], def: false, bool: true },
    swOn:           { els: [summWrathEnabledEl], def: false, bool: true },
    swPct:          { els: [summWrathEl, summWrathRangeEl], def: 0 },
    decoyOn:        { els: [damageDecoyEnabledEl], def: false, bool: true },
    radStacks:      { els: [radiationStacksEl], def: 0 },
    levelScaling:   { els: [levelScalingEl], def: 'none' },
    feastEnemyCount:{ els: [feastEnemyCountEl], def: 1 },
    healthScaling:  { els: [healthScalingSelectEl], def: 'none' },
    reflectiveAbility:{ els: [reflectiveSelectEl], def: 'none' },
    xAxisFrom:      { els: [xAxisFromEl], def: '' },
    xAxisTo:        { els: [xAxisToEl], def: '' },
    yAxisMax:       { els: [yAxisMaxEl], def: '' },
    abilityStrength:{ els: [abilityStrengthEl], def: 100 },
    abilityDamage:  { els: [abilityDamageEl], def: 0 },
    nourishOn:      { els: [nourishEnabledEl], def: false, bool: true },
    nourishSubsume: { els: [nourishSubsumeEl], def: false, bool: true },
    precisionNourish:{ els: [nourishPrecisionIntensifyEl], def: false, bool: true },
    coldWardOn:     { els: [coldWardEnabledEl], def: false, bool: true },
    linkOn:         { els: [linkEnabledEl], def: false, bool: true },
    reverseRotorOn: { els: [reverseRotorEnabledEl], def: false, bool: true },
    shatterShieldOn:{ els: [shatterShieldEnabledEl], def: false, bool: true },
    trueToxinOn:    { els: [trueToxinEnabledEl], def: false, bool: true },
    roarOn:         { els: [roarEnabledEl], def: false, bool: true },
    roarSubsume:    { els: [roarSubsumeEl], def: false, bool: true },
    precisionRoar:  { els: [roarPrecisionIntensifyEl], def: false, bool: true },
    trueDamage:     { els: [trueDamageEnabledEl], def: false, bool: true },
    wfToxinDamage:  { els: [toxinDamageEl], def: 0 },
    wfBaseArmor:    { els: [wfBaseArmorEl], def: 0 },
    wfArmorIncrease:{ els: [wfArmorIncreaseEl], def: 0 },
    wfArmorAdded:   { els: [wfArmorAddedEl], def: 0 },
    ironShrapnelOn: { els: [ironShrapnelEnabledEl], def: false, bool: true },
    destructRank:   { els: [destructRankEl], def: 5 },
    destructStacks: { els: [destructStacksEl], def: 0 },
    absorbOn:       { els: [absorbEnabledEl], def: false, bool: true },
    atlasPetrify:   { els: [atlasPetrifyEnabledEl], def: false, bool: true },
    calibanWrath:   { els: [calibanWrathEnabledEl], def: false, bool: true },
    equinoxRage:    { els: [equinoxRageEnabledEl], def: false, bool: true },
    garaMass:       { els: [garaMassEnabledEl], def: false, bool: true },
    garaSplinter:   { els: [garaSplinterEnabledEl], def: false, bool: true },
    jadeJudgements: { els: [jadeJudgementsEnabledEl], def: false, bool: true },
    khoraDome:      { els: [khoraDomeEnabledEl], def: false, bool: true },
    nezhaChakram:   { els: [nezhaChakramEnabledEl], def: false, bool: true },
    novaPrime:      { els: [novaPrimeEnabledEl], def: false, bool: true },
    oraxiaEmbrace:  { els: [oraxiaEmbraceEnabledEl], def: false, bool: true },
    qorvexWall:     { els: [qorvexWallEnabledEl], def: false, bool: true },
    yareliSea:      { els: [yareliSeaEnabledEl], def: false, bool: true },
    yareliMerulina: { els: [yareliMerulinaEnabledEl], def: false, bool: true },
    mallet:         { els: [malletEnabledEl], def: false, bool: true },
    vaubanPassive:  { els: [vaubanPassiveEl], def: false, bool: true },
    overdriver:     { els: [overdriverEnabledEl], def: false, bool: true },
    arachne:        { els: [arachneEnabledEl], def: false, bool: true },
    arachneRank:    { els: [arachneRankEl], def: 0 },
    holsterAmp:     { els: [holsterAmpEnabledEl], def: false, bool: true },
    vigorousSwap:   { els: [vigorousSwapEnabledEl], def: false, bool: true },
    vastUntime:     { els: [graspVastUntimeEl], def: false, bool: true },
    untimeRift:     { els: [graspUntimeRiftEl], def: false, bool: true },
    smiteSingle:    { els: [smiteSingleEnabledEl], def: false, bool: true },
    smiteAoE:       { els: [smiteAoEEnabledEl], def: false, bool: true },
    smiteSubsume:   { els: [smiteSubsumeEnabledEl], def: false, bool: true },
    smiteMfd:       { els: [smiteMfdEl], def: false, bool: true },
    reaveEnthrall:  { els: [reaveEnthrallEnabledEl], def: false, bool: true },
    reapEnemyCount: { els: [reapEnemyCountEl], def: 1 },
    regurgitateGastro: { els: [regurgitateGastroEnabledEl], def: false, bool: true },
    accuseOn:         { els: [accuseEnabledEl], def: false, bool: true },
    scalingModeReflective: { els: [scalingModeReflectiveEl], def: true, bool: true },
    scalingModeLevel:      { els: [scalingModeLevelEl], def: false, bool: true },
    scalingModeHealth:     { els: [scalingModeHealthEl], def: false, bool: true },
};
const queryFieldKeys = Object.keys(queryFields);
const fieldKeyToCode = Object.fromEntries(queryFieldKeys.map((k,i)=>[k, i.toString(36)]));
const fieldCodeToKey = Object.fromEntries(queryFieldKeys.map((k,i)=>[i.toString(36), k]));

function setField(key, value) {
    const spec = queryFields[key];
    if (!spec) return;
    const v = spec.bool ? !!value : value;
    (spec.els || []).forEach(el => {
        if (!el) return;
        if (spec.bool) el.checked = v;
        else el.value = v;
    });
    if (key === 'faction' && factionSticky) {
        factionSticky.value = v;
    }
    if (key === 'statusStacks' && statusStacksVal) statusStacksVal.textContent = v;
    if (key === 'radStacks' && radiationStacksVal) radiationStacksVal.textContent = v;
    if (key === 'scalingModeReflective' && scalingModeReflectiveEl && v) setScalingMode('reflective');
    if (key === 'scalingModeLevel' && scalingModeLevelEl && v) setScalingMode('level');
    if (key === 'scalingModeHealth' && scalingModeHealthEl && v) setScalingMode('health');
}

function getFieldValue(key) {
    const spec = queryFields[key];
    if (!spec || !spec.els || !spec.els[0]) return null;
    const el = spec.els[0];
    return spec.bool ? (el.checked ? 1 : 0) : el.value;
}

function resetFieldsToDefaults() {
    Object.entries(queryFields).forEach(([key, spec]) => setField(key, spec.def));
}

function getScalingMode() {
    if (scalingModeLevelEl?.checked) return 'level';
    if (scalingModeHealthEl?.checked) return 'health';
    return 'reflective';
}

function setScalingMode(mode) {
    const m = mode || 'reflective';
    if (scalingModeReflectiveEl) scalingModeReflectiveEl.checked = (m === 'reflective');
    if (scalingModeLevelEl) scalingModeLevelEl.checked = (m === 'level');
    if (scalingModeHealthEl) scalingModeHealthEl.checked = (m === 'health');
}

function refreshOpenDropdownHeights() {
    document.querySelectorAll('.dropdown-group:not(.collapsed) .dropdown-body').forEach(body => {
        body.style.maxHeight = body.scrollHeight + 'px';
    });
}

function updateMindControlEnabledState() {
    const on = getScalingMode() === 'reflective' && (reflectiveSelectEl?.value === 'mind_control');
    if (mindControlEnabledEl) mindControlEnabledEl.checked = on;
    if (mindControlEl) mindControlEl.disabled = !on;
    if (mindControlRangeEl) mindControlRangeEl.disabled = !on;
}

const destructPctByRank = [12, 25, 37, 50, 60, 65];
function getDestructPct(rank) {
    const r = Math.max(0, Math.min(destructPctByRank.length - 1, rank | 0));
    return destructPctByRank[r];
}

function hasReflectiveSelection(params) {
    return params.scalingMode === 'reflective'
        && params.reflectiveAbility
        && params.reflectiveAbility !== 'none';
}

const FLECHETTE_TOOLTIP = "50% critical chance, 2.0x critical multiplier, ~5% status chance, and a forced Puncture proc; pulls enemies within 10m. Crit damage can scale with Tenacious Bond or Arcane Crepuscular; crit chance can be boosted with Arcane Avenger; can headshot for additional multipliers.";

// Health-scaling specs (Smite, Reave, Reap/Sow)
const healthScalingSpecs = {
    smite: {
    label: "(Oberon) Smite Damage",
    tooltip: "Oberon Smite: Single Target ignores armor/shields/OG; AoE ignores shields, respects armor DR.",
    baseMainPct: 0.35, // 35% base to main
    baseAoePct: 0.10,  // 10% base AoE
    capMain: 0.75,
    capAoe: 0.30,
    capMainSubsume: 0.50,
    capAoeSubsume: 0.20,
    mainCapStrength: 2.15, // 215% strength to hit 75%
    aoeCapStrength: 3.0    // 300% strength to hit 30%
    },
    reave: {
    label: "(Revenant) Reave Drain",
    tooltip: "Reave drains % of enemy HP as true damage; Thrall increases base to 40% (from 8%).",
    basePct: 0.08,
    enthrallPct: 0.40
    },
    reap_sow: {
    label: "(Sevagoth) Reap / Sow Damage",
    tooltip: "Sevagoth Reap/Sow: 25% HP as true damage to the target plus 25% as Blast per nearby enemy (4m), Blast respects shields and Armor DR; applies Reap vulnerability.",
    basePct: 0.25,
    vulnBasePct: 0.50
    },
    ew_toxin: {
    label: "(Chroma) Elemental Ward (Toxin)",
    tooltip: "Deals 5% of enemy max HP as Toxin damage; scales with Roar, Ability Damage, Toxin shards, viral/status, and vulnerability multipliers. Does not scale with Ability Strength.",
    basePct: 0.05
    },
    regurgitate: {
    label: "(Grendel) Regurgitate",
    tooltip: "Regurgitate: 2000 base Toxin damage * Strength + 10% enemy max HP; scales with Ability Damage, Roar, viral/status, vulnerability multipliers; toxin shards only affect the DoT (disabled if Gastro).",
    baseDamage: 2000
    },
    energy_vampire: {
    label: "(Trinity) Energy Vampire",
    tooltip: "Energy Vampire: deals % of enemy max HP as true damage; scales with Ability Strength, Ability Damage, Roar, viral/status, vulnerabilities, and Marked for Death.",
    basePct: 0.0625
    }
};

function getHealthScalingSpec(key) {
    return healthScalingSpecs[key] || null;
}

const levelScalingSpecs = {
    flechette_orb: {
    base: 300,
    label: "(Vauban) Flechette Orb Damage",
    tooltip: "Flechette Orb: status/crit capable; pulls enemies; scales per level bucket.",
    usesNourish: true,
    usesAbilityDamage: true,
    usesStatus: true,
    levelScale: "per10",
    showVastUntime: false,
    allowVauban: true,
    allowOverdriver: true
    },
    photon_strike: {
    base: 2500,
    label: "(Vauban) Photon Strike Damage",
    tooltip: "Photon Strike tooltip coming soon",
    usesNourish: false,
    usesAbilityDamage: true,
    usesStatus: true,
    levelScale: "per10",
    showVastUntime: false,
    allowVauban: true,
    allowOverdriver: true
    },
    grasp_of_lohk: {
    base: 50,
    label: "(Xaku) Grasp of Lohk Damage",
    tooltip: "Grasp of Lohk tooltip coming soon",
    usesNourish: false,
    usesAbilityDamage: true,
    usesStatus: true,
    levelScale: "perLevel",
    showVastUntime: true,
    allowVauban: false,
    allowOverdriver: false
    },
    feast: {
    base: 500,
    label: "(Grendel) Feast Damage",
    tooltip: "Feast: Base Toxin damage (rank 3) * (1 + Ability Strength-100) * ((Target Level * enemies - 1)/15 + 1); scales with Ability Damage, Roar, viral/status, and vulnerabilities.",
    usesAbilityDamage: true,
    usesStatus: true,
    usesStrength: true,
    usesToxin: false,
    levelScale: "custom",
    showVastUntime: false,
    allowVauban: false,
    allowOverdriver: false
    }
};

function getLevelScalingSpec(key) {
    return levelScalingSpecs[key] || null;
}

function clampArachneRank(raw) {
    const n = Number(raw);
    const safe = Number.isFinite(n) ? n : 0;
    return Math.max(0, Math.min(5, safe));
}

function getArcaneArachnePct(rawRank) {
    return 25 * (clampArachneRank(rawRank) + 1);
}

function feastDamageAtLevel(params, level) {
    const spec = getLevelScalingSpec('feast');
    if (!spec) return 0;
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const base = spec.base * strengthMul;
    const count = Math.max(1, Math.min(5, parseInt(params.feastEnemyCount || '1', 10)));
    const sumTerm = (((level * count) - 1) / 15) + 1;
    const abilityDamageMul = spec.usesAbilityDamage ? (1 + Math.max(0, (params.abilityDamagePct || 0)) / 100) : 1;
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;
    const statusMul = spec.usesStatus ? statusDamageMultiplier(params.statusStacks) : 1;
    return base * sumTerm * abilityDamageMul * roarMul * statusMul;
}

function elementalWardToxinDamageAt(params, level) {
    const spec = getHealthScalingSpec('ew_toxin');
    if (!spec) return 0;
    const { baseLevel, baseHealth, baseShield, faction, enemyType } = params;
    const diffMul = difficultyFactor(params.enemyDifficulty);

    let hp = 0;
    if (enemyType === 'eximus_def') {
    hp = healthEximusDefAt(level, baseLevel, faction, baseHealth);
    } else if (enemyType === 'eximus_nodef') {
    hp = healthEximusNoDefAt(level, baseLevel, faction, baseHealth);
    } else {
    hp = healthAt(level, baseLevel, faction, baseHealth);
    }
    hp *= diffMul;

    const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;
    const statusMul = statusDamageMultiplier(params.statusStacks);

    return spec.basePct * hp * abilityDamageMul * roarMul * statusMul;
}

function levelScalingDamageAtLevel(params, level) {
    const spec = getLevelScalingSpec(params.levelScaling);
    if (params.levelScaling === 'feast') {
    return feastDamageAtLevel(params, level);
    }
    if (!spec) return 0;
    const base = spec.base;
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const lvlMul = spec.levelScale === "perLevel" ? Math.max(1, level) : Math.max(1, Math.ceil(level / 10));
    const abilityDamageMul = spec.usesAbilityDamage ? (1 + Math.max(0, (params.abilityDamagePct || 0)) / 100) : 1;
    const roarBase = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;
    const nourishMul = (spec.usesNourish && params.nourishEnabled) ? (1 + Math.max(0, params.nourishPct || 0) / 100) : 1;
    const statusMul = spec.usesStatus ? statusDamageMultiplier(params.statusStacks) : 1;
    const vaubanMul = (spec.allowVauban && params.vaubanPassive) ? 1.25 : 1;
    const overdriverMul = (spec.allowOverdriver && params.overdriverEnabled)
        ? 1 + 0.25 * Math.max(0, (params.abilityStrengthPct || 0)) / 100
        : 1;
    const isFlechette = params.levelScaling === 'flechette_orb';
    const arachneMul = (isFlechette && params.arachneEnabled)
        ? 1 + getArcaneArachnePct(params.arachneRank) / 100
        : 1;
    const holsterAmpMul = (isFlechette && params.holsterAmpEnabled) ? 1.6 : 1;
    const vigorousSwapMul = (isFlechette && params.vigorousSwapEnabled) ? 2.65 : 1;
    let vastUntimeMul = 1;
    if (spec.showVastUntime) {
    const vastPct = params.untimeRiftEnabled ? 125 : (params.vastUntimeEnabled ? 50 : 0);
    vastUntimeMul = 1 + Math.max(0, vastPct) / 100;
    }
    return base * strengthMul * lvlMul * abilityDamageMul * roarMul * nourishMul * statusMul * vaubanMul * overdriverMul * vastUntimeMul * arachneMul * holsterAmpMul * vigorousSwapMul;
}

function updateLevelScalingUI(params) {
    if (!flechetteDisplayRowEl) return;
    const spec = getLevelScalingSpec(params.levelScaling);
    const isLevelScaling = params.scalingMode === 'level' && !!spec;
    const armorDR = isLevelScaling ? scaledArmorWithStrip(params.targetLevel, params).dr : 0;
    flechetteDisplayRowEl.style.display = isLevelScaling ? '' : 'none';
    if (isLevelScaling && levelScalingLabelEl) {
    levelScalingLabelEl.textContent = spec.label;
    }
    if (isLevelScaling && levelScalingTooltipEl) {
    levelScalingTooltipEl.title = spec.tooltip || '';
    }
    if (isLevelScaling && flechetteDisplayEl) {
    const initialRaw = levelScalingDamageAtLevel(params, params.targetLevel);
    let total = applyArmorDR(initialRaw, armorDR);
    if (params.levelScaling === 'feast') {
        const dot = toxinDotFromInitial(initialRaw, params);
        total += applyArmorDR(dot, armorDR);
    }
    flechetteDisplayEl.textContent = formatStatNumber(total);
    }
    if (isLevelScaling && overdriverDisplayEl) {
    const overdriverPct = 25 * Math.max(0, (params.abilityStrengthPct || 0)) / 100;
    overdriverDisplayEl.textContent = `${overdriverPct.toFixed(0)}%`;
    }
    const arachneRank = clampArachneRank(params.arachneRank);
    const arachnePct = getArcaneArachnePct(params.arachneRank);
    if (arachneDisplayEl) {
    arachneDisplayEl.textContent = `${arachnePct.toFixed(0)}%`;
    }
    if (arachneRankValEl) {
    arachneRankValEl.textContent = `Rank ${arachneRank} (+${arachnePct.toFixed(0)}%)`;
    }
    if (arachneRankEl) {
    arachneRankEl.value = arachneRank;
    }
    // Vauban / Overdriver toggle visibility
    const showVauban = isLevelScaling && spec?.allowVauban;
    const showOverdriver = isLevelScaling && spec?.allowOverdriver;
    const showFeast = isLevelScaling && params.levelScaling === 'feast';
    const showFlechetteExtras = isLevelScaling && params.levelScaling === 'flechette_orb';
    document.querySelectorAll('.vauban-toggle').forEach(el => {
    el.style.display = showVauban ? '' : 'none';
    });
    document.querySelectorAll('.overdriver-toggle').forEach(el => {
    el.style.display = showOverdriver ? '' : 'none';
    });
    document.querySelectorAll('.feast-toggle').forEach(el => {
    el.style.display = showFeast ? '' : 'none';
    });
    document.querySelectorAll('.flechette-extra').forEach(el => {
    el.style.display = showFlechetteExtras ? '' : 'none';
    });
    if (showFeast && trueToxinEnabledEl) {
    trueToxinEnabledEl.checked = true;
    }
    // Grasp of Lohk-specific toggles visibility/value
    const showGraspToggles = isLevelScaling && spec?.showVastUntime;
    document.querySelectorAll('.grasp-toggle').forEach(el => {
    el.style.display = showGraspToggles ? '' : 'none';
    });
    if (showGraspToggles && graspVastUntimeDisplayEl) {
    const vastPct = params.untimeRiftEnabled ? 125 : (params.vastUntimeEnabled ? 50 : 0);
    graspVastUntimeDisplayEl.textContent = `${vastPct.toFixed(0)}%`;
    }
    refreshOpenDropdownHeights();
}

function updateHealthScalingUI(params) {
    if (!healthScalingDisplayRowEl) return;
    const spec = getHealthScalingSpec(params.healthScaling);
    const isHealthScaling = params.scalingMode === 'health' && !!spec;
    const armorDR = isHealthScaling ? scaledArmorWithStrip(params.targetLevel, params).dr : 0;
    if (trueDamageEnabledEl) trueDamageEnabledEl.disabled = false;
    if (trueToxinEnabledEl) trueToxinEnabledEl.disabled = false;
    healthScalingDisplayRowEl.style.display = isHealthScaling ? '' : 'none';
    if (isHealthScaling && healthScalingLabelEl) {
    healthScalingLabelEl.textContent = spec.label;
    }
    if (isHealthScaling && healthScalingTooltipEl) {
    healthScalingTooltipEl.title = spec.tooltip || '';
    }
    // Smite toggles visibility and mutual exclusion already handled; auto-enable true damage / toxin flags
    const showSmite = isHealthScaling && params.healthScaling === 'smite';
    const showReave = isHealthScaling && params.healthScaling === 'reave';
    const showReap = isHealthScaling && params.healthScaling === 'reap_sow';
    const showEwToxin = isHealthScaling && params.healthScaling === 'ew_toxin';
    const showEv = isHealthScaling && params.healthScaling === 'energy_vampire';
    const showRegurgitate = isHealthScaling && params.healthScaling === 'regurgitate';
    const showMfd = isHealthScaling && (params.healthScaling === 'smite' || params.healthScaling === 'energy_vampire');
    document.querySelectorAll('.smite-toggle').forEach(el => {
    el.style.display = showSmite ? '' : 'none';
    });
    document.querySelectorAll('.reave-toggle').forEach(el => {
    el.style.display = showReave ? '' : 'none';
    });
    document.querySelectorAll('.reap-toggle').forEach(el => {
    el.style.display = showReap ? '' : 'none';
    });
    document.querySelectorAll('.regurgitate-toggle').forEach(el => {
    el.style.display = showRegurgitate ? '' : 'none';
    });
    document.querySelectorAll('.mfd-toggle').forEach(el => {
    el.style.display = showMfd ? '' : 'none';
    });
    if (showSmite) {
    // Force exclusivity
    if (smiteSingleEnabledEl?.checked && smiteAoEEnabledEl) smiteAoEEnabledEl.checked = false;
    if (smiteAoEEnabledEl?.checked && smiteSingleEnabledEl) smiteSingleEnabledEl.checked = false;
    if (smiteAoEEnabledEl?.checked && smiteMfdEl) smiteMfdEl.checked = false;
    // Auto flags in Warframe Stats
    if (trueDamageEnabledEl) trueDamageEnabledEl.checked = !!smiteSingleEnabledEl?.checked;
    if (trueToxinEnabledEl) trueToxinEnabledEl.checked = !!smiteAoEEnabledEl?.checked;
    const capMain = params.smiteSubsumeEnabled ? spec.capMainSubsume : spec.capMain;
    const capAoe = params.smiteSubsumeEnabled ? spec.capAoeSubsume : spec.capAoe;
    const mainPct = smiteSingleEnabledEl?.checked
        ? Math.min(capMain || 1, spec.baseMainPct * Math.max(0, (params.abilityStrengthPct || 0) / 100))
        : 0;
    const aoePct = smiteAoEEnabledEl?.checked
        ? Math.min(capAoe || 1, spec.baseAoePct * Math.max(0, (params.abilityStrengthPct || 0) / 100))
        : 0;
    const pctStr = [];
    if (mainPct > 0) pctStr.push(`ST ${(mainPct * 100).toFixed(1)}%`);
    if (aoePct > 0) pctStr.push(`AoE ${(aoePct * 100).toFixed(1)}%`);
    if (healthScalingDisplayEl) healthScalingDisplayEl.textContent = pctStr.join(' / ') || '-';
    if (smiteMfdDisplayEl) {
        const mfd = (smiteSingleEnabledEl?.checked && smiteMfdEl?.checked)
            ? getMfdBonus(params.abilityStrengthPct || 0)
            : { markPct: 0 };
        smiteMfdDisplayEl.textContent = `${(mfd.markPct * 100 || 0).toFixed(0)}%`;
    }
    } else if (showReave) {
    if (trueDamageEnabledEl) trueDamageEnabledEl.checked = true;
    const reave = reaveDamageAtLevel(params, params.targetLevel, params.baseHealth, params.faction);
    if (healthScalingDisplayEl) healthScalingDisplayEl.textContent = `Drain ${(reave.pct * 100).toFixed(1)}%`;
    } else if (showReap) {
    if (trueDamageEnabledEl) trueDamageEnabledEl.checked = true;
    const strengthMul = Math.max(0, (params.abilityStrengthPct || 0) / 100);
    const basePct = (spec.basePct || 0); // fixed 25%
    const vulnPct = (spec.vulnBasePct || 0) * strengthMul;
    const hits = Math.max(0, Math.min(99, (params.reapEnemyCount || 1) - 1));
    const pctStr = `True ${(basePct * 100).toFixed(1)}% + Blast ${(basePct * 100).toFixed(1)}% x${hits}`;
        const vulnStr = `Vuln ${(vulnPct * 100).toFixed(1)}%`;
    if (healthScalingDisplayEl) healthScalingDisplayEl.textContent = `${pctStr} (${vulnStr})`;
    } else if (showEwToxin) {
    if (healthScalingDisplayEl) healthScalingDisplayEl.textContent = `5% HP (Toxin)`;
    if (trueDamageEnabledEl) trueDamageEnabledEl.checked = false;
    if (trueToxinEnabledEl) trueToxinEnabledEl.checked = true;
    } else if (showEv) {
    if (trueDamageEnabledEl) {
        trueDamageEnabledEl.checked = true;
        trueDamageEnabledEl.disabled = true;
    }
    if (trueToxinEnabledEl) trueToxinEnabledEl.checked = false;
    const ev = energyVampireDamageAt(params, params.targetLevel, params.baseHealth, params.faction);
    if (healthScalingDisplayEl) healthScalingDisplayEl.textContent = `Drain ${(ev.pct * 100).toFixed(2)}%`;
    if (smiteMfdDisplayEl) smiteMfdDisplayEl.textContent = `${(ev.mfdPct || 0).toFixed(0)}%`;
    } else if (showRegurgitate) {
    if (trueDamageEnabledEl) trueDamageEnabledEl.checked = false;
    if (trueToxinEnabledEl) trueToxinEnabledEl.checked = !regurgitateGastroEnabledEl?.checked;
    const reg = regurgitateDamageAt(params);
    const regInitial = reg.val;
    const regFinal = applyArmorDR(regInitial, armorDR);
    const regDot = toxinDotFromInitial(regInitial, params, { toxinEnabled: !regurgitateGastroEnabledEl?.checked });
    const regTotal = regFinal + applyArmorDR(regDot, armorDR);
    if (healthScalingDisplayEl) healthScalingDisplayEl.textContent = `${formatStatNumber(regTotal)} dmg (incl DoT)`;
    } else if (healthScalingDisplayEl) {
    healthScalingDisplayEl.textContent = '-';
    }
    if (!isHealthScaling) {
    if (trueDamageEnabledEl) trueDamageEnabledEl.checked = false;
    if (trueDamageEnabledEl) trueDamageEnabledEl.disabled = false;
    if (trueToxinEnabledEl) trueToxinEnabledEl.checked = false;
    }
    refreshOpenDropdownHeights();
}

function scalingDamageSample(params, lvl, { vulnMul = null, scalingMul = null } = {}) {
    const effectiveVuln = vulnMul == null ? vulnerabilityMultiplier(params) : vulnMul;
    const effectiveScalingMul = scalingMul == null ? scalingMultiplierFromParams(params, { useNourish: true }) : scalingMul;
    const armorDR = scaledArmorWithStrip(lvl, params).dr;

    if (params.scalingMode === 'level') {
    const spec = getLevelScalingSpec(params.levelScaling);
    if (!spec) return 0;
    const scaledRaw = levelScalingDamageAtLevel(params, lvl) * effectiveVuln;
    let total = applyArmorDR(scaledRaw, armorDR);
    if (params.levelScaling === 'feast') {
        const dot = toxinDotFromInitial(scaledRaw, params);
        total += applyArmorDR(dot, armorDR);
    }
    return total;
    }
    if (params.scalingMode === 'health') {
    if (params.healthScaling === 'smite') {
        const smite = smiteDamageAtLevel(params, lvl, params.baseHealth, params.baseShield, params.faction);
        const mainVal = smite.main * effectiveVuln;
        const aoeVal = applyArmorDR(smite.aoe * effectiveVuln, armorDR);
        return mainVal + aoeVal;
    } else if (params.healthScaling === 'reave') {
        const reave = reaveDamageAtLevel(params, lvl, params.baseHealth, params.faction);
        return reave.val * effectiveVuln;
    } else if (params.healthScaling === 'reap_sow') {
        const reap = reapSowDamageAtLevel(params, lvl, params.baseHealth, params.baseShield, params.faction, { globalVuln: effectiveVuln });
        return reap.total;
    } else if (params.healthScaling === 'ew_toxin') {
        const ew = elementalWardToxinDamageAt(params, lvl);
    const initialRaw = ew * effectiveVuln;
    const initialFinal = applyArmorDR(initialRaw, armorDR);
    const dot = toxinDotFromInitial(initialRaw, params);
    return initialFinal + applyArmorDR(dot, armorDR);
    } else if (params.healthScaling === 'energy_vampire') {
        const ev = energyVampireDamageAt(params, lvl, params.baseHealth, params.faction);
        return ev.val * effectiveVuln;
    } else if (params.healthScaling === 'regurgitate') {
        const reg = regurgitateDamageAt(params);
    const initialRaw = reg.val * effectiveVuln;
    const initialFinal = applyArmorDR(initialRaw, armorDR);
    const dot = toxinDotFromInitial(initialRaw, params, { toxinEnabled: !params.regurgitateGastroEnabled });
        return initialFinal + applyArmorDR(dot, armorDR);
    }
    return 0;
    }
    if (params.scalingMode === 'reflective') {
    if (params.reflectiveAbility === 'accuse' && params.baseDamage > 0) {
        const dm = damageMultiplier(lvl, params.baseLevel, params.faction);
        const roarBase = params.roarSubsume ? 0.3 : 0.5;
        const roarStrength = getRoarStrengthPct(params);
        const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;
        const nourishMul = (params.nourishEnabled && params.reflectiveAbility !== 'damage_decoy')
            ? (1 + Math.max(0, params.nourishPct || 0) / 100)
            : 1;
        const statusMul = statusDamageMultiplier(params.statusStacks);
        // Radiation multiplier included via vulnerability multiplier already
        return params.baseDamage * dm * statusMul * roarMul * nourishMul * effectiveVuln;
    }
    if (params.reflectiveAbility === 'absorb' && params.baseDamage > 0) {
        const dm = damageMultiplier(lvl, params.baseLevel, params.faction);
        const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
        const roarBase = params.roarSubsume ? 0.3 : 0.5;
        const roarStrength = getRoarStrengthPct(params);
        const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;
        const statusMul = statusDamageMultiplier(params.statusStacks);
        return params.baseDamage * dm * statusMul * abilityDamageMul * roarMul * effectiveVuln;
    }
    if (params.reflectiveAbility === 'iron_skin') {
        if (!params.ironShrapnelEnabled) return 0;
        const { dmg: ironSkinDmg } = ironSkinDetonationDamage(params, lvl, { vulnMul: effectiveVuln });
        return ironSkinDmg;
    }
    if (hasReflectiveSelection(params) && params.baseDamage > 0) {
        const dm = damageMultiplier(lvl, params.baseLevel, params.faction) * effectiveScalingMul;
        return params.baseDamage * dm;
    }
    return 0;
    }
    if (params.baseDamage > 0) {
    const dm = damageMultiplier(lvl, params.baseLevel, params.faction) * effectiveScalingMul;
    return params.baseDamage * dm;
    }
    return 0;
}

// ---------- Input wiring: armor strip + multipliers ----------

// Heat Armor Strip
heatEnabledEl.addEventListener("change", () => {
    scheduleHandleChange('change');
});

// Status slider label
statusStacksEl.addEventListener("input", () => {
    statusStacksVal.textContent = statusStacksEl.value;
    scheduleHandleChange('input');
});
if (radiationStacksEl) {
    radiationStacksEl.addEventListener("input", () => {
    if (radiationStacksVal) radiationStacksVal.textContent = radiationStacksEl.value;
    scheduleHandleChange('input');
    });
    radiationStacksEl.addEventListener("change", () => scheduleHandleChange('change'));
}
if (xAxisFromEl) {
    xAxisFromEl.addEventListener("input", () => scheduleHandleChange('input'));
    xAxisFromEl.addEventListener("change", () => scheduleHandleChange('change'));
}
if (xAxisToEl) {
    xAxisToEl.addEventListener("input", () => scheduleHandleChange('input'));
    xAxisToEl.addEventListener("change", () => scheduleHandleChange('change'));
}
if (yAxisMaxEl) {
    yAxisMaxEl.addEventListener("input", () => scheduleHandleChange('input'));
    yAxisMaxEl.addEventListener("change", () => scheduleHandleChange('change'));
}

if (abilityStrengthEl) {
    abilityStrengthEl.addEventListener('input', () => scheduleHandleChange('input'));
    abilityStrengthEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (abilityDamageEl) {
    abilityDamageEl.addEventListener('input', () => scheduleHandleChange('input'));
    abilityDamageEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (toxinDamageEl) {
    toxinDamageEl.addEventListener('input', () => scheduleHandleChange('input'));
    toxinDamageEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (ironShrapnelEnabledEl) {
    ironShrapnelEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (regurgitateGastroEnabledEl) {
    regurgitateGastroEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (destructRankEl) {
    const syncDestructDisplay = () => {
    const pct = getDestructPct(Math.max(0, Math.min(5, parseInt(destructRankEl.value || '0', 10))));
    const stacksVal = Math.max(0, parseInt(destructStacksEl?.value || '0', 10));
    const rankVal = Math.max(0, Math.min(5, parseInt(destructRankEl.value || '0', 10)));
    if (destructRankDisplayEl) destructRankDisplayEl.textContent = `Rank ${rankVal} • ${pct}% • x${stacksVal}`;
    };
    destructRankEl.addEventListener('input', () => { syncDestructDisplay(); scheduleHandleChange('input'); });
    destructRankEl.addEventListener('change', () => { syncDestructDisplay(); scheduleHandleChange('change'); });
    // Run once to initialize display
    syncDestructDisplay();
}
if (destructStacksEl) {
    const syncDestructDisplay = () => {
    const pct = getDestructPct(Math.max(0, Math.min(5, parseInt(destructRankEl?.value || '0', 10))));
    const stacksVal = Math.max(0, parseInt(destructStacksEl.value || '0', 10));
    const rankVal = Math.max(0, Math.min(5, parseInt(destructRankEl?.value || '0', 10)));
    if (destructRankDisplayEl) destructRankDisplayEl.textContent = `Rank ${rankVal} • ${pct}% • x${stacksVal}`;
    };
    destructStacksEl.addEventListener('input', () => { syncDestructDisplay(); scheduleHandleChange('input'); });
    destructStacksEl.addEventListener('change', () => { syncDestructDisplay(); scheduleHandleChange('change'); });
}
if (wfBaseArmorEl) {
    wfBaseArmorEl.addEventListener('input', () => scheduleHandleChange('input'));
    wfBaseArmorEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (wfArmorIncreaseEl) {
    wfArmorIncreaseEl.addEventListener('input', () => scheduleHandleChange('input'));
    wfArmorIncreaseEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (wfArmorAddedEl) {
    wfArmorAddedEl.addEventListener('input', () => scheduleHandleChange('input'));
    wfArmorAddedEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (wfBaseArmorEl) {
    wfBaseArmorEl.addEventListener('input', () => scheduleHandleChange('input'));
    wfBaseArmorEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (wfArmorIncreaseEl) {
    wfArmorIncreaseEl.addEventListener('input', () => scheduleHandleChange('input'));
    wfArmorIncreaseEl.addEventListener('change', () => scheduleHandleChange('change'));
}
if (vaubanPassiveEl) vaubanPassiveEl.addEventListener('change', () => scheduleHandleChange('change'));
if (overdriverEnabledEl) overdriverEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (arachneEnabledEl) arachneEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (holsterAmpEnabledEl) holsterAmpEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (vigorousSwapEnabledEl) vigorousSwapEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (graspVastUntimeEl) graspVastUntimeEl.addEventListener('change', () => scheduleHandleChange('change'));
if (graspUntimeRiftEl) graspUntimeRiftEl.addEventListener('change', () => {
    if (graspUntimeRiftEl.checked && graspVastUntimeEl) graspVastUntimeEl.checked = true;
    scheduleHandleChange('change');
});
if (healthScalingSelectEl) {
    healthScalingSelectEl.addEventListener('change', () => {
    if (scalingModeHealthEl) scalingModeHealthEl.checked = true;
    const params = readParams();
    updateHealthScalingUI(params);
    scheduleHandleChange('change');
    });
}
if (smiteSingleEnabledEl) {
    smiteSingleEnabledEl.addEventListener('change', () => {
    if (smiteSingleEnabledEl.checked && smiteAoEEnabledEl) smiteAoEEnabledEl.checked = false;
    if (smiteMfdEl) smiteMfdEl.disabled = !smiteSingleEnabledEl.checked;
    const params = readParams();
    updateHealthScalingUI(params);
    scheduleHandleChange('change');
    });
}
if (smiteAoEEnabledEl) {
    smiteAoEEnabledEl.addEventListener('change', () => {
    if (smiteAoEEnabledEl.checked && smiteSingleEnabledEl) smiteSingleEnabledEl.checked = false;
    if (smiteAoEEnabledEl.checked && smiteMfdEl) smiteMfdEl.checked = false;
    if (smiteMfdEl) smiteMfdEl.disabled = smiteAoEEnabledEl.checked;
    const params = readParams();
    updateHealthScalingUI(params);
    scheduleHandleChange('change');
    });
}
if (smiteSubsumeEnabledEl) {
    smiteSubsumeEnabledEl.addEventListener('change', () => {
    const params = readParams();
    updateHealthScalingUI(params);
    scheduleHandleChange('change');
    });
}
if (smiteMfdEl) {
    smiteMfdEl.addEventListener('change', () => {
    const params = readParams();
    updateHealthScalingUI(params);
    scheduleHandleChange('change');
    });
}
if (reapEnemyCountEl) {
    const clampReapCount = () => {
    const raw = parseInt(reapEnemyCountEl.value || '1', 10);
    const clamped = Math.max(1, Math.min(20, isFinite(raw) ? raw : 1));
    reapEnemyCountEl.value = clamped;
    return clamped;
    };
    reapEnemyCountEl.addEventListener('input', () => {
    clampReapCount();
    scheduleHandleChange('input');
    });
    reapEnemyCountEl.addEventListener('change', () => {
    clampReapCount();
    scheduleHandleChange('change');
    });
}
if (reaveEnthrallEl) {
    reaveEnthrallEl.addEventListener('change', () => {
    const params = readParams();
    updateHealthScalingUI(params);
    scheduleHandleChange('change');
    });
}

if (roarEnabledEl) roarEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (roarSubsumeEl) roarSubsumeEl.addEventListener('change', () => scheduleHandleChange('change'));
if (roarPrecisionIntensifyEl) roarPrecisionIntensifyEl.addEventListener('change', () => scheduleHandleChange('change'));
if (trueDamageEnabledEl) trueDamageEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (trueToxinEnabledEl) trueToxinEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (nourishEnabledEl) nourishEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (nourishSubsumeEl) nourishSubsumeEl.addEventListener('change', () => scheduleHandleChange('change'));
if (nourishPrecisionIntensifyEl) nourishPrecisionIntensifyEl.addEventListener('change', () => scheduleHandleChange('change'));
if (coldWardEnabledEl) coldWardEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (atlasPetrifyEnabledEl) atlasPetrifyEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (calibanWrathEnabledEl) calibanWrathEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (equinoxRageEnabledEl) equinoxRageEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (garaMassEnabledEl) garaMassEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (garaSplinterEnabledEl) garaSplinterEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (jadeJudgementsEnabledEl) jadeJudgementsEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (khoraDomeEnabledEl) khoraDomeEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (nezhaChakramEnabledEl) nezhaChakramEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (novaPrimeEnabledEl) novaPrimeEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (oraxiaEmbraceEnabledEl) oraxiaEmbraceEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (qorvexWallEnabledEl) qorvexWallEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (yareliSeaEnabledEl) yareliSeaEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (yareliMerulinaEnabledEl) yareliMerulinaEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));
if (malletEnabledEl) malletEnabledEl.addEventListener('change', () => scheduleHandleChange('change'));

[scalingModeReflectiveEl, scalingModeLevelEl, scalingModeHealthEl].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => {
    updateMindControlEnabledState();
    updateRadiationEnabledState();
    if (getScalingMode() === 'reflective') enforceReflectiveExclusive();
    const params = readParams();
    if (getScalingMode() === 'health') {
        updateHealthScalingUI(params);
    } else if (getScalingMode() === 'level') {
        updateLevelScalingUI(params);
    }
    scheduleHandleChange('change');
    });
});

function syncFactionStickyFromMain() {
    if (factionSticky && factionEl) factionSticky.value = factionEl.value;
}

function isTransparentBg() {
    return !!(transparentBgToggleEl && transparentBgToggleEl.checked);
}

function getExportScale() {
    const fromSelect = exportDpiScaleEl ? parseFloat(exportDpiScaleEl.value || '1') : NaN;
    if (!Number.isNaN(fromSelect) && fromSelect > 0) return fromSelect;
    return 1;
}

function applyTransparentBgClass() {
    document.body.classList.toggle('transparent-plot', isTransparentBg());
}

function buildLegendEntries(series, params) {
    const legend = [];
    const addLine = (label, color, dash=null) => legend.push({ label, color, dash });

    if (!series) return legend;

    if (series.comparison) {
    addLine(`Metric: ${metricLabels[series.metric] || series.metric}`, '#e5e7eb');
    series.factions.forEach(fc => {
        // Strip metric prefix like "Health -", "Shield -", "Enemy Damage -", "EHP -"
        const cleaned = (fc.label || '').replace(/^(Health|Shield|Enemy Damage|EHP)\s+-\s+/i, '');
        addLine(cleaned || fc.label || fc.faction, fc.color, fc.dash);
    });
    return legend;
    }

    const hasShield = series.hasShield;
    const factionLabel = (() => {
    const f = (params?.faction || '').toLowerCase();
    if (f === 'grineer') return 'Grineer / Scaldra';
    if (f === 'corpus') return 'Corpus';
    if (f === 'infested') return 'Infested';
    if (f === 'corrupted') return 'Corrupted';
    if (f === 'techrot') return 'Techrot';
    if (f === 'murmur' || f === 'sentient' || f === 'unaffiliated') return 'Murmur / Sentient / Unaffiliated';
    return 'Unknown';
    })();

    addLine(`Faction: ${factionLabel}`, '#e5e7eb');

    if (series.base?.enabled) {
    addLine('Base Health', '#ef4444');
    if (hasShield) addLine('Base Shield', '#06b6d4');
    }
    if (series.exDef?.enabled) {
    addLine('Eximus (+Defenses) Health', '#ef4444', [10,6]);
    if (hasShield) addLine('Eximus (+Defenses) Shield', '#06b6d4', [10,6]);
    }
    if (series.exNoDef?.enabled) addLine('Eximus (-Defenses) Health', '#ef4444', [2,8]);
    if (series.ogEnabled) addLine('Overguard', OVERGUARD_COLOR, [10,6]);
    if (series.damage?.enabled) addLine('Enemy Damage', DAMAGE_COLOR);
    if (series.scaling?.enabled) addLine('Scaling Damage', SCALING_DAMAGE_COLOR);
    if (series.ehp?.enabled) addLine('EHP', EHP_COLOR, [4,6]);
    return legend;
}

function layoutLegendEntries(legend, w, legendPad=12, entryHeight=18, rowGap=6, colGap=24) {
    const positions = [];
    if (!legend || !legend.length) return { positions, legendHeight: 0, legendPad, entryHeight };
    // Use a temp canvas to measure text
    const temp = document.createElement('canvas');
    const tctx = temp.getContext('2d');
    tctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto';
    const maxW = w - legendPad * 2;
    let x = legendPad;
    let y = legendPad;
    legend.forEach(entry => {
    const textW = tctx.measureText(entry.label).width;
    const entryW = 52 + textW;
    if (x > legendPad && x + entryW > maxW) {
        x = legendPad;
        y += entryHeight + rowGap;
    }
    positions.push({ entry, x, y });
    x += entryW + colGap;
    });
    const legendHeight = legend.length > 0 ? y + entryHeight + legendPad : 0;
    return { positions, legendHeight, legendPad, entryHeight };
}

function paintLegend(ctx, legend, layout, { withBackground=true } = {}) {
    if (!legend || !legend.length || !layout) return;
    const { positions, legendHeight, legendPad, entryHeight } = layout;
    if (legendHeight <= 0) return;

    const w = ctx.canvas.width;
    ctx.save();

    if (withBackground) {
    const radius = 10;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(15,23,42,0.9)';
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(w - radius, 0);
    ctx.quadraticCurveTo(w, 0, w, radius);
    ctx.lineTo(w, legendHeight - radius);
    ctx.quadraticCurveTo(w, legendHeight, w - radius, legendHeight);
    ctx.lineTo(radius, legendHeight);
    ctx.quadraticCurveTo(0, legendHeight, 0, legendHeight - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    }

    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillStyle = '#e5e7eb';
    positions.forEach(pos => {
    const { entry } = pos;
    const yPos = pos.y + 4;
    ctx.save();
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = 3;
    ctx.setLineDash(entry.dash || []);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y + entryHeight / 2);
    ctx.lineTo(pos.x + 34, pos.y + entryHeight / 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(entry.label, pos.x + 40, yPos + entryHeight / 2);
    });
    ctx.restore();
}

function exportPlot({ withBackground }) {
    if (!canvas) return;
    const prevDims = exportDimensions;
    const baseRect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const scale = getExportScale();
    const targetWidth = Math.max(1, Math.round(baseRect.width * dpr * scale));
    const targetHeight = Math.max(1, Math.round(baseRect.height * dpr * scale));
    exportDimensions = { width: targetWidth, height: targetHeight };
    fitCanvas();

    const wantsTransparent = isTransparentBg();
    const effectiveBackground = (withBackground !== undefined) ? withBackground : !wantsTransparent;
    const params = readParams();
    const toggles = readToggles();
    const presetCompareOn = !!(abCompareToggle && abCompareToggle.checked && hasBothPresets());
    const factionCompareOn = !!(compareModeEl && compareModeEl.checked);
    // Ensure latest draw
    if (presetCompareOn) {
        currentBlend = buildPresetComparisonSeries(params, { trackMaxY: false });
    } else if (factionCompareOn) {
        currentBlend = buildComparisonSeries(params);
    } else {
        currentBlend = currentBlend || buildAllSeries(params, toggles);
    }
    drawImmediate(currentBlend, currentMixE || 1);

    const ratio = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    const series = currentBlend
        || (presetCompareOn ? buildPresetComparisonSeries(params, { trackMaxY: false })
            : (factionCompareOn ? buildComparisonSeries(params) : buildAllSeries(params, toggles)));
    const legend = buildLegendEntries(series, params);
    const legendLayout = layoutLegendEntries(legend, w);

    const temp = document.createElement('canvas');
    const tctx = temp.getContext('2d');
    temp.width = w;
    temp.height = h + legendLayout.legendHeight;

    if (effectiveBackground) {
    const bg = getComputedStyle(document.body).backgroundColor || '#0b1222';
    tctx.fillStyle = bg;
    tctx.fillRect(0, 0, temp.width, temp.height);
    }

    if (legendLayout.legendHeight > 0) {
    paintLegend(tctx, legend, legendLayout, { withBackground: effectiveBackground });
    }

    // Plot image below legend
    tctx.drawImage(canvas, 0, legendLayout.legendHeight);

    try {
    const link = document.createElement('a');
    link.download = effectiveBackground ? 'warframe_plot_bg.png' : 'warframe_plot_transparent.png';
    link.href = temp.toDataURL('image/png');
    link.click();
    } finally {
    exportDimensions = prevDims;
    fitCanvas();
    if (currentBlend) {
        drawImmediate(currentBlend, currentMixE || 1);
    }
    }
}

async function exportPlotMp4Video() {
    if (!canvas || !canvas.captureStream || typeof MediaRecorder === 'undefined') {
    alert('Video export is not supported in this browser.');
    return;
    }

    const qualityPresets = {
    '2k60':    { width: 2560, fps: 60, bitrate: 12000000 },
    '1080p60': { width: 1920, fps: 60, bitrate: 9000000 },
    '1080p30': { width: 1920, fps: 30, bitrate: 6000000 }
    };
    const qualityKey = (exportMp4QualityEl && exportMp4QualityEl.value) || '2k60';
    const preset = qualityPresets[qualityKey] || qualityPresets['2k60'];
    const scale = getExportScale();
    const transparent = isTransparentBg();

    const mimeCandidates = transparent
    ? [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ]
    : [
        'video/mp4;codecs=h264',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
    const mimeType = mimeCandidates.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
    alert('No supported video format (MP4/WebM) is available in this browser.');
    return;
    }

    const params = readParams();
    const toggles = readToggles();
    const presetCompareOn = !!(abCompareToggle && abCompareToggle.checked && hasBothPresets());
    const compareOn = !!(compareModeEl && compareModeEl.checked);
    const bgColor = transparent ? null : (getComputedStyle(document.body).backgroundColor || '#0b1222');
    const targetSeries = presetCompareOn
        ? buildPresetComparisonSeries(params, { trackMaxY: false })
        : (compareOn ? buildComparisonSeries(params) : buildAllSeries(params, toggles));

    const aspect = canvas.clientWidth > 0 ? (canvas.clientHeight / canvas.clientWidth) : 0.5625;
    const targetWidth = Math.max(1, Math.round(preset.width * scale));
    let targetHeight = Math.max(1, Math.round(targetWidth * aspect));
    // H.264 prefers even dimensions
    if (targetHeight % 2 !== 0) targetHeight += 1;
    const transparentBoost = transparent ? 1.6 : 1;
    const bitrateBase = preset.bitrate * transparentBoost;
    const bitrate = Math.max(preset.bitrate, Math.round(bitrateBase * scale * scale));
    const legendEntries = buildLegendEntries(targetSeries, params);
    const legendLayout = layoutLegendEntries(legendEntries, targetWidth);
    const totalHeight = targetHeight + (legendLayout.legendHeight || 0);

    const prevDims = exportDimensions;
    const prevRecordingActive = recordingActive;
    const prevRecordingFill = recordingFillColor;

    exportDimensions = { width: targetWidth, height: totalHeight };
    recordingFillColor = bgColor;
    recordingActive = true;
    recordingIncludeLegend = true;
    recordingLegendEntries = legendEntries;
    recordingLegendLayout = legendLayout;
    fitCanvas();

    const stream = canvas.captureStream(preset.fps);
    const options = { mimeType, videoBitsPerSecond: bitrate };
    let recorder;
    try {
    recorder = new MediaRecorder(stream, options);
    } catch (err) {
    console.error(err);
    alert('Failed to start recording: ' + err.message);
    exportDimensions = prevDims;
    recordingFillColor = prevRecordingFill;
    recordingActive = prevRecordingActive;
    recordingIncludeLegend = false;
    recordingLegendEntries = null;
    recordingLegendLayout = null;
    fitCanvas();
    drawImmediate(currentBlend, currentMixE || 1);
    return;
    }

    const chunks = [];
    const stopPromise = new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => resolve();
    recorder.onerror = (evt) => reject(evt.error || new Error('Recording failed'));
    });

    const animDuration = 1400;
    const buffer = 500;
    try {
    if (exportPlotMp4Btn) exportPlotMp4Btn.disabled = true;
    recorder.start();
    animateTo(params, toggles, animDuration, { unfold: true }, targetSeries);
    setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
    }, animDuration + buffer);

    await stopPromise;

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `warframe_plot_${qualityKey}.${ext}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
    console.error(err);
    alert('Failed to export video: ' + err.message);
    } finally {
    exportDimensions = prevDims;
    recordingFillColor = prevRecordingFill;
    recordingActive = prevRecordingActive;
    recordingIncludeLegend = false;
    recordingLegendEntries = null;
    recordingLegendLayout = null;
    fitCanvas();
    const blend = currentBlend || targetSeries;
    if (blend) drawImmediate(blend, currentMixE || 1);
    if (exportPlotMp4Btn) exportPlotMp4Btn.disabled = false;
    }
}

if (transparentBgToggleEl) {
    applyTransparentBgClass();
    transparentBgToggleEl.addEventListener('change', applyTransparentBgClass);
}
if (exportPlotPngBtn) {
    exportPlotPngBtn.addEventListener('click', () => exportPlot({}));
}
if (exportPlotMp4Btn) {
    exportPlotMp4Btn.addEventListener('click', () => exportPlotMp4Video());
}
if (compareModeEl) {
    compareModeEl.addEventListener('change', () => {
    if (abCompareToggle && compareModeEl.checked) {
        abCompareToggle.checked = false;
    }
    scheduleHandleChange('change');
    });
}
if (compareMetricEl) {
    compareMetricEl.addEventListener('change', () => {
    scheduleHandleChange('change');
    });
}
[compareShowBaseEl, compareShowExDefEl, compareShowExNoDefEl].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => scheduleHandleChange('change'));
});
getCompareChips().forEach(chip => {
    chip.addEventListener('click', () => {
    toggleCompareChip(chip);
    scheduleHandleChange('change');
    });
});
colorCompareChips();

colorCompareChips();

if (abSaveA) abSaveA.addEventListener('click', () => savePresetSlot('A'));
if (abSaveB) abSaveB.addEventListener('click', () => savePresetSlot('B'));
if (abLoadA) abLoadA.addEventListener('click', () => applyPresetSlot('A'));
if (abLoadB) abLoadB.addEventListener('click', () => applyPresetSlot('B'));
if (abClearA) abClearA.addEventListener('click', () => clearPresetSlot('A'));
if (abClearB) abClearB.addEventListener('click', () => clearPresetSlot('B'));
if (abCopyAToB) abCopyAToB.addEventListener('click', () => copyPreset('A', 'B'));
if (abCopyBToA) abCopyBToA.addEventListener('click', () => copyPreset('B', 'A'));
if (abSwapPresets) abSwapPresets.addEventListener('click', () => swapPresets());
if (abResetPresets) abResetPresets.addEventListener('click', () => {
    if (!confirm('Reset all presets A and B?')) return;
    resetAllPresets();
});
if (abCompareToggle) {
    abCompareToggle.addEventListener('change', () => {
    if (abCompareToggle.checked && !hasBothPresets()) {
        abCompareToggle.checked = false;
        setAbToast('Save presets A and B first');
        return;
    }
    if (compareModeEl && abCompareToggle.checked) {
        compareModeEl.checked = false;
    }
    // Default comparison metric to Scaling Damage when entering A/B compare
    if (abCompareToggle.checked && compareMetricEl) {
        compareMetricEl.value = 'scaling';
    }
    scheduleHandleChange('change');
    });
}
let abPanelCollapsed = false;
function setAbPanelCollapsed(on) {
    if (!abPanelEl) return;
    if (abPanelCollapsed === on) return;
    abPanelCollapsed = !!on;
    abPanelEl.classList.toggle('ab-panel-collapsed', abPanelCollapsed);
}
const AB_TOP_MARGIN_PX = 200;
if (abPanelEl) {
    setAbPanelCollapsed(false);
}

// Enforce mutual exclusivity between reflective ability toggles
function enforceReflectiveExclusive(triggerEl = null) {
    const toggles = [mindControlEnabledEl, nekrosEnabledEl, damageDecoyEnabledEl, malletEnabledEl, accuseEnabledEl, coldWardEnabledEl, linkEnabledEl, reverseRotorEnabledEl, mesmerSkinEnabledEl, thornsEnabledEl, shatterShieldEnabledEl, absorbEnabledEl].filter(Boolean);
    // Prefer the one the user just interacted with; otherwise keep the first checked.
    const primary = (triggerEl && triggerEl.checked) ? triggerEl : toggles.find(el => el.checked);
    if (!primary) return false;

    let changed = false;
    toggles.forEach(el => {
        if (el !== primary && el.checked) {
            el.checked = false;
            changed = true;
        }
    });
    // Ensure dependent UI (e.g., mind control sliders) reflects the new state immediately
    updateMindControlEnabledState();
    return changed;
}

// Nyx Mind Control toggle removed; always on when selected via dropdown

// Nekros, Shadows of the Dead enabled toggle
function updateNekrosEnabledState() {
    // Derived from Ability Strength; no direct inputs to disable.
}
nekrosEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(nekrosEnabledEl);
    scheduleHandleChange('change');
});

// Summoner's Wrath enabled toggle
function updateSummWrathEnabledState() {
    const on = summWrathEnabledEl.checked;
    summWrathEl.disabled = !on;
    summWrathRangeEl.disabled = !on;
}

summWrathEnabledEl.addEventListener('change', () => {
    updateSummWrathEnabledState();
    scheduleHandleChange('change');
});

// Damage Decoy enabled toggle
function updateDamageDecoyEnabledState() {
    // Derived from Ability Strength; no direct inputs to disable.
}
damageDecoyEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(damageDecoyEnabledEl);
    scheduleHandleChange('change');
});

// Radiation status slider: enable only in reflective mode
function updateRadiationEnabledState() {
    const reflective = getScalingMode() === 'reflective';
    if (radiationStacksEl) radiationStacksEl.disabled = !reflective;
}

// Elemental Ward (Cold) toggle
if (coldWardEnabledEl) {
    coldWardEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(coldWardEnabledEl);
    if (reflectiveSelectEl) reflectiveSelectEl.value = 'cold_ward';
    scheduleHandleChange('change');
    });
}

// Link toggle
if (linkEnabledEl) {
    linkEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(linkEnabledEl);
    if (reflectiveSelectEl) reflectiveSelectEl.value = 'link';
    scheduleHandleChange('change');
    });
}

// Reverse Rotorswell toggle
if (reverseRotorEnabledEl) {
    reverseRotorEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(reverseRotorEnabledEl);
    if (reflectiveSelectEl) reflectiveSelectEl.value = 'reverse_rotor';
    scheduleHandleChange('change');
    });
}

// Mesmer Skin toggle
if (mesmerSkinEnabledEl) {
    mesmerSkinEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(mesmerSkinEnabledEl);
    if (reflectiveSelectEl) reflectiveSelectEl.value = 'mesmer_skin';
    scheduleHandleChange('change');
    });
}

// Thorns toggle
if (thornsEnabledEl) {
    thornsEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(thornsEnabledEl);
    if (reflectiveSelectEl) reflectiveSelectEl.value = 'thorns';
    scheduleHandleChange('change');
    });
}

// Shatter Shield toggle
if (shatterShieldEnabledEl) {
    shatterShieldEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(shatterShieldEnabledEl);
    if (reflectiveSelectEl) reflectiveSelectEl.value = 'shatter_shield';
    scheduleHandleChange('change');
    });
}

// Absorb toggle
if (absorbEnabledEl) {
    absorbEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(absorbEnabledEl);
    if (reflectiveSelectEl) reflectiveSelectEl.value = 'absorb';
    scheduleHandleChange('change');
    });
}

// Accuse toggle
if (accuseEnabledEl) {
    accuseEnabledEl.addEventListener('change', () => {
    enforceReflectiveExclusive(accuseEnabledEl);
    if (reflectiveSelectEl) reflectiveSelectEl.value = 'accuse';
    scheduleHandleChange('change');
    });
}

// Reflective selector -> apply toggles
if (reflectiveSelectEl) {
    reflectiveSelectEl.addEventListener('change', () => {
    applyReflectiveSelection(reflectiveSelectEl.value);
    scheduleHandleChange('change');
    });
    // Initialize visibility based on current selection
    applyReflectiveSelection(reflectiveSelectEl.value || 'none');
}

// ---------- Canvas helpers ----------
function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const targetW = exportDimensions?.width ?? rect.width;
    const targetH = exportDimensions?.height ?? rect.height;
    const ratio = exportDimensions ? 1 : (window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(targetW * ratio));
    canvas.height = Math.max(1, Math.floor(targetH * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
let resizeRAF = 0;
window.addEventListener('resize', () => {
    if (resizeRAF) return;
    resizeRAF = requestAnimationFrame(() => {
    resizeRAF = 0;
    fitCanvas();
    drawImmediate(currentBlend, currentMixE);
    });
});

// ---------- Data computation ----------
function healthAt(lvl, baseLevel, faction, baseHealth) {
    return baseHealth * healthScaling[faction](lvl, baseLevel);
}
function healthEximusDefAt(lvl, baseLevel, faction, baseHealth) {
    return baseHealth * healthScaling[faction](lvl, baseLevel)
        * eximusHealthMultiplier(lvl, baseLevel, baseHealth);
}
function healthEximusNoDefAt(lvl, baseLevel, faction, baseHealth) {
    return baseHealth * healthScaling[faction](lvl, baseLevel)
        * eximusHealthNSAMultiplier(lvl, baseLevel, baseHealth);
}

function shieldAt(lvl, baseLevel, faction, baseShield) {
    if (!factionHasShieldScaling(faction)) return 0;
    return baseShield * (shieldScaling[faction] || (()=>1))(lvl, baseLevel);
}
function shieldEximusAt(lvl, baseLevel, faction, baseShield) {
    if (!factionHasShieldScaling(faction)) return 0;
    return baseShield * (shieldScaling[faction] || (()=>1))(lvl, baseLevel)
        * eximusShieldMultiplier(lvl, baseLevel);
}

// Unified helper for abilities that scale off enemy HP/SH, respecting Eximus multipliers.
function healthShieldForScaling(level, params, baseHealth, baseShield, faction) {
    const diffMul = difficultyFactor(params.enemyDifficulty);
    let hp, sh;
    if (params.enemyType === 'eximus_def') {
        hp = healthEximusDefAt(level, params.baseLevel, faction, baseHealth);
        sh = shieldEximusAt(level, params.baseLevel, faction, baseShield);
    } else if (params.enemyType === 'eximus_nodef') {
        hp = healthEximusNoDefAt(level, params.baseLevel, faction, baseHealth);
        sh = 0;
    } else {
        hp = healthAt(level, params.baseLevel, faction, baseHealth);
        sh = shieldAt(level, params.baseLevel, faction, baseShield);
    }
    if (!factionHasShieldScaling(faction)) sh = 0;
    return { hp: hp * diffMul, sh: sh * diffMul };
}

function ehpAtLevel(level, params) {
    const {
    baseLevel, baseHealth, baseShield, baseArmor,
    faction, enemyType, enemyDifficulty, trueDamageEnabled, trueToxinEnabled
    } = params;

    const diffMul = difficultyFactor(enemyDifficulty);
    const hasShieldScaling = factionHasShieldScaling(faction);

    let hp, sh;
    if (enemyType === 'eximus_def') {
    hp = healthEximusDefAt(level, baseLevel, faction, baseHealth);
    sh = shieldEximusAt(level, baseLevel, faction, baseShield);
    } else if (enemyType === 'eximus_nodef') {
    hp = healthEximusNoDefAt(level, baseLevel, faction, baseHealth);
    sh = 0;
    } else {
    hp = healthAt(level, baseLevel, faction, baseHealth);
    sh = shieldAt(level, baseLevel, faction, baseShield);
    }

    if (!hasShieldScaling) sh = 0;

    hp *= diffMul;
    sh *= diffMul;

    let og = 0;
    if (enemyType === 'eximus_def' || enemyType === 'eximus_nodef') {
    og = overguardAt(level);
    }

    const armorInfo = scaledArmorWithStrip(level, params);
    const rawArmor = armorInfo.rawArmor;
    const netArmor = armorInfo.netArmor;
    const armorDR  = armorInfo.dr;

    if (trueDamageEnabled) {
    // Ignore shields and armor; only HP + Overguard
    sh = 0;
    return hp + og;
    }

    if (trueToxinEnabled) {
    sh = 0;
    }

    let armorEhpHealth = hp;
    if (baseArmor > 0 && armorDR > 0 && armorDR < 0.99) {
    armorEhpHealth = hp / (1 - armorDR);
    }
    return armorEhpHealth + sh + og;
}

// Build plot-ready series (base, eximus variants, damage, EHP) from the current params/toggles.
// Optional xsOverride lets us reuse sampling points (used by rebuildAtXs).
// trackMaxY controls whether smoothing state is updated (only do this for the "display" series).
// snapUp controls whether upward moves snap (true) or ease (false).
function buildAllSeries(params, toggles, xsOverride = null, { trackMaxY = true, snapUp = true } = {}) {
    const { baseLevel, baseHealth, baseShield, baseDamage, statusStacks, mindControlPct, mindControlEnabled, nekrosMult, nekrosEnabled, damageDecoyMult, damageDecoyEnabled, targetLevel, faction } = params;
    const { baseOn, exDefOn, exNoDefOn, damageOn, scalingOn, ehpOn } = toggles;

    // Shared scalars for every sample
    const diffMul = difficultyFactor(params.enemyDifficulty);
    const noShieldScaling = !factionHasShieldScaling(faction);
    const statusMul = 1; // Enemy damage now independent of scaling multipliers
    const mindMul = 1;
    const nekMul = 1;
    const swMul = 1;
    const ddMul = 1;
    const scalingMul = scalingMultiplierFromParams(params, { useNourish: true });
    const vulnMul = vulnerabilityMultiplier(params);

    // Sampling grid
    const grid = (() => {
        if (xsOverride && xsOverride.length) {
            return { xs: xsOverride, start: xsOverride[0], end: xsOverride[xsOverride.length - 1], N: xsOverride.length };
        }
        let start = Math.max(1, baseLevel);
        if (Number.isFinite(params.xAxisFrom) && params.xAxisFrom > 0) {
            start = params.xAxisFrom;
        }
        let end = Math.max(start, targetLevel);
        if (Number.isFinite(params.xAxisTo) && params.xAxisTo > 0) {
            end = Math.max(start, params.xAxisTo);
        }
        const w = canvas ? Math.max(1, canvas.clientWidth) : 800;
        const N = Math.max(80, Math.min(600, Math.floor(w)));
        const xs = new Array(N);
        for (let i = 0; i < N; i++) {
            const t = i / (N - 1);
            xs[i] = start + t * (end - start);
        }
        return { xs, start, end, N };
    })();

    const { xs, start, end, N } = grid;
    const series = {
        base:   { hp: new Array(N), sh: new Array(N), enabled: baseOn },
        exDef:  { hp: new Array(N), sh: new Array(N), enabled: exDefOn },
        exNoDef:{ hp: new Array(N), sh: new Array(N), enabled: exNoDefOn },
        og:     new Array(N),
        ogEnabled: exDefOn || exNoDefOn,
        damage: { vals: new Array(N), enabled: damageOn },
        scaling: { vals: new Array(N), enabled: scalingOn },
        ehp:    { vals: new Array(N), enabled: ehpOn },
        intersections: [],
        xs,
        start,
        end,
        maxY: 10,
        hasShield: baseShield > 0 && !noShieldScaling
    };

    for (let i = 0; i < N; i++) {
        const lvl = xs[i];

        // --- Unified Overguard ---
        series.og[i] = overguardAt(lvl);

        // --- Base enemy ---
        if (baseOn) {
            const bh = healthAt(lvl, baseLevel, faction, baseHealth);
            const bs = noShieldScaling ? 0 : shieldAt(lvl, baseLevel, faction, baseShield);
            series.base.hp[i] = bh * diffMul;
            series.base.sh[i] = bs * diffMul;
        } else {
            series.base.hp[i] = 0;
            series.base.sh[i] = 0;
        }

        // --- Eximus DEF ---
        if (exDefOn) {
            const eh = healthEximusDefAt(lvl, baseLevel, faction, baseHealth);
            const es = noShieldScaling ? 0 : shieldEximusAt(lvl, baseLevel, faction, baseShield);
            series.exDef.hp[i] = eh * diffMul;
            series.exDef.sh[i] = es * diffMul;
        } else {
            series.exDef.hp[i] = 0;
            series.exDef.sh[i] = 0;
        }

        // --- Eximus no-DEF ---
        if (exNoDefOn) {
            const enh = healthEximusNoDefAt(lvl, baseLevel, faction, baseHealth);
            series.exNoDef.hp[i] = enh * diffMul;
            series.exNoDef.sh[i] = 0;
        } else {
            series.exNoDef.hp[i] = 0;
            series.exNoDef.sh[i] = 0;
        }

        // --- Damage ---
        if (damageOn && baseDamage > 0) {
            const dm = damageMultiplier(lvl, baseLevel, faction);
            series.damage.vals[i] = baseDamage * dm;
        } else {
            series.damage.vals[i] = 0;
        }

        // --- Scaling Damage ---
        if (scalingOn) {
            if (params.scalingMode === 'reflective' && params.reflectiveAbility === 'iron_skin' && params.ironShrapnelEnabled) {
                const enemyDamageAtLevel = baseDamage > 0
                    ? baseDamage
                        * damageMultiplier(lvl, baseLevel, faction)
                        * difficultyFactor(params.enemyDifficulty)
                    : 0;
                const { dmg: ironSkinDmg } = ironSkinDetonationDamage(params, lvl, { vulnMul, enemyDamageOverride: enemyDamageAtLevel });
                series.scaling.vals[i] = ironSkinDmg;
            } else {
                series.scaling.vals[i] = scalingDamageSample(params, lvl, { vulnMul, scalingMul });
            }
        } else {
            series.scaling.vals[i] = 0;
        }

        // --- EHP ---
        if (ehpOn) {
            series.ehp.vals[i] = ehpAtLevel(lvl, params);
        } else {
            series.ehp.vals[i] = 0;
        }
    }

    // --- Compute maxY ---
    let maxY = 10;
    const arrays = [];
    if (baseOn) arrays.push(series.base.hp, series.base.sh);
    if (exDefOn) arrays.push(series.exDef.hp, series.exDef.sh);
    if (exNoDefOn) arrays.push(series.exNoDef.hp);
    if (series.ogEnabled) arrays.push(series.og);
    if (damageOn) arrays.push(series.damage.vals);
    if (scalingOn) arrays.push(series.scaling.vals);
    if (ehpOn) arrays.push(series.ehp.vals);
    arrays.forEach(arr => arr.forEach(v => { if (v > maxY) maxY = v; }));
    const userYMax = params.yAxisMax;
    if (Number.isFinite(userYMax) && userYMax > 0) {
        series.maxY = userYMax;
        if (trackMaxY) axisState.base = { maxY: userYMax, start, end };
    } else {
        const baseMax = smoothMaxY(maxY, start, end, axisState.base, { track: trackMaxY, snapUp });
        series.maxY = baseMax.maxY;
        if (trackMaxY) axisState.base = baseMax.state;
    }

    // --- Intersections (damage ��" ehp) ---
    const findIntersections = (arrA, arrB) => {
        const list = [];
        for (let i = 1; i < N; i++) {
            const a0 = arrA[i-1];
            const a1 = arrA[i];
            const b0 = arrB[i-1];
            const b1 = arrB[i];
            if (a0 <= 0 || a1 <= 0 || b0 <= 0 || b1 <= 0) continue;
            const diff0 = a0 - b0;
            const diff1 = a1 - b1;
            if (diff0 < 0 && diff1 >= 0) {
                const t = (0 - diff0) / (diff1 - diff0);
                const lvl = xs[i-1] + t * (xs[i] - xs[i-1]);
                const val = a0 + t * (a1 - a0);
                list.push({ lvl, value: val });
            }
        }
        return list;
    };

    const intersectionsDamage = (series.damage.enabled && series.ehp.enabled)
        ? findIntersections(series.damage.vals, series.ehp.vals).map(obj => ({ ...obj, type: 'damage' }))
        : [];
    const intersectionsScaling = (series.scaling.enabled && series.ehp.enabled)
        ? findIntersections(series.scaling.vals, series.ehp.vals).map(obj => ({ ...obj, type: 'scaling' }))
        : [];
    let scalingAboveEhp = false;
    if (series.scaling.enabled && series.ehp.enabled) {
        let minDiff = Infinity;
        for (let i = 0; i < N; i++) {
        const diff = series.scaling.vals[i] - series.ehp.vals[i];
        if (diff < minDiff) minDiff = diff;
        }
        scalingAboveEhp = isFinite(minDiff) && minDiff > 0;
    }

    series.intersectionsDamage = intersectionsDamage;
    series.intersectionsScaling = intersectionsScaling;
    series.scalingAboveEhp = scalingAboveEhp;

    const combined = [...intersectionsScaling, ...intersectionsDamage];
    const active = combined.length ? combined[combined.length - 1] : null;

    series.intersections = combined;
    series.activeIntersection = active;
    series.activeIntersectionSource = active?.type || null;
    series.intersectionReveal = series.intersections.length ? 1 : 0;
    series.intersectionRevealDamage = intersectionsDamage.length ? 1 : 0;
    series.intersectionRevealScaling = intersectionsScaling.length ? 1 : 0;
    series.scalingAboveEhp = scalingAboveEhp;

    return series;
}

function rebuildAtXs(xs, params, toggles) {
    return buildAllSeries(params, toggles, xs, { trackMaxY: false });
}

function buildComparisonSeries(params, { trackMaxY = true } = {}) {
    const baseLevel = params.baseLevel;
    const targetLevel = params.targetLevel;
    let start = Math.max(1, baseLevel);
    if (Number.isFinite(params.xAxisFrom) && params.xAxisFrom > 0) {
    start = params.xAxisFrom;
    }
    let end = Math.max(start, targetLevel);
    if (Number.isFinite(params.xAxisTo) && params.xAxisTo > 0) {
    end = Math.max(start, params.xAxisTo);
    }
    const w = canvas ? Math.max(1, canvas.clientWidth) : 800;
    const N = Math.max(80, Math.min(600, Math.floor(w)));
    const xs = new Array(N);
    for (let i=0;i<N;i++){
    const t = i / (N - 1);
    xs[i] = start + t * (end - start);
    }
    const diffMul = difficultyFactor(params.enemyDifficulty);
    const metric = (compareMetricEl?.value || 'health');
    const eximusComparable = metric === 'health' || metric === 'shield' || metric === 'ehp';
    const showBase = eximusComparable ? !!compareShowBaseEl?.checked : true;
    const showExDef = eximusComparable ? !!compareShowExDefEl?.checked : false;
    const showExNoDef = eximusComparable ? !!compareShowExNoDefEl?.checked : false;
    const selectedFactions = getSelectedComparisonFactions();
    const factions = [];
    selectedFactions.forEach(f => {
    const info = compareLegendInfo(f);
    const baseVals = new Array(N);
    const exDefVals = eximusComparable ? new Array(N) : null;
    const exNoDefVals = eximusComparable ? new Array(N) : null;
    for (let i=0;i<N;i++){
        const lvl = xs[i];
        if (metric === 'health') {
        baseVals[i] = healthAt(lvl, baseLevel, f, params.baseHealth) * diffMul;
        exDefVals[i] = healthEximusDefAt(lvl, baseLevel, f, params.baseHealth) * diffMul;
        exNoDefVals[i] = healthEximusNoDefAt(lvl, baseLevel, f, params.baseHealth) * diffMul;
        } else if (metric === 'shield') {
        baseVals[i] = shieldAt(lvl, baseLevel, f, params.baseShield) * diffMul;
        if (eximusComparable) {
            exDefVals[i] = shieldEximusAt(lvl, baseLevel, f, params.baseShield) * diffMul;
            exNoDefVals[i] = 0;
        }
        } else if (metric === 'damage') {
        const lvlMul = damageMultiplier(lvl, baseLevel, f);
        baseVals[i] = params.baseDamage * lvlMul;
        } else if (metric === 'ehp') {
        const baseParams = { ...params, faction: f };
        baseVals[i] = ehpAtLevel(lvl, { ...baseParams, enemyType: 'normal' });
        if (eximusComparable) {
            exDefVals[i] = ehpAtLevel(lvl, { ...baseParams, enemyType: 'eximus_def' });
            exNoDefVals[i] = ehpAtLevel(lvl, { ...baseParams, enemyType: 'eximus_nodef' });
        }
        } else if (metric === 'scaling') {
        const paramsForFaction = { ...params, faction: f };
        const vulnMul = vulnerabilityMultiplier(paramsForFaction);
        const scaleMul = scalingMultiplierFromParams(paramsForFaction, { useNourish: true });
        if (paramsForFaction.scalingMode === 'reflective' && paramsForFaction.reflectiveAbility === 'iron_skin' && paramsForFaction.ironShrapnelEnabled) {
            const enemyDamageAtLevel = params.baseDamage
                * damageMultiplier(lvl, baseLevel, f)
                * difficultyFactor(params.enemyDifficulty);
            const { dmg: ironSkinDmg } = ironSkinDetonationDamage(paramsForFaction, lvl, { vulnMul, enemyDamageOverride: enemyDamageAtLevel });
            baseVals[i] = ironSkinDmg;
        } else {
            baseVals[i] = scalingDamageSample(paramsForFaction, lvl, { vulnMul, scalingMul: scaleMul });
        }
        }
    }
    if (showBase) factions.push({ faction: f, label: `${metricLabels[metric]} - ${info.label}`, color: info.color, dash: info.dash, vals: baseVals });
    if (eximusComparable && showExDef) {
        factions.push({ faction: `${f}-exdef`, label: `${info.label} (Eximus +Def)`, color: info.color, dash: [8,6], vals: exDefVals });
    }
    if (eximusComparable && showExNoDef) {
        factions.push({ faction: `${f}-exnodef`, label: `${info.label} (Eximus -Def)`, color: info.color, dash: [2,6], vals: exNoDefVals });
    }
    });

    // Smooth the Y-axis to avoid jarring resizes when toggling factions.
    let maxY = 10;
    factions.forEach(fc => fc.vals.forEach(v => { if (v > maxY) maxY = v; }));

    const userYMax = params.yAxisMax;
    let compareMax;
    if (Number.isFinite(userYMax) && userYMax > 0) {
    compareMax = { maxY: userYMax, state: { maxY: userYMax, start, end } };
    if (trackMaxY) axisState.compare = compareMax.state;
    } else {
    compareMax = trackMaxY
        ? smoothMaxY(maxY, start, end, axisState.compare, { track: true })
        : smoothMaxY(maxY, start, end, axisState.compare, { track: false });
    if (trackMaxY) axisState.compare = compareMax.state;
    }

    return {
    comparison: true,
    metric,
    xs,
    start,
    end,
    maxY: compareMax.maxY,
    factions,
    targetLevel
    };
}

function buildPresetComparisonSeries(activeParams, { trackMaxY = true } = {}) {
    if (!hasBothPresets()) return null;
    const metric = (compareMetricEl?.value || 'health');
    const targetLevel = Math.max(1, parseInt(activeParams?.targetLevel || 1, 10));
    const selectedPresets = Array.from(presetActive);
    if (!selectedPresets.length) {
    if (abPresets.A) selectedPresets.push('A');
    if (abPresets.B) selectedPresets.push('B');
    }

    const startCandidates = [];
    const endCandidates = [targetLevel];
    const pushStart = (v) => { if (Number.isFinite(v) && v > 0) startCandidates.push(v); };
    const pushEnd = (v) => { if (Number.isFinite(v) && v > 0) endCandidates.push(v); };

    const presetList = [
    { slot: 'A', preset: abPresets.A, color: '#22c55e', dash: [] },
    { slot: 'B', preset: abPresets.B, color: '#d946ef', dash: [] }
    ];

    presetList.forEach(({ preset }) => {
    if (!preset || !preset.params) return;
    const p = preset.params;
    pushStart(Number.isFinite(p.xAxisFrom) && p.xAxisFrom > 0 ? p.xAxisFrom : p.baseLevel);
    pushEnd(Number.isFinite(p.xAxisTo) && p.xAxisTo > 0 ? p.xAxisTo : (p.targetLevel || targetLevel));
    });
    pushStart(Number.isFinite(activeParams?.xAxisFrom) ? activeParams.xAxisFrom : activeParams?.baseLevel);
    pushEnd(Number.isFinite(activeParams?.xAxisTo) ? activeParams.xAxisTo : targetLevel);

    let start = startCandidates.length ? Math.max(1, Math.min(...startCandidates)) : 1;
    let end = endCandidates.length ? Math.max(start, Math.max(...endCandidates)) : Math.max(start, targetLevel);
    if (Number.isFinite(activeParams?.xAxisFrom) && activeParams.xAxisFrom > 0) {
    start = activeParams.xAxisFrom;
    }
    if (Number.isFinite(activeParams?.xAxisTo) && activeParams.xAxisTo > 0) {
    end = Math.max(start, activeParams.xAxisTo);
    }
    const w = canvas ? Math.max(1, canvas.clientWidth) : 800;
    const N = Math.max(80, Math.min(600, Math.floor(w)));
    const xs = new Array(N);
    for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    xs[i] = start + t * (end - start);
    }

    const factions = [];
    presetList.forEach(({ slot, preset, color, dash }) => {
    if (!selectedPresets.includes(slot)) return;
    if (!preset || !preset.params) return;
    const baseParams = preset.params;
    const params = {
        ...baseParams,
        targetLevel,
        xAxisFrom: start,
        xAxisTo: end,
        yAxisMax: activeParams?.yAxisMax
    };
    const toggles = { ...(preset.toggles || {}) };
    params.enemyType = computeEffectiveEnemyType(params, toggles);
    const diffMul = difficultyFactor(params.enemyDifficulty);
    const vulnMul = vulnerabilityMultiplier(params);
    const scaleMul = scalingMultiplierFromParams(params, { useNourish: true });

    const vals = new Array(N);
    for (let i = 0; i < N; i++) {
        const lvl = xs[i];
        let v = 0;
        if (metric === 'health') {
        if (params.enemyType === 'eximus_def') v = healthEximusDefAt(lvl, params.baseLevel, params.faction, params.baseHealth);
        else if (params.enemyType === 'eximus_nodef') v = healthEximusNoDefAt(lvl, params.baseLevel, params.faction, params.baseHealth);
        else v = healthAt(lvl, params.baseLevel, params.faction, params.baseHealth);
        v *= diffMul;
        } else if (metric === 'shield') {
        v = shieldAt(lvl, params.baseLevel, params.faction, params.baseShield) * diffMul;
        } else if (metric === 'damage') {
        const lvlMul = damageMultiplier(lvl, params.baseLevel, params.faction);
        v = params.baseDamage * lvlMul;
        } else if (metric === 'ehp') {
        v = ehpAtLevel(lvl, params);
        } else if (metric === 'scaling') {
        if (params.scalingMode === 'reflective' && params.reflectiveAbility === 'iron_skin' && params.ironShrapnelEnabled) {
            const enemyDamageAtLevel = params.baseDamage
                * damageMultiplier(lvl, params.baseLevel, params.faction)
                * difficultyFactor(params.enemyDifficulty);
            const { dmg: ironSkinDmg } = ironSkinDetonationDamage(params, lvl, { vulnMul, enemyDamageOverride: enemyDamageAtLevel });
            v = ironSkinDmg;
        } else {
            v = scalingDamageSample(params, lvl, { vulnMul, scalingMul: scaleMul });
        }
        }
        vals[i] = v;
    }

    const label = (preset.label && preset.label.trim()) ? `${slot}: ${preset.label.trim()}` : `Preset ${slot}`;
    factions.push({ faction: slot, label, color, dash, vals });
    });

    if (!factions.length) return null;

    let maxY = 10;
    factions.forEach(fc => fc.vals.forEach(v => { if (v > maxY) maxY = v; }));

    const userYMax = activeParams?.yAxisMax;
    let presetMax;
    if (Number.isFinite(userYMax) && userYMax > 0) {
    presetMax = { maxY: userYMax, state: { maxY: userYMax, start, end } };
    if (trackMaxY) axisState.preset = presetMax.state;
    } else {
    presetMax = trackMaxY
        ? smoothMaxY(maxY, start, end, axisState.preset, { track: true })
        : smoothMaxY(maxY, start, end, axisState.preset, { track: false });
    if (trackMaxY) axisState.preset = presetMax.state;
    }

    return {
    comparison: true,
    presetComparison: true,
    metric,
    xs,
    start,
    end,
    maxY: presetMax.maxY,
    factions,
    targetLevel
    };
}

function getPresetCompareSignature(params) {
    const metric = (compareMetricEl?.value || 'health');
    const yMax = params?.yAxisMax || '';
    const aStamp = abPresets.A?.savedAt || 0;
    const bStamp = abPresets.B?.savedAt || 0;
    const tgt = params?.targetLevel || '';
    return [metric, tgt, yMax, aStamp, bStamp].join('|');
}

function buildComparisonSeed(toSeries) {
    const zeroFactions = toSeries.factions.map(fc => ({
    ...fc,
    vals: new Array(toSeries.xs.length).fill(0)
    }));
    return {
    comparison: true,
    metric: toSeries.metric,
    xs: toSeries.xs,
    start: toSeries.start,
    end: toSeries.end,
    maxY: 1,
    factions: zeroFactions
    };
}

// Build a smoother starting point when switching from the normal view to comparison mode.
// We pre-fill the current faction's curve so it doesn't have to "pop in" from zero,
// and keep the previous axis range to reduce jumps.
function buildComparisonBridgeFromNormal(normalSeries, toSeries, params) {
    const xs = toSeries.xs;
    const mainFaction = params.faction;
    const start = normalSeries?.start ?? toSeries.start;
    const end = normalSeries?.end ?? toSeries.end;
    const maxY = Math.max(normalSeries?.maxY || toSeries.maxY, toSeries.maxY);

    const factions = toSeries.factions.map(fc => {
    const vals = (fc.faction === mainFaction)
        ? fc.vals.slice()
        : new Array(xs.length).fill(0);
    return { ...fc, vals };
    });

    return {
    comparison: true,
    metric: toSeries.metric,
    xs,
    start,
    end,
    maxY,
    factions
    };
}

// Bridge from comparison back to the normal plot by matching ranges and sampling at the target xs.
function buildNormalBridgeFromComparison(compSeries, params, toggles) {
    const xs = compSeries?.xs;
    if (!xs) return null;
    const rebuilt = rebuildAtXs(xs, params, toggles);
    rebuilt.start = compSeries.start ?? rebuilt.start;
    rebuilt.end = compSeries.end ?? rebuilt.end;
    rebuilt.maxY = Math.max(compSeries.maxY || rebuilt.maxY, rebuilt.maxY);
    return rebuilt;
}

// Resample an existing comparison series onto a new X grid so animations can morph smoothly.
function resampleComparisonSeries(series, targetXs) {
    if (!series || !series.factions || !Array.isArray(targetXs) || !targetXs.length) return null;
    const { xs, start, end } = series;
    if (!xs || !xs.length) return null;
    const srcLen = xs.length;
    const span = (end - start) || 1;
    const resampledFactions = series.factions.map(fc => {
    const vals = new Array(targetXs.length);
    for (let i = 0; i < targetXs.length; i++) {
        const t = (targetXs[i] - start) / span;
        const pos = Math.min(srcLen - 1, Math.max(0, t * (srcLen - 1)));
        const lo = Math.floor(pos);
        const hi = Math.min(srcLen - 1, Math.ceil(pos));
        const frac = (hi === lo) ? 0 : (pos - lo) / (hi - lo);
        const va = fc.vals[lo] ?? 0;
        const vb = fc.vals[hi] ?? va;
        vals[i] = va + (vb - va) * frac;
    }
    return { ...fc, vals };
    });
    const maxY = resampledFactions.reduce((m, fc) => {
    fc.vals.forEach(v => { if (v > m) m = v; });
    return m;
    }, 1);
    return {
    ...series,
    xs: targetXs.slice(),
    start: targetXs[0],
    end: targetXs[targetXs.length - 1],
    factions: resampledFactions,
    maxY
    };
}

// ---------- Number animation helpers ----------
const numberAnims = new Map();
function parseNumberLike(text) {
    if (!text) return 0;
    const n = Number(String(text).replace(/[^0-9+\-\.]/g, ''));
    return isFinite(n) ? n : 0;
}
function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; }

function animateNumber(el, toValue, { duration = 550, decimals = 0, locale = true } = {}) {
    const key = el;
    const prev = numberAnims.get(key);
    if (prev && prev.raf) cancelAnimationFrame(prev.raf);
    const fromValue = prev ? prev.current : parseNumberLike(el.textContent) || 0;
    const start = performance.now();
    const pow = Math.pow(10, decimals);

    function fmt(v){
    if (decimals > 0) return (Math.round(v * pow) / pow).toFixed(decimals);
    return locale ? Math.round(v).toLocaleString() : String(Math.round(v));
    }

    function step(now){
    const t = Math.min(1, (now - start) / duration);
    const e = easeInOutCubic(t);
    const v = fromValue + (toValue - fromValue) * e;
    el.textContent = fmt(v);
    if (t < 1) {
        const raf = requestAnimationFrame(step);
        numberAnims.set(key, { raf, current: v });
    } else {
        el.textContent = fmt(toValue);
        numberAnims.set(key, { raf: 0, current: toValue });
    }
    }
    const raf = requestAnimationFrame(step);
    numberAnims.set(key, { raf, current: fromValue });
}

function snapNumber(el, toValue, { decimals = 0, locale = true } = {}) {
    const pow = Math.pow(10, decimals);
    const text = decimals > 0
    ? (Math.round(toValue * pow) / pow).toFixed(decimals)
    : (locale ? Math.round(toValue).toLocaleString() : String(Math.round(toValue)));
    el.textContent = text;
    numberAnims.set(el, { raf: 0, current: toValue });
}

// ---------- Animation engine (plot) ----------
let currentParams = null;
let currentToggles = null;
let currentBlend = null;
let currentMixE = null;
let animId = 0;

function drawImmediate(series, e = 1) {
    if (!series) return;
    fitCanvas();
    const w = exportDimensions?.width ?? canvas.clientWidth;
    const h = exportDimensions?.height ?? canvas.clientHeight;
    const { xs, base, exDef, exNoDef, damage, ehp, intersections, start, end, maxY, hasShield, comparison } = series;
    ctx.clearRect(0,0,w,h);

    const pad = 36;
    const legendOffset = (recordingActive && recordingIncludeLegend && recordingLegendLayout) ? recordingLegendLayout.legendHeight : 0;
    const gx0 = pad, gy0 = h - pad, gx1 = w - pad, gy1 = pad + legendOffset;
    const innerW = gx1 - gx0, innerH = gy0 - gy1;

    // Axes
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy0); ctx.moveTo(gx0, gy0); ctx.lineTo(gx0, gy1); ctx.stroke();

    // Grid + tick labels
    ctx.fillStyle = '#9ca3af'; ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, Roboto';
    const xTicks = 6, yTicks = 6;
    for (let i=0;i<=xTicks;i++){
    const t=i/xTicks, x=gx0+t*innerW, lvl=Math.round(start + t*(end-start));
    ctx.strokeStyle='#272c36'; ctx.beginPath(); ctx.moveTo(x,gy0); ctx.lineTo(x,gy1); ctx.stroke();
    ctx.fillText(lvl.toString(), Math.round(x)-8, gy0+18);
    }
    for (let j=0;j<=yTicks;j++){
    const t=j/yTicks, y=gy0-t*innerH, val=Math.round(t*maxY);
    ctx.strokeStyle='#272c36'; ctx.beginPath(); ctx.moveTo(gx0,y); ctx.lineTo(gx1,y); ctx.stroke();
    ctx.save();
    ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(val.toLocaleString(), 4, Math.round(y)-2);
    ctx.restore();
    }

    // X-axis label
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Level', (gx0 + gx1) / 2, gy0 + 24);

    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';

    const xScale = (lvl)=> gx0 + (lvl - start) / (end - start || 1) * innerW;
    const yScale = (v)=> gy0 - (v / (maxY || 1)) * innerH;

    if (comparison) {
    const revealGlobal = Math.max(0, Math.min(1, e));
    function drawSeriesVals(fc) {
        const vals = fc.vals;
        const reveal = Math.max(0, Math.min(1, fc.reveal == null ? revealGlobal : fc.reveal));
        ctx.setLineDash(fc.dash || []);
        ctx.strokeStyle = fc.color; ctx.lineWidth = 2.5; ctx.beginPath();
        const N = vals.length;
        const cutoff = Math.max(1, Math.floor((N - 1) * reveal));
        for (let i=0;i<N;i++){
        const x = xScale(series.xs[i]); const y = yScale(vals[i]);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        if (i >= cutoff) break;
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }
    series.factions.forEach(fc => drawSeriesVals(fc));
    } else {

        function sample(valuesObj, i) {
        if (valuesObj.values) return valuesObj.values[i];
        return (1 - e) * valuesObj.from[i] + e * valuesObj.to[i];
        }

        function drawSeries(valuesObj, color, dash=null, revealRatio=1) {
        ctx.setLineDash(dash || []);
        ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
        const N = (valuesObj.values ? valuesObj.values.length : valuesObj.to.length);
        const cutoff = Math.floor((N-1) * revealRatio);
        for (let i=0;i<N;i++){
            const x = xScale(xs[i]); const y = yScale(sample(valuesObj, i));
            if (i===0) ctx.moveTo(x,y);
            else if (i <= cutoff) ctx.lineTo(x,y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        }

        if (base.enabled) {
        drawSeries(base.hp, '#ef4444', null, base.hp.reveal);
        if (hasShield) drawSeries(base.sh, '#06b6d4', null, base.sh.reveal);
        }
        if (exDef.enabled) {
        drawSeries(exDef.hp, '#ef4444', [10,6], exDef.hp.reveal);
        if (hasShield) drawSeries(exDef.sh, '#06b6d4', [10,6], exDef.sh.reveal);
        }

        if (exNoDef.enabled) {
        drawSeries(exNoDef.hp, '#ef4444', [2,8], exNoDef.hp.reveal);
        }

        if (series.ogEnabled) {
            drawSeries(series.og, OVERGUARD_COLOR, [10,6], series.og.reveal);
        }

        if (damage && damage.enabled) {
        drawSeries(damage.vals, DAMAGE_COLOR, null, damage.vals.reveal);
        }

        if (series.scaling && series.scaling.enabled) {
        drawSeries(series.scaling.vals, SCALING_DAMAGE_COLOR, null, series.scaling.vals.reveal);
        }

        if (ehp && ehp.enabled) {
        drawSeries(ehp.vals, EHP_COLOR, [4,6], ehp.vals.reveal);
        }

        // Intersection markers (Damage/Scaling vs EHP)
        if (ehp && ehp.enabled) {
        const irDamage = (series.intersectionRevealDamage == null ? series.intersectionReveal : series.intersectionRevealDamage) || 0;
        const irScaling = (series.intersectionRevealScaling == null ? series.intersectionReveal : series.intersectionRevealScaling) || 0;
        const drawMarkers = (pts, ir) => {
            if (!pts || !pts.length || ir <= 0) return;
            pts.forEach(pt => {
            const x = xScale(pt.lvl);
            const y = yScale(pt.value);
            ctx.save();
            ctx.strokeStyle = INTERSECTION_COLOR;
            ctx.fillStyle = INTERSECTION_COLOR;
            ctx.setLineDash([4, 4]);

            const yTop = gy0 - (gy0 - y) * ir;
            ctx.beginPath();
            ctx.moveTo(x, gy0);
            ctx.lineTo(x, yTop);
            ctx.stroke();

            const r = 4 * ir;
            if (r > 0.5) {
                ctx.beginPath();
                ctx.setLineDash([]);
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            });
        };
        drawMarkers(series.intersectionsScaling, irScaling);
        drawMarkers(series.intersectionsDamage, irDamage);
        }
    }

    if (recordingActive && recordingFillColor) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = recordingFillColor;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    }

    if (recordingActive && recordingIncludeLegend && recordingLegendEntries && recordingLegendEntries.length) {
    const legendLayout = recordingLegendLayout || layoutLegendEntries(recordingLegendEntries, w);
    paintLegend(ctx, recordingLegendEntries, legendLayout, { withBackground: !!recordingFillColor });
    }
}

function wrapValues(arr, reveal=1) { return { values: arr, reveal }; }

// Interpolates between two series sets so plot transitions instead of snapping.
function animateFromTo(fromSeries, toSeries, duration=500, mode={}) {
    if (fromSeries && !fromSeries.scaling) fromSeries.scaling = { enabled: false, vals: [] };
    if (toSeries && !toSeries.scaling) toSeries.scaling = { enabled: false, vals: [] };
    // Comparison-mode animation branch
    if (toSeries && toSeries.comparison) {
    const startTime = performance.now();
    cancelAnimationFrame(animId);

    const fromMap = new Map();
    if (fromSeries && fromSeries.comparison && fromSeries.factions) {
        fromSeries.factions.forEach(fc => fromMap.set(fc.faction, fc));
    }
    const toMap = new Map();
    if (toSeries && toSeries.factions) {
        toSeries.factions.forEach(fc => toMap.set(fc.faction, fc));
    }

    const xs = toSeries.xs;
    const keys = new Set([...toMap.keys(), ...fromMap.keys()]);

    // Ensure we render the starting state immediately (e=0) so capture streams don't start from the previous plot.
    const initialMixed = resampleComparisonSeries(fromSeries, xs) || buildComparisonSeed(toSeries);
    currentBlend = initialMixed;
    drawImmediate(initialMixed, 0);

    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const e = easeInOutCubic(t);

        const mixedFactions = [];
        keys.forEach(f => {
        const toFc = toMap.get(f);
        const fromFc = fromMap.get(f);
        const targetVals = toFc ? toFc.vals : (fromFc ? new Array(fromFc.vals.length).fill(0) : new Array(xs.length).fill(0));
        const sourceVals = fromFc ? fromFc.vals : new Array(targetVals.length).fill(0);
        const N = Math.min(sourceVals.length, targetVals.length);
        const vals = new Array(N);
        for (let i=0;i<N;i++){
            vals[i] = (1 - e) * sourceVals[i] + e * targetVals[i];
        }
        const info = toFc || fromFc || { color: compareLegendInfo(f).color, dash: compareLegendInfo(f).dash, label: compareLegendInfo(f).label || f };
        const appearing = !!toFc && !fromFc;
        const disappearing = !!fromFc && !toFc;
        const reveal = appearing ? e : (disappearing ? (1 - e) : e);
        mixedFactions.push({
            faction: f,
            label: (toFc?.label || fromFc?.label || `${metricLabels[toSeries.metric] || toSeries.metric} - ${compareLegendInfo(f).label || f}`),
            color: info.color,
            dash: info.dash,
            vals,
            reveal
        });
        });

        let maxY = 10;
        mixedFactions.forEach(fc => fc.vals.forEach(v => { if (v > maxY) maxY = v; }));
        // interpolate maxY for smoother scale
        if (fromSeries && fromSeries.comparison) {
        maxY = (1 - e) * fromSeries.maxY + e * Math.max(maxY, toSeries.maxY);
        }

        const mixed = { ...toSeries, factions: mixedFactions, maxY };
        currentBlend = mixed;
        drawImmediate(mixed, e);

        if (t < 1) {
        animId = requestAnimationFrame(step);
        } else {
        const finalizedFactions = toSeries.factions.map(fc => ({ ...fc, reveal: 1 }));
        currentBlend = { ...toSeries, factions: finalizedFactions };
        drawImmediate(currentBlend, 1);
        }
    };

    animId = requestAnimationFrame(step);
    return;
    }

    const startTime = performance.now();
    cancelAnimationFrame(animId);

    const appearBase    = (!fromSeries.base.enabled   && toSeries.base.enabled);
    const appearDamage  = (!fromSeries.damage.enabled && toSeries.damage.enabled);
    const appearScaling = (!fromSeries.scaling?.enabled && toSeries.scaling?.enabled);
    const appearEHP     = (!fromSeries.ehp.enabled    && toSeries.ehp.enabled);

    const disappearBase   = (fromSeries.base.enabled   && !toSeries.base.enabled);
    const disappearDamage = (fromSeries.damage.enabled && !toSeries.damage.enabled);
    const disappearScaling = (fromSeries.scaling?.enabled && !toSeries.scaling?.enabled);
    const disappearEHP    = (fromSeries.ehp.enabled    && !toSeries.ehp.enabled);

    const appearExDef   = (!fromSeries.exDef.enabled    && toSeries.exDef.enabled);
    const appearExNoDef = (!fromSeries.exNoDef.enabled  && toSeries.exNoDef.enabled);
    const disappearExDef   = (fromSeries.exDef.enabled   && !toSeries.exDef.enabled);
    const disappearExNoDef = (fromSeries.exNoDef.enabled && !toSeries.exNoDef.enabled);

    // Unified Overguard appear / disappear
    const ogAppearing    = (!fromSeries.ogEnabled && toSeries.ogEnabled);
    const ogDisappearing = (fromSeries.ogEnabled  && !toSeries.ogEnabled);

    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const e = easeInOutCubic(t);

        // Keep X-range locked to the target series during animation to avoid curve squashing.
        const start = toSeries.start;
        const end   = toSeries.end;

        const mixed = {
            xs: toSeries.xs,
            start,
            end,
            // Start from the previous maxY; smoothing below will grow/shrink as needed.
            maxY: fromSeries.maxY,
            hasShield: (fromSeries.hasShield || toSeries.hasShield),

            base:   { enabled: (fromSeries.base.enabled   || toSeries.base.enabled) },
            exDef:  { enabled: (fromSeries.exDef.enabled  || toSeries.exDef.enabled) },
            exNoDef:{ enabled: (fromSeries.exNoDef.enabled|| toSeries.exNoDef.enabled) },

            ogEnabled: (fromSeries.ogEnabled || toSeries.ogEnabled),

            damage: { enabled: (fromSeries.damage.enabled || toSeries.damage.enabled) },
            scaling:{ enabled: ((fromSeries.scaling && fromSeries.scaling.enabled) || (toSeries.scaling && toSeries.scaling.enabled)) },
            ehp:    { enabled: (fromSeries.ehp.enabled    || toSeries.ehp.enabled) },

            intersections: toSeries.intersections,
            scalingAboveEhp: toSeries.scalingAboveEhp
        };

        // ----- Intersection reveal animation -----
        const fromIRD = fromSeries.intersectionRevealDamage || 0;
        const toIRD   = toSeries.intersectionRevealDamage   || 0;
        const fromIRS = fromSeries.intersectionRevealScaling || 0;
        const toIRS   = toSeries.intersectionRevealScaling   || 0;

        const fromCountD = (fromSeries.intersectionsDamage && fromSeries.intersectionsDamage.length) || 0;
        const toCountD   = (toSeries.intersectionsDamage && toSeries.intersectionsDamage.length) || 0;
        const fromCountS = (fromSeries.intersectionsScaling && fromSeries.intersectionsScaling.length) || 0;
        const toCountS   = (toSeries.intersectionsScaling && toSeries.intersectionsScaling.length) || 0;

        const damageAppearing    = toCountD > fromCountD || (fromIRD === 0 && toIRD > 0);
        const damageDisappearing = (fromIRD > 0 && toIRD === 0) || (toCountD < fromCountD);
        const scalingAppearing    = toCountS > fromCountS || (fromIRS === 0 && toIRS > 0);
        const scalingDisappearing = (fromIRS > 0 && toIRS === 0) || (toCountS < fromCountS);

        mixed.intersectionsDamage = damageDisappearing ? (fromSeries.intersectionsDamage || []) : (toSeries.intersectionsDamage || []);
        mixed.intersectionsScaling = scalingDisappearing ? (fromSeries.intersectionsScaling || []) : (toSeries.intersectionsScaling || []);
        mixed.intersections = [...(mixed.intersectionsScaling || []), ...(mixed.intersectionsDamage || [])];

        const interp = (fromV, toV, appear, disappear) => {
            if (appear) return e * toV;
            if (disappear) return (1 - e) * fromV;
            return (1 - e) * fromV + e * toV;
        };

        const irDamage = interp(fromIRD, toIRD, damageAppearing, damageDisappearing);
        const irScaling = interp(fromIRS, toIRS, scalingAppearing, scalingDisappearing);
        mixed.intersectionRevealDamage = irDamage;
        mixed.intersectionRevealScaling = irScaling;
        mixed.intersectionReveal = Math.max(irDamage, irScaling);

        const packs = [
            ['base','hp',     fromSeries.base.hp,     toSeries.base.hp,     appearBase,    disappearBase],
            ['base','sh',     fromSeries.base.sh,     toSeries.base.sh,     appearBase,    disappearBase],
            ['exDef','hp',    fromSeries.exDef.hp,    toSeries.exDef.hp,    appearExDef,   disappearExDef],
            ['exDef','sh',    fromSeries.exDef.sh,    toSeries.exDef.sh,    appearExDef,   disappearExDef],
            ['exNoDef','hp',  fromSeries.exNoDef.hp,  toSeries.exNoDef.hp,  appearExNoDef, disappearExNoDef],
            ['exNoDef','sh',  fromSeries.exNoDef.sh,  toSeries.exNoDef.sh,  appearExNoDef, disappearExNoDef],
            ['og','vals',     fromSeries.og,          toSeries.og,          ogAppearing,   ogDisappearing],
            ['damage','vals', fromSeries.damage.vals, toSeries.damage.vals, appearDamage,  disappearDamage],
            ['scaling','vals',fromSeries.scaling?.vals || [], toSeries.scaling?.vals || [], appearScaling, disappearScaling],
            ['ehp','vals',    fromSeries.ehp.vals,    toSeries.ehp.vals,    appearEHP,     disappearEHP],
        ];

        packs.forEach(([group, key, fa, tb, appearing, disappearing]) => {
            let reveal = 1;

            if (mode.unfold) reveal = e;
            if (appearing)   reveal = e;
            if (disappearing) reveal = 1 - e;

            const valObj = { from: fa, to: tb, reveal };

            if (group === 'base') {
                if (key === 'hp') mixed.base.hp = valObj;
                else              mixed.base.sh = valObj;
            } else if (group === 'exDef') {
                if (key === 'hp') mixed.exDef.hp = valObj;
                else              mixed.exDef.sh = valObj;
            } else if (group === 'exNoDef') {
                if (key === 'hp') mixed.exNoDef.hp = valObj;
                else              mixed.exNoDef.sh = valObj;
            } else if (group === 'og') {
                mixed.og = valObj;
            } else if (group === 'damage') {
                mixed.damage.vals = valObj;
            } else if (group === 'scaling') {
                mixed.scaling = mixed.scaling || {};
                mixed.scaling.vals = valObj;
            } else if (group === 'ehp') {
                mixed.ehp.vals = valObj;
            }
        });

        // Recompute a dynamic maxY from the mixed values to avoid any clipping during the transition.
        const sampleVal = (obj, i) => {
            if (!obj) return 0;
            if (obj.values) return obj.values[i] || 0;
            const fromV = obj.from ? obj.from[i] || 0 : 0;
            const toV   = obj.to   ? obj.to[i]   || 0 : 0;
            const base = (1 - e) * fromV + e * toV;
            const rev  = obj.reveal == null ? 1 : obj.reveal;
            return base * rev;
        };

        let dynMax = 0;
        const N = toSeries.xs.length;
        const consider = (enabled, obj) => {
            if (!enabled || !obj) return;
            for (let i=0;i<N;i++){
                const v = sampleVal(obj, i);
                if (v > dynMax) dynMax = v;
            }
        };
        const considerTarget = (enabled, arr) => {
            if (!enabled || !arr) return;
            for (let i=0;i<arr.length;i++){
                const v = arr[i] || 0;
                if (v > dynMax) dynMax = v;
            }
        };

        consider(mixed.base.enabled, mixed.base.hp);
        consider(mixed.base.enabled && mixed.hasShield, mixed.base.sh);
        consider(mixed.exDef.enabled, mixed.exDef.hp);
        consider(mixed.exDef.enabled && mixed.hasShield, mixed.exDef.sh);
        consider(mixed.exNoDef.enabled, mixed.exNoDef.hp);
        consider(mixed.exNoDef.enabled && mixed.hasShield, mixed.exNoDef.sh);
        consider(mixed.ogEnabled, mixed.og);
        consider(mixed.damage.enabled, mixed.damage.vals);
        consider(mixed.scaling && mixed.scaling.enabled, mixed.scaling?.vals);
        consider(mixed.ehp.enabled, mixed.ehp.vals);

        // Ensure axis accounts for full target curves when new series are appearing.
        considerTarget(toSeries.base.enabled, toSeries.base.hp);
        considerTarget(toSeries.base.enabled && mixed.hasShield, toSeries.base.sh);
        considerTarget(toSeries.exDef.enabled, toSeries.exDef.hp);
        considerTarget(toSeries.exDef.enabled && mixed.hasShield, toSeries.exDef.sh);
        considerTarget(toSeries.exNoDef.enabled, toSeries.exNoDef.hp);
        considerTarget(toSeries.exNoDef.enabled && mixed.hasShield, toSeries.exNoDef.sh);
        considerTarget(toSeries.ogEnabled, toSeries.og);
        considerTarget(toSeries.damage.enabled, toSeries.damage.vals);
        considerTarget(toSeries.scaling && toSeries.scaling.enabled, toSeries.scaling?.vals);
        considerTarget(toSeries.ehp.enabled, toSeries.ehp.vals);

        // Interpolate axis from previous to target (use dynMax to include in-progress reveals), easing both up and down.
        const targetMax = Math.max(toSeries.maxY || 10, dynMax);
        mixed.maxY = (1 - e) * fromSeries.maxY + e * targetMax;

        currentBlend = mixed;
        currentMixE = e;
        drawImmediate(mixed, e);

        if (t < 1) {
            animId = requestAnimationFrame(step);
        } else {
            const finalized = {
                xs: toSeries.xs,
                start: toSeries.start,
                end: toSeries.end,
                maxY: toSeries.maxY,
                hasShield: toSeries.hasShield,
                base: {
                    enabled: toSeries.base.enabled,
                    hp: wrapValues(toSeries.base.hp, 1),
                    sh: wrapValues(toSeries.base.sh, 1)
                },
                exDef: {
                    enabled: toSeries.exDef.enabled,
                    hp: wrapValues(toSeries.exDef.hp, 1),
                    sh: wrapValues(toSeries.exDef.sh, 1)
                },
                exNoDef: {
                    enabled: toSeries.exNoDef.enabled,
                    hp: wrapValues(toSeries.exNoDef.hp, 1),
                    sh: wrapValues(toSeries.exNoDef.sh, 1)
                },
                og: wrapValues(toSeries.og, 1),
                ogEnabled: toSeries.ogEnabled,
                damage: {
                    enabled: toSeries.damage.enabled,
                    vals: wrapValues(toSeries.damage.vals, 1)
                },
                scaling: {
                    enabled: (toSeries.scaling && toSeries.scaling.enabled) || false,
                    vals: wrapValues(toSeries.scaling && toSeries.scaling.vals ? toSeries.scaling.vals : [], 1)
                },
                ehp: {
                    enabled: toSeries.ehp.enabled,
                    vals: wrapValues(toSeries.ehp.vals, 1)
                },
                intersections: toSeries.intersections,
                intersectionsDamage: toSeries.intersectionsDamage,
                intersectionsScaling: toSeries.intersectionsScaling,
                intersectionReveal: toSeries.intersectionReveal,
                intersectionRevealDamage: toSeries.intersectionRevealDamage,
                intersectionRevealScaling: toSeries.intersectionRevealScaling,
                scalingAboveEhp: toSeries.scalingAboveEhp,
                activeIntersection: toSeries.activeIntersection,
                activeIntersectionSource: toSeries.activeIntersectionSource
            };
            currentBlend = finalized;
            currentMixE = 1;
            drawImmediate(finalized, 1);
        }
    };

    animId = requestAnimationFrame(step);
}

// Rebuild series for new params/toggles and drive the transition animation.
function animateTo(params, toggles, duration=500, mode={}, toSeries=null) {
    const targetSeries = toSeries || (toSeries && toSeries.comparison ? toSeries : buildAllSeries(params, toggles, null, { trackMaxY: false, snapUp: false }));
    let fromSeries;

    if (targetSeries.comparison) {
    // Use the current blend if we're already in comparison mode and shapes match
    if (mode.unfold) {
        fromSeries = buildComparisonSeed(targetSeries);
    } else if (currentBlend && currentBlend.comparison) {
        if (currentBlend.xs.length === targetSeries.xs.length) {
        fromSeries = currentBlend;
        } else {
        fromSeries = resampleComparisonSeries(currentBlend, targetSeries.xs) || buildComparisonSeed(targetSeries);
        }
    } else if (currentBlend && !currentBlend.comparison) {
        // If coming from normal view, bridge using the current faction so the curve doesn't pop from zero
        fromSeries = buildComparisonBridgeFromNormal(currentBlend, targetSeries, params);
    } else {
        // Fallback: zeroed seed
        fromSeries = buildComparisonSeed(targetSeries);
    }
    } else {
    if (mode.unfold) {
        const zeros = rebuildAtXs(targetSeries.xs, params, { baseOn:false, exDefOn:false, exNoDefOn:false, damageOn:false, ehpOn:false });
        zeros.start = targetSeries.start;
        zeros.end = targetSeries.end;
        zeros.maxY = targetSeries.maxY;
        fromSeries = zeros;
    } else {
        // If we're coming from comparison mode, bridge using its axes to avoid jumps
        if (currentBlend && currentBlend.comparison) {
        const bridge = buildNormalBridgeFromComparison(currentBlend, params, toggles);
        fromSeries = bridge || targetSeries;
        } else if (!currentParams) {
        fromSeries = targetSeries;
        } else {
        const prevSeries = buildAllSeries(currentParams, currentToggles);
        // Resample the previous series across the new xs so the curve morphs instead of snapping.
        const prevStart = prevSeries.start;
        const prevEnd = prevSeries.end;
        const targetXs = targetSeries.xs;
        const mappedXs = targetXs.map(x => {
            const t = (targetSeries.end === targetSeries.start) ? 0 : (x - targetSeries.start) / (targetSeries.end - targetSeries.start);
            return prevStart + t * (prevEnd - prevStart);
        });
        fromSeries = rebuildAtXs(mappedXs, currentParams, currentToggles);
        // Align axes to the target range for drawing.
        fromSeries.start = targetSeries.start;
        fromSeries.end = targetSeries.end;
        }
    }
    // Leaving comparison mode; reset smoothed maxY so it recalculates next time.
    axisState.compare = { maxY: null, start: null, end: null };
    axisState.base = { maxY: null, start: null, end: null };
    }
    currentParams = params;
    currentToggles = toggles;
    // Seed base axis state from the previous series if it is empty, so upward moves can ease instead of snapping.
    if (!targetSeries.comparison && (!axisState.base || axisState.base.maxY == null) && fromSeries) {
    axisState.base = {
        maxY: fromSeries.maxY,
        start: fromSeries.start,
        end: fromSeries.end
    };
    }
    animateFromTo(fromSeries, targetSeries, duration, mode);
}

function animateComparison(fromSeries, toSeries, duration=500) {
    const startTime = performance.now();
    cancelAnimationFrame(animId);

    const mapFrom = new Map();
    if (fromSeries && fromSeries.factions) {
    fromSeries.factions.forEach(fc => mapFrom.set(fc.faction, fc));
    }

    const step = (now) => {
    const t = Math.min(1, (now - startTime) / duration);
    const e = easeInOutCubic(t);

    const mixMaxY = (fromSeries ? (1 - e) * fromSeries.maxY : 0) + e * toSeries.maxY;

    const mixedFactions = toSeries.factions.map(fc => {
        const prev = mapFrom.get(fc.faction);
        if (!prev || !prev.vals || prev.vals.length !== fc.vals.length) {
        return { ...fc, vals: fc.vals.slice() };
        }
        const vals = new Array(fc.vals.length);
        for (let i=0;i<vals.length;i++){
        vals[i] = (1 - e) * prev.vals[i] + e * fc.vals[i];
        }
        return { ...fc, vals };
    });

    const mixed = { ...toSeries, factions: mixedFactions, maxY: mixMaxY };
    drawImmediate(mixed, 1);

    if (t < 1) {
        animId = requestAnimationFrame(step);
    } else {
        currentBlend = toSeries;
    }
    };

    animId = requestAnimationFrame(step);
}

// ---------- Params & toggles ----------
// Read current form values (with basic clamping) so calculations don't need to touch the DOM.
function readParams() {
    
    // Clamping Base Armor for values under 200 and over 1000
    let ba = parseInt(baseArmorEl.value || "0");
    if (ba < 0) ba = 0;
    if (ba > 1000) ba = 1000;
    if (ba > 0 && ba < 200) ba = 200;
    
    const abilityStrengthPct = Math.max(0, parseFloat(abilityStrengthEl?.value || '100'));
    const abilityStrengthMul = abilityStrengthPct / 100;
    const abilityDamagePct = Math.max(0, parseFloat(abilityDamageEl?.value || '0'));
    const toxinDamagePct = Math.max(0, parseFloat(toxinDamageEl?.value || '0'));
    const wfBaseArmor = Math.max(0, parseFloat(wfBaseArmorEl?.value || '0'));
    const wfArmorIncreasePct = Math.max(0, parseFloat(wfArmorIncreaseEl?.value || '0'));
    const wfArmorAdded = Math.max(0, parseFloat(wfArmorAddedEl?.value || '0'));
    const nekrosMultDerived = 1.5 * abilityStrengthMul;
    const damageDecoyMultDerived = 3.5 * abilityStrengthMul;
    const nourishBase = (nourishSubsumeEl?.checked ? 0.45 : 0.75);
    const roarPrecision = !!roarPrecisionIntensifyEl?.checked;
    const nourishPrecision = !!nourishPrecisionIntensifyEl?.checked;
    const roarAbilityStrengthPct = abilityStrengthPct + (roarPrecision ? 90 : 0);
    const nourishAbilityStrengthPct = abilityStrengthPct + (nourishPrecision ? 90 : 0);
    const nourishPct = nourishBase * nourishAbilityStrengthPct;
    const reapCountRaw = parseInt(reapEnemyCountEl?.value || '1', 10);
    const reapEnemyCount = Math.max(1, Math.min(20, Number.isFinite(reapCountRaw) ? reapCountRaw : 1));

    // If not reflective, radiation stacks do nothing
    const mode = getScalingMode();
    const radiationStacks = (mode === 'reflective')
        ? Math.max(0, Math.min(10, parseInt(radiationStacksEl?.value || '0')))
        : 0;

    const levelScaling = levelScalingEl?.value || 'none';
    const reflectiveAbility = reflectiveSelectEl?.value || 'none';
    const xAxisFromVal = parseInt(xAxisFromEl?.value || '', 10);
    const xAxisToVal = parseInt(xAxisToEl?.value || '', 10);
    const xAxisFrom = Number.isFinite(xAxisFromVal) ? xAxisFromVal : null;
    const xAxisTo = Number.isFinite(xAxisToVal) ? xAxisToVal : null;
    const yAxisMaxVal = parseInt(yAxisMaxEl?.value || '', 10);
    const yAxisMax = Number.isFinite(yAxisMaxVal) && yAxisMaxVal > 0 ? yAxisMaxVal : null;

    // Derived flags for toxin/true damage overrides based on selected abilities
    const levelScalingMode = levelScaling || 'none';
    const healthScalingMode = healthScalingSelectEl?.value || 'none';
    let trueToxinFlag = !!trueToxinEnabledEl?.checked;
    if (levelScalingMode === 'feast') {
        trueToxinFlag = true;
    }
    if (healthScalingMode === 'regurgitate') {
        const gastroOn = !!regurgitateGastroEnabledEl?.checked;
        trueToxinFlag = !gastroOn;
    }

    // Prefer the radio selection; only fall back to the dropdown when no mode is chosen.
    let scalingMode = getScalingMode();
    if (scalingMode !== 'level' && healthScalingMode && healthScalingMode !== 'none') {
        scalingMode = 'health';
    } else if (scalingMode !== 'health' && levelScalingMode && levelScalingMode !== 'none') {
        scalingMode = 'level';
    }

    const clampVal = (val, min, max) => {
    const num = Number.isFinite(val) ? val : 0;
    return Math.max(min, Math.min(max, num));
    };

    return {
    baseLevel: Math.max(1, parseInt(baseLevelEl.value || '1')),
    baseHealth: clampVal(parseInt(baseHealthEl.value || '0'), 1, 10000),
    baseShield: clampVal(parseInt(baseShieldEl.value || '0'), 0, 10000),
    baseArmor: ba,
    heatEnabled: !!heatEnabledEl.checked,
    corrosiveStacks: parseInt(corrosiveStacksEl.value || "0"),
    cpPct: parseInt(cpEl.value || "0"),
    baseDamage: Math.max(0, parseInt(baseDamageEl.value || '0')),
    statusStacks: Math.max(0, Math.min(10, parseInt(statusStacksEl.value || '0'))),
    radiationStacks,
    levelScaling,
    feastEnemyCount: Math.max(1, Math.min(5, parseInt(feastEnemyCountEl?.value || '1', 10))),
    mindControlPct: Math.max(0, parseInt(mindControlEl.value || '0')),
    mindControlEnabled: !!mindControlEnabledEl.checked,
    abilityStrengthPct,
    roarAbilityStrengthPct,
    nourishAbilityStrengthPct,
    abilityDamagePct,
    toxinDamagePct,
    wfBaseArmor,
    wfArmorIncreasePct,
    wfArmorAdded,
    ironSkinEnabled: (reflectiveAbility === 'iron_skin'),
    ironShrapnelEnabled: !!ironShrapnelEnabledEl?.checked,
    regurgitateGastroEnabled: !!regurgitateGastroEnabledEl?.checked,
    destructRank: Math.max(0, Math.min(5, parseInt(destructRankEl?.value || '5', 10))),
    destructPct: getDestructPct(Math.max(0, Math.min(5, parseInt(destructRankEl?.value || '5', 10)))),
    destructStacks: Math.max(0, parseInt(destructStacksEl?.value || '0', 10)),
    absorbEnabled: !!absorbEnabledEl?.checked,
    nekrosMult: nekrosMultDerived,
    nekrosEnabled: !!nekrosEnabledEl.checked,
    summWrath: parseInt(summWrathEl.value || '0'),
    summWrathEnabled: summWrathEnabledEl.checked,
    damageDecoyMult: damageDecoyMultDerived,
    damageDecoyEnabled: !!damageDecoyEnabledEl.checked,
    nourishEnabled: !!nourishEnabledEl.checked,
    nourishSubsume: !!nourishSubsumeEl.checked,
    nourishPrecisionIntensify: nourishPrecision,
    nourishPct,
    roarPrecisionIntensify: roarPrecision,
    atlasPetrifyEnabled: !!atlasPetrifyEnabledEl?.checked,
    calibanWrathEnabled: !!calibanWrathEnabledEl?.checked,
    equinoxRageEnabled: !!equinoxRageEnabledEl?.checked,
    garaMassEnabled: !!garaMassEnabledEl?.checked,
    garaSplinterEnabled: !!garaSplinterEnabledEl?.checked,
    jadeJudgementsEnabled: !!jadeJudgementsEnabledEl?.checked,
    khoraDomeEnabled: !!khoraDomeEnabledEl?.checked,
    nezhaChakramEnabled: !!nezhaChakramEnabledEl?.checked,
    novaPrimeEnabled: !!novaPrimeEnabledEl?.checked,
    oraxiaEmbraceEnabled: !!oraxiaEmbraceEnabledEl?.checked,
    qorvexWallEnabled: !!qorvexWallEnabledEl?.checked,
    yareliSeaEnabled: !!yareliSeaEnabledEl?.checked,
    yareliMerulinaEnabled: !!yareliMerulinaEnabledEl?.checked,
    coldWardEnabled: !!coldWardEnabledEl.checked,
    linkEnabled: !!linkEnabledEl.checked,
    reverseRotorEnabled: !!reverseRotorEnabledEl.checked,
    mesmerSkinEnabled: !!mesmerSkinEnabledEl.checked,
    thornsEnabled: !!thornsEnabledEl.checked,
    shatterShieldEnabled: !!shatterShieldEnabledEl.checked,
    malletEnabled: !!malletEnabledEl?.checked,
    trueToxinEnabled: trueToxinFlag,
    roarEnabled: !!roarEnabledEl.checked,
    roarSubsume: !!roarSubsumeEl.checked,
    trueDamageEnabled: !!trueDamageEnabledEl.checked,
    vaubanPassive: !!vaubanPassiveEl?.checked,
    overdriverEnabled: !!overdriverEnabledEl?.checked,
    arachneEnabled: !!arachneEnabledEl?.checked,
    arachneRank: clampArachneRank(arachneRankEl?.value),
    holsterAmpEnabled: !!holsterAmpEnabledEl?.checked,
    vigorousSwapEnabled: !!vigorousSwapEnabledEl?.checked,
    vastUntimeEnabled: !!graspVastUntimeEl?.checked,
    untimeRiftEnabled: !!graspUntimeRiftEl?.checked,
    healthScaling: healthScalingSelectEl?.value || 'none',
    smiteSingleEnabled: !!smiteSingleEnabledEl?.checked,
    smiteAoEEnabled: !!smiteAoEEnabledEl?.checked,
    smiteSubsumeEnabled: !!smiteSubsumeEnabledEl?.checked,
    smiteMfdEnabled: !!smiteMfdEl?.checked,
    reaveEnthrallEnabled: !!reaveEnthrallEl?.checked,
    reapEnemyCount,
    scalingMode,
    reflectiveAbility,
    xAxisFrom,
    xAxisTo,
    yAxisMax,
    targetLevel: Math.max(1, parseInt(targetLevelEl.value || '1')),
    faction: factionEl.value,
    enemyType: enemyTypeEl.value,
    enemyDifficulty: enemyDifficultyEl.value,
    };
}
function readToggles() {
    return {
    baseOn: !!showBaseEl.checked,
    exDefOn: !!showExDefEl.checked,
    exNoDefOn: !!showExNoDefEl.checked,
    damageOn: !!showDamageEl.checked,
    scalingOn: !!showScalingEl.checked,
    ehpOn: !!showEHPEl.checked,
    };
}

// ---------- Effective enemy type logic ----------
// Keep enemyType in sync with which series are shown so stats/plot reflect the visible variant.
function computeEffectiveEnemyType(params, toggles) {
    const exDefOn = toggles.exDefOn;
    const exNoDefOn = toggles.exNoDefOn;
    const baseOn = toggles.baseOn;
    let chosen = params.enemyType || 'normal';

    if (exDefOn || exNoDefOn) {
    if (exDefOn && exNoDefOn) {
        const hpDef  = healthEximusDefAt(params.targetLevel, params.baseLevel, params.faction, params.baseHealth);
        const hpNoDef = healthEximusNoDefAt(params.targetLevel, params.baseLevel, params.faction, params.baseHealth);
        chosen = hpDef >= hpNoDef ? 'eximus_def' : 'eximus_nodef';
    } else if (exDefOn) {
        chosen = 'eximus_def';
    } else if (exNoDefOn) {
        chosen = 'eximus_nodef';
    }
    } else {
    chosen = 'normal';
    }
    return chosen;
}

function applyEffectiveEnemyType(params, toggles) {
    const chosen = computeEffectiveEnemyType(params, toggles);
    params.enemyType = chosen;
    if (enemyTypeEl && enemyTypeEl.value !== chosen) {
    enemyTypeEl.value = chosen;
    }
}

function syncDifficultyStickyFromMain() {
    if (!steelPathSticky) return;
    steelPathSticky.checked = (enemyDifficultyEl?.value === 'steel');
}

function updateReflectiveDerivedDisplays(params) {
    // Precompute parts once for consistent displays
    const reflectiveParts = buildReflectiveMultiplierParts(params, { useNourish: false });
    updateVulnerabilityDisplays(params);
    updateVulnerabilityDisplays(params);

    // Sync select to current active reflective toggle
    if (reflectiveSelectEl) {
    // Prefer the currently selected/serialized value so Iron Skin does not get cleared.
    let selectedKey = params.reflectiveAbility || reflectiveSelectEl.value || 'none';
    if (selectedKey === 'none') {
        if (mindControlEnabledEl?.checked) selectedKey = 'mind_control';
        else if (nekrosEnabledEl?.checked) selectedKey = 'nekros';
        else if (damageDecoyEnabledEl?.checked) selectedKey = 'damage_decoy';
        else if (malletEnabledEl?.checked) selectedKey = 'mallet';
        else if (accuseEnabledEl?.checked) selectedKey = 'accuse';
        else if (coldWardEnabledEl?.checked) selectedKey = 'cold_ward';
        else if (linkEnabledEl?.checked) selectedKey = 'link';
        else if (reverseRotorEnabledEl?.checked) selectedKey = 'reverse_rotor';
        else if (mesmerSkinEnabledEl?.checked) selectedKey = 'mesmer_skin';
        else if (thornsEnabledEl?.checked) selectedKey = 'thorns';
        else if (shatterShieldEnabledEl?.checked) selectedKey = 'shatter_shield';
        else if (absorbEnabledEl?.checked) selectedKey = 'absorb';
    }
    reflectiveSelectEl.value = selectedKey;
    }

    // Flechette damage display
    updateLevelScalingUI(params);
    updateHealthScalingUI(params);

    if (nekrosMultDisplayEl) {
    const nek = params.nekrosMult;
    nekrosMultDisplayEl.textContent = `${nek.toFixed(2)}x`;
    }
    if (damageDecoyDisplayEl) {
    const decoyMul = params.damageDecoyMult;
    const pct = decoyMul * 100;
    damageDecoyDisplayEl.textContent = `${pct.toFixed(0)}%`;
    }
    if (roarDisplayEl) {
    const base = params.roarSubsume ? 0.3 : 0.5;
    const roarStrength = getRoarStrengthPct(params);
    const pct = base * roarStrength;
    roarDisplayEl.textContent = `${pct.toFixed(0)}%`;
    }
    if (nourishDisplayEl) {
    const base = params.nourishSubsume ? 0.45 : 0.75;
    const nourishStrength = getNourishStrengthPct(params);
    const pct = base * nourishStrength;
    nourishDisplayEl.textContent = `${pct.toFixed(0)}%`;
    }
    if (coldWardDisplayEl) {
    const mult = 3 * Math.max(0, 1 + ((params.abilityStrengthPct || 0) - 100) / 100);
    coldWardDisplayEl.textContent = `${mult.toFixed(2)}x`;
    }
    if (linkDisplayEl) {
    const multPct = 75;
    linkDisplayEl.textContent = `${multPct.toFixed(0)}%`;
    }
    if (reverseRotorDisplayEl) {
    const mult = Math.min(0.75, 0.35 * Math.max(0, 1 + ((params.abilityStrengthPct || 0) - 100) / 100));
    reverseRotorDisplayEl.textContent = `${(mult * 100).toFixed(0)}%`;
    }
    if (thornsDisplayEl) {
    const mult = params.thornsEnabled ? 0.5 : 0.5; // fixed 50%
    thornsDisplayEl.textContent = `${(mult * 100).toFixed(0)}%`;
    }
    if (shatterShieldDisplayEl) {
    const mult = params.shatterShieldEnabled ? 1.0 : 1.0; // fixed 100%
    shatterShieldDisplayEl.textContent = `${(mult * 100).toFixed(0)}%`;
    }

    // Optional combined reflective multiplier display if needed in future:
    // const totalEl = document.getElementById('reflectiveTotalDisplay');
    // if (totalEl) totalEl.textContent = `${reflectiveParts.total.toFixed(2)}x`;
}

// ---------- Outputs + wiring ----------
// Update summary cards and plot labels for the current target level.
let firstOutputs = true;
function updateOutputs(params, seriesForNote=null) {
const {
    baseLevel, baseHealth, baseShield, baseArmor,
    baseDamage, statusStacks, mindControlPct, mindControlEnabled, nekrosMult, nekrosEnabled,
    targetLevel, faction, enemyType, enemyDifficulty
    } = params;

    const diffMul = difficultyFactor(enemyDifficulty);
    const hasShieldScaling = factionHasShieldScaling(faction);
    
    const armorInfo = scaledArmorWithStrip(targetLevel, params);
    const netArmor = armorInfo.netArmor;
    const armorDR  = armorInfo.dr;
    const useTrueDamage = !!params.trueDamageEnabled;

    let hp, sh;
    if (enemyType === 'eximus_def') {
    hp = healthEximusDefAt(targetLevel, baseLevel, faction, baseHealth);
    sh = shieldEximusAt(targetLevel, baseLevel, faction, baseShield);
    } else if (enemyType === 'eximus_nodef') {
    hp = healthEximusNoDefAt(targetLevel, baseLevel, faction, baseHealth);
    sh = 0;
    } else {
    hp = healthAt(targetLevel, baseLevel, faction, baseHealth);
    sh = shieldAt(targetLevel, baseLevel, faction, baseShield);
    }

    if (!hasShieldScaling) sh = 0;

    hp *= diffMul;
    sh *= diffMul;

    let og = 0;
    if (enemyType === 'eximus_def' || enemyType === 'eximus_nodef') {
    og = overguardAt(targetLevel);
    }

    // Fade control for Overguard summary
    const ogItem  = document.getElementById("sumOgItem");
    const ogValue = document.getElementById("sumOg");

    // Eximus = Overguard shown, Normal = hidden
    const eximusEnabled =
    (enemyType === 'eximus_def' || enemyType === 'eximus_nodef');

    if (eximusEnabled) {
    ogItem.classList.remove("hidden");

    if (firstOutputs) {
        snapNumber(ogValue, og, { decimals: 0 });
    } else {
        animateNumber(ogValue, og, { decimals: 0, duration: 550 });
    }
    } else {
    ogItem.classList.add("hidden");
    }

    if (firstOutputs) {
    lvlOut.textContent = String(targetLevel);
    lvlOut2.textContent = String(targetLevel);
    lvlOut3.textContent = String(targetLevel);
    lvlOut4.textContent = String(targetLevel);
    lvlOutDmg.textContent = String(targetLevel);
    if (lvlOutScaling) lvlOutScaling.textContent = String(targetLevel);
    } else {
    animateNumber(lvlOut,   targetLevel, { duration: 80 });
    animateNumber(lvlOut2,  targetLevel, { duration: 80 });
    animateNumber(lvlOut3,  targetLevel, { duration: 80 });
    animateNumber(lvlOut4,  targetLevel, { duration: 80 });
    animateNumber(lvlOutDmg,targetLevel, { duration: 80 });
    if (lvlOutScaling) animateNumber(lvlOutScaling, targetLevel, { duration: 80 });
    }

    // Update sticky Target Level display
    if (sumTargetLevelEl) {
    if (firstOutputs) {
        snapNumber(sumTargetLevelEl, targetLevel, { decimals: 0 });
    } else {
        animateNumber(sumTargetLevelEl, targetLevel, { decimals: 0, duration: 80 });
    }
    }

    const hpMul = hp / Math.max(1, baseHealth);

    shieldBlock.style.display = '';

    let shMul;
    if (useTrueDamage || params.trueToxinEnabled || !hasShieldScaling || baseShield === 0 || enemyType === 'eximus_nodef') {
    sh = 0;
    shMul = 0;
    } else {
    shMul = sh / Math.max(1, baseShield);
    }

    const smiteStIgnoresOG = (params.scalingMode === 'health' && params.healthScaling === 'smite' && params.smiteSingleEnabled);
    const ogForEhp = smiteStIgnoresOG ? 0 : og;
    const ogMul = og / Math.max(1, BASE_OVERGUARD);

    let armorEhpHealth = hp;
    if (!useTrueDamage && baseArmor > 0 && armorDR > 0 && armorDR < 0.99) {
    armorEhpHealth = hp / (1 - armorDR);
    }
    const ehp = useTrueDamage ? (armorEhpHealth + ogForEhp) : (armorEhpHealth + sh + ogForEhp);

    let dmgMul = 0;
    let dmg = 0;
    let scalingMulVal = 0;
    let scalingVal = 0;
    const vulnMul = vulnerabilityMultiplier(params);
    if (params.scalingMode === 'level') {
    const spec = getLevelScalingSpec(params.levelScaling);
    if (spec) {
        const scaledRaw = levelScalingDamageAtLevel(params, targetLevel) * vulnMul;
        let total = applyArmorDR(scaledRaw, armorDR);
        if (params.levelScaling === 'feast') {
        const dot = toxinDotFromInitial(scaledRaw, params);
        total += applyArmorDR(dot, armorDR);
        }
        scalingVal = total;
        scalingMulVal = spec.base > 0 ? (total / spec.base) : 0;
    } else {
        scalingVal = 0;
        scalingMulVal = 0;
    }
    // normal enemy damage still uses baseDamage
    if (baseDamage > 0) {
        const lvlMulDmg = damageMultiplier(targetLevel, baseLevel, faction);
        dmgMul = lvlMulDmg;
        dmg = baseDamage * lvlMulDmg;
    }
    } else if (params.scalingMode === 'reflective') {
    if (params.reflectiveAbility === 'absorb') {
        const dm = damageMultiplier(targetLevel, baseLevel, faction);
        const abilityDamageMul = 1 + Math.max(0, (params.abilityDamagePct || 0)) / 100;
        const roarBase = params.roarSubsume ? 0.3 : 0.5;
        const roarStrength = getRoarStrengthPct(params);
        const roarMul = params.roarEnabled ? (1 + roarBase * (roarStrength / 100)) : 1;
        const statusMul = statusDamageMultiplier(params.statusStacks);
        scalingVal = baseDamage > 0 ? baseDamage * dm * statusMul * abilityDamageMul * vulnMul * roarMul : 0;
        scalingMulVal = dm * statusMul * abilityDamageMul * vulnMul * roarMul;
        if (baseDamage > 0) {
        dmgMul = dm;
        dmg = baseDamage * dm;
        }
    } else if (params.reflectiveAbility === 'iron_skin') {
        const { dmg: ironSkinDmg } = ironSkinDetonationDamage(params, targetLevel, { vulnMul });
        scalingVal = params.ironShrapnelEnabled ? ironSkinDmg : 0;
        // Display a neutral 1x multiplier when active so the card is not zeroed out.
        scalingMulVal = params.ironShrapnelEnabled ? 1 : 0;
        if (baseDamage > 0) {
        const lvlMul = damageMultiplier(targetLevel, baseLevel, faction);
        dmgMul = lvlMul;
        dmg = baseDamage * lvlMul;
        }
    } else if (hasReflectiveSelection(params) && baseDamage > 0) {
        const lvlMul = damageMultiplier(targetLevel, baseLevel, faction);
        dmgMul = lvlMul;
        dmg = baseDamage * lvlMul;

        const scalingMul = scalingMultiplierFromParams(params);
        scalingMulVal = lvlMul * scalingMul;
        scalingVal = baseDamage * scalingMulVal;
    } else {
        scalingVal = 0;
        scalingMulVal = 0;
        if (baseDamage > 0) {
        const lvlMul = damageMultiplier(targetLevel, baseLevel, faction);
        dmgMul = lvlMul;
        dmg = baseDamage * lvlMul;
        }
    }
    } else if (params.scalingMode === 'health') {
    if (params.healthScaling === 'smite') {
        const smite = smiteDamageAtLevel(params, targetLevel, baseHealth, baseShield, faction);
        const mainVal = smite.main * vulnMul;
        const aoeVal = applyArmorDR(smite.aoe * vulnMul, armorDR);
        scalingVal = mainVal + aoeVal;
        scalingMulVal = 0;
    } else if (params.healthScaling === 'reave') {
        const reave = reaveDamageAtLevel(params, targetLevel, baseHealth, faction);
        scalingVal = reave.val * vulnMul;
        scalingMulVal = 0;
    } else if (params.healthScaling === 'reap_sow') {
        const reap = reapSowDamageAtLevel(params, targetLevel, baseHealth, baseShield, faction, { globalVuln: vulnMul });
        scalingVal = reap.total;
        scalingMulVal = 0;
    } else if (params.healthScaling === 'ew_toxin') {
        const ew = elementalWardToxinDamageAt(params, targetLevel);
        const initialRaw = ew * vulnMul;
        const initialFinal = applyArmorDR(initialRaw, armorDR);
        const dot = toxinDotFromInitial(initialRaw, params);
        scalingVal = initialFinal + applyArmorDR(dot, armorDR);
        scalingMulVal = 0;
    } else if (params.healthScaling === 'energy_vampire') {
        const ev = energyVampireDamageAt(params, targetLevel, baseHealth, faction);
        scalingVal = ev.val * vulnMul;
        scalingMulVal = 0;
    } else if (params.healthScaling === 'regurgitate') {
        const reg = regurgitateDamageAt(params);
        const initialRaw = reg.val * vulnMul;
        const initialFinal = applyArmorDR(initialRaw, armorDR);
        const dot = toxinDotFromInitial(initialRaw, params, { toxinEnabled: !params.regurgitateGastroEnabled });
        scalingVal = initialFinal + applyArmorDR(dot, armorDR);
        scalingMulVal = 0;
    } else {
        scalingVal = 0;
        scalingMulVal = 0;
    }
    if (baseDamage > 0) {
        const lvlMul = damageMultiplier(targetLevel, baseLevel, faction);
        dmgMul = lvlMul;
        dmg = baseDamage * lvlMul;
    }
    } else if (baseDamage > 0) {
    const lvlMul = damageMultiplier(targetLevel, baseLevel, faction);
    dmgMul = lvlMul;
    dmg = baseDamage * lvlMul;

    const scalingMul = scalingMultiplierFromParams(params);
    scalingMulVal = lvlMul * scalingMul;
    scalingVal = baseDamage * scalingMulVal;
    }

    if (firstOutputs) {
    snapNumber(hpOut, hp, { decimals: 0 });
    snapNumber(hpMulOut, hpMul, { decimals: 2, locale: false });
    snapNumber(shOut, sh, { decimals: 0 });
    snapNumber(shMulOut, shMul, { decimals: 2, locale: false });
    snapNumber(ogOut, og, { decimals: 0 });
    snapNumber(ogMulOut, ogMul, { decimals: 2, locale: false });
    snapNumber(armorOut, netArmor, { decimals: 0 });
    snapNumber(armorDROut, armorDR * 100, { decimals: 1, locale: false });
    snapNumber(ehpOut, ehp, { decimals: 0 });
    snapNumber(dmgOut, dmg, { decimals: 0 });
    snapNumber(dmgMulOut, dmgMul, { decimals: 2, locale: false });
    if (scalingOut) snapNumber(scalingOut, scalingVal, { decimals: 0 });
    if (scalingMulOut) snapNumber(scalingMulOut, scalingMulVal, { decimals: 2, locale: false });
    } else {
    animateNumber(hpOut, hp, { decimals: 0 });
    animateNumber(hpMulOut, hpMul, { decimals: 2, locale: false });
    animateNumber(shOut, sh, { decimals: 0 });
    animateNumber(shMulOut, shMul, { decimals: 2, locale: false });
    animateNumber(ogOut, og, { decimals: 0 });
    animateNumber(ogMulOut, ogMul, { decimals: 2, locale: false });
    animateNumber(armorOut, netArmor, { decimals: 0 });
    animateNumber(armorDROut, armorDR * 100, { decimals: 1, locale: false });
    animateNumber(ehpOut, ehp, { decimals: 0 });
    animateNumber(dmgOut, dmg, { decimals: 0 });
    animateNumber(dmgMulOut, dmgMul, { decimals: 2, locale: false });
    if (scalingOut) animateNumber(scalingOut, scalingVal, { decimals: 0 });
    if (scalingMulOut) animateNumber(scalingMulOut, scalingMulVal, { decimals: 2, locale: false });
    }

    if (firstOutputs) {
    snapNumber(sumHpEl, hp, { decimals: 0 });
    snapNumber(sumShieldEl, sh, { decimals: 0 });
    snapNumber(sumDREl, armorDR * 100, { decimals: 1, locale: false });
    snapNumber(sumEhpEl, ehp, { decimals: 0 });
    snapNumber(sumDmgEl, dmg, { decimals: 0 });
    if (sumScalingEl) snapNumber(sumScalingEl, scalingVal, { decimals: 0 });
    } else {
    animateNumber(sumHpEl, hp, { decimals: 0, duration: 550 });
    animateNumber(sumShieldEl, sh, { decimals: 0, duration: 550 });
    animateNumber(sumDREl, armorDR * 100, { decimals: 1, locale: false, duration: 550 });
    animateNumber(sumEhpEl, ehp, { decimals: 0, duration: 550 });
    animateNumber(sumDmgEl, dmg, { decimals: 0, duration: 550 });
    if (sumScalingEl) animateNumber(sumScalingEl, scalingVal, { decimals: 0, duration: 550 });
    }

    if (seriesForNote) {
    const parts = [];
    if (seriesForNote.scalingAboveEhp) {
        parts.push('Scaling damage stays above EHP for shown levels');
    }
    if (seriesForNote.intersectionsScaling && seriesForNote.intersectionsScaling.length) {
        const lvlS = seriesForNote.intersectionsScaling[seriesForNote.intersectionsScaling.length - 1].lvl.toFixed(1).replace(/\.0$/, '');
        parts.push('Scaling damage ~ EHP around level ' + lvlS);
    }
    if (seriesForNote.intersectionsDamage && seriesForNote.intersectionsDamage.length) {
        const lvlD = seriesForNote.intersectionsDamage[seriesForNote.intersectionsDamage.length - 1].lvl.toFixed(1).replace(/\.0$/, '');
        parts.push('Enemy damage ~ EHP around level ' + lvlD);
    }
    intersectionNoteEl.textContent = parts.join(' ; ');
    } else {
    intersectionNoteEl.textContent = '';
    }

    if (firstOutputs) firstOutputs = false;
}

// Central change handler: read inputs, recalc outputs, and animate the plot if visible.
function handleChange(trigger) {
    const params = readParams();
    updateReflectiveDerivedDisplays(params);
    updateLevelScalingUI(params);
    updateHealthScalingUI(params);
    const toggles = readToggles();
    // If visibility toggles changed, only reset smoothing when disabling a curve (shrink case).
    if (currentToggles) {
        const toggledOff =
        (currentToggles.baseOn && !toggles.baseOn) ||
        (currentToggles.exDefOn && !toggles.exDefOn) ||
        (currentToggles.exNoDefOn && !toggles.exNoDefOn) ||
        (currentToggles.damageOn && !toggles.damageOn) ||
        (currentToggles.scalingOn && !toggles.scalingOn) ||
        (currentToggles.ehpOn && !toggles.ehpOn);
        if (toggledOff) resetBaseAxisState();
    }

    const presetCompareOn = !!(abCompareToggle && abCompareToggle.checked && hasBothPresets());
    const compareOn = !!(compareModeEl && compareModeEl.checked);
    let compareMode = presetCompareOn ? 'preset' : (compareOn ? 'faction' : 'none');
    if (compareMode !== lastCompareMode) {
    triggerPlotWipe();
    triggerWipe(compareResultCard);
    if (compareMode === 'none') {
        axisState.compare = { maxY: null, start: null, end: null };
        axisState.preset = { maxY: null, start: null, end: null };
        lastCompareSignature = null;
        lastPresetCompareSignature = null;
        triggerWipe(resultCard);
    } else if (compareMode === 'preset') {
        axisState.compare = { maxY: null, start: null, end: null };
        lastCompareSignature = null;
    } else if (compareMode === 'faction') {
        axisState.preset = { maxY: null, start: null, end: null };
        lastPresetCompareSignature = null;
    }
    lastCompareMode = compareMode;
    }
    document.body.classList.toggle('compare-on', compareMode !== 'none');
    document.body.classList.toggle('ab-compare', compareMode === 'preset');

    applyEffectiveEnemyType(params, toggles);

    if (!currentParams || params.faction !== currentParams.faction) {
    setFactionBackground(params.faction);
    }
    if (compareMode === 'preset') {
    ensurePresetActive();
    const sig = getPresetCompareSignature(params);
    const sigChanged = sig !== lastPresetCompareSignature;
    if (sigChanged) {
        axisState.preset = { maxY: null, start: null, end: null };
        lastPresetCompareSignature = sig;
        triggerWipe(compareResultCard);
    }
    const toSeries = buildPresetComparisonSeries(params, { trackMaxY: !sigChanged });
    if (toSeries) {
        animateTo(params, toggles, 550, { unfold: false }, toSeries);
        setCompareCardsVisible(true);
        updateCompareOutputs(toSeries, params);
        currentParams = params;
        currentToggles = toggles;
        updateOutputs(params);
        return;
    } else {
        if (abCompareToggle) abCompareToggle.checked = false;
        lastCompareMode = 'none';
        lastPresetCompareSignature = null;
        axisState.preset = { maxY: null, start: null, end: null };
        document.body.classList.remove('compare-on');
        document.body.classList.remove('ab-compare');
        setCompareCardsVisible(false);
        compareMode = 'none';
    }
    }
    if (compareMode === 'faction') {
    const sig = getCompareSignature(params);
    const sigChanged = sig !== lastCompareSignature;
    if (sigChanged) {
        axisState.compare = { maxY: null, start: null, end: null };
        lastCompareSignature = sig;
        triggerWipe(compareResultCard);
    }
    const toSeries = buildComparisonSeries(params, { trackMaxY: !sigChanged });
    animateTo(params, toggles, 550, { unfold: false }, toSeries);
    setCompareCardsVisible(true);
    updateCompareOutputs(toSeries, params);
    currentParams = params;
    currentToggles = toggles;
    updateOutputs(params);
    return;
    }

    const previewSeries = buildAllSeries(params, toggles, null, { trackMaxY: false, snapUp: false });
    updateOutputs(params, previewSeries);
    setCompareCardsVisible(false);
    if (!plotVisible) { currentParams = params; currentToggles = toggles; return; }
    animateTo(params, toggles, 550, { unfold: false }, previewSeries);
}

let changeRAF = 0; let lastTrigger = 'input';
// Debounce multiple quick UI events so we only recompute once per frame.
function scheduleHandleChange(trigger) {
    lastTrigger = trigger || lastTrigger;
    if (changeRAF) cancelAnimationFrame(changeRAF);
    changeRAF = requestAnimationFrame(() => {
    changeRAF = 0;
    handleChange(lastTrigger);
    });
}

// ---------- Sliders + numeric inputs ----------
// Keep paired range/number controls in sync so they behave like a single input.
function bindSliderPair(rangeEl, numberEl) {
    if (!rangeEl || !numberEl) return;
    const syncFromRange = () => {
    numberEl.value = rangeEl.value;
    };
    const syncFromNumber = () => {
    const v = numberEl.value;
    if (v !== '') rangeEl.value = v;
    };
    rangeEl.addEventListener('input', () => { syncFromRange(); scheduleHandleChange('input'); });
    rangeEl.addEventListener('change', () => { syncFromRange(); scheduleHandleChange('change'); });
    numberEl.addEventListener('input', () => { syncFromNumber(); scheduleHandleChange('input'); });
    numberEl.addEventListener('change', () => { syncFromNumber(); scheduleHandleChange('change'); });
    syncFromRange();
}

bindSliderPair(baseLevelRangeEl, baseLevelEl);
bindSliderPair(targetLevelRangeEl, targetLevelEl);
bindSliderPair(baseHealthRangeEl, baseHealthEl);
bindSliderPair(baseShieldRangeEl, baseShieldEl);
bindSliderPair(baseArmorRangeEl, baseArmorEl);
bindSliderPair(corrosiveStacksRangeEl, corrosiveStacksEl);
bindSliderPair(cpRangeEl, cpEl);
bindSliderPair(baseDamageRangeEl, baseDamageEl);
bindSliderPair(mindControlRangeEl, mindControlEl);
bindSliderPair(summWrathRangeEl, summWrathEl);

// ---------- Target Level quick controls: hold to adjust ----------
let lvlStepInterval = null;
let lvlStepTimeout = null;

function changeLevel(by) {
    const current = parseInt(targetLevelEl.value || '1', 10) || 1;
    setTargetLevelFromControls(current + by);
}

function startHold(by) {
    // Step once immediately
    changeLevel(by);

    // After 350ms, start repeating
    lvlStepTimeout = setTimeout(() => {
    lvlStepInterval = setInterval(() => {
        changeLevel(by);
    }, 60); // speed of repeat
    }, 350);
}

function stopHold() {
    clearTimeout(lvlStepTimeout);
    clearInterval(lvlStepInterval);
    lvlStepTimeout = null;
    lvlStepInterval = null;
}

if (lvlUpBtn) {
    lvlUpBtn.addEventListener("mousedown", () => startHold(+1));
    lvlUpBtn.addEventListener("touchstart", () => startHold(+1));
}

if (lvlDownBtn) {
    lvlDownBtn.addEventListener("mousedown", () => startHold(-1));
    lvlDownBtn.addEventListener("touchstart", () => startHold(-1));
}

// Stop on release anywhere on screen
["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(ev => {
    document.addEventListener(ev, stopHold);
});

// ---------- Target Level quick controls: inline edit ----------

sumTargetLevelEl.addEventListener("dblclick", () => {
    // Enable contenteditable mode
    sumTargetLevelEl.setAttribute("contenteditable", "true");
    sumTargetLevelEl.focus();

    // Select all text for quick overwrite
    document.getSelection().selectAllChildren(sumTargetLevelEl);
});

// Save on Enter or blur
function finishEditingTargetLevel() {
    const raw = sumTargetLevelEl.textContent.trim();

    let newVal = parseInt(raw, 10);
    if (!isFinite(newVal)) newVal = 1;

    newVal = Math.max(1, Math.min(9999, newVal));

    // Disable editing mode
    sumTargetLevelEl.removeAttribute("contenteditable");

    // Update controls + recalc
    setTargetLevelFromControls(newVal);
}

// Enter key confirms
sumTargetLevelEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
    ev.preventDefault();
    finishEditingTargetLevel();
    }
});

// Click outside confirms
sumTargetLevelEl.addEventListener("blur", finishEditingTargetLevel);

// ---------- Legend chips ----------
const legendChips = document.querySelectorAll('.legend .chip[data-toggle]');
const presetLegendChips = document.querySelectorAll('.ab-compare-chips-row .chip[data-preset]');
const sectionList = Array.from(document.querySelectorAll('.section'));
const sectionIdToCode = Object.fromEntries(sectionList.map((sec, i) => [sec.id, i.toString(36)]));
const sectionCodeToId = Object.fromEntries(sectionList.map((sec, i) => [i.toString(36), sec.id]));

function syncChipStates() {
    legendChips.forEach(chip => {
    const id = chip.getAttribute('data-toggle');
    if (!id) return;
    const checkbox = document.getElementById(id);
    if (!checkbox) return;
    chip.classList.toggle('off', !checkbox.checked);
    });

    // Overguard chip opacity: dim if no Eximus scaling enabled
    const ogChip = document.querySelector('.legend .chip.overguard');
    if (ogChip) {
    const exDef = document.getElementById('showExDef').checked;
    const exNoDef = document.getElementById('showExNoDef').checked;
    ogChip.classList.toggle('off', !(exDef || exNoDef));
    }
}

function syncPresetChips() {
    presetLegendChips.forEach(chip => {
    const slot = chip.getAttribute('data-preset');
    const hasPreset = !!abPresets[slot];
    if (!hasPreset) presetActive.delete(slot);
    chip.classList.toggle('disabled', !hasPreset);
    chip.classList.toggle('off', !presetActive.has(slot));
    });
}

function ensurePresetActive() {
    if (presetActive.size > 0) return;
    if (abPresets.A) presetActive.add('A');
    if (abPresets.B) presetActive.add('B');
}

presetLegendChips.forEach(chip => {
    chip.addEventListener('click', () => {
    const slot = chip.getAttribute('data-preset');
    const hasPreset = !!abPresets[slot];
    if (!hasPreset) return;
    if (presetActive.has(slot)) presetActive.delete(slot);
    else presetActive.add(slot);
    syncPresetChips();
    scheduleHandleChange('change');
    });
});

legendChips.forEach(chip => {
    chip.addEventListener('click', () => {
    const id = chip.getAttribute('data-toggle');
    const checkbox = document.getElementById(id);
    if (!checkbox) return;

    checkbox.checked = !checkbox.checked;
    if (abCompareToggle && abCompareToggle.checked) abCompareToggle.checked = false;
    if (compareModeEl && compareModeEl.checked) compareModeEl.checked = false;
    syncChipStates();
    scheduleHandleChange('overlay');
    });
});

syncChipStates();
syncPresetChips();

// ---------- Collapsible sections (start COLLAPSED) ----------
document.querySelectorAll('.section').forEach(section => {
    const header = section.querySelector('.section-header');
    const body = section.querySelector('.section-body');

    // start collapsed
    section.classList.add('collapsed');
    body.style.maxHeight = '0px';

    header.addEventListener('click', () => {
    const collapsed = section.classList.toggle('collapsed');
    if (!collapsed) {
        body.style.maxHeight = body.scrollHeight + 'px';
    } else {
        body.style.maxHeight = '0px';
    }
    });
});

// Nested dropdown groups inside sections
const scalingDropdowns = Array.from(document.querySelectorAll('.dropdown-group[data-scaling-group]'));

document.querySelectorAll('.dropdown-group').forEach(group => {
    const header = group.querySelector('.dropdown-header');
    const body = group.querySelector('.dropdown-body');
    if (!header || !body) return;

    // start collapsed; keep height synced for smooth expand/collapse
    group.classList.add('collapsed');
    body.style.maxHeight = '0px';

    header.addEventListener('click', () => {
    const collapsed = group.classList.toggle('collapsed');
    if (collapsed) {
        body.style.maxHeight = '0px';
        return;
    }

    // Opening this group
    body.style.maxHeight = body.scrollHeight + 'px';

    // If this is a scaling damage dropdown, close the other scaling ones and set the mode.
    const mode = group.dataset.scalingGroup;
    if (mode) {
        scalingDropdowns.forEach(other => {
        if (other === group) return;
        const otherBody = other.querySelector('.dropdown-body');
        other.classList.add('collapsed');
        if (otherBody) otherBody.style.maxHeight = '0px';
        });
        setScalingModeFromGroup(mode);
    }
    });
});

// ---------- Share ----------
function encodeStateForShare(state) {
    const json = JSON.stringify(state);
    const compressed = lzCompress(json);
    const token = base64UrlEncode(compressed);
    return 'v3:' + token;
}

function decodeStateFromShare(token) {
    try {
    if (token.startsWith('v3:')) {
        const raw = token.slice(3);
        const bytes = base64UrlDecode(raw);
        const json = lzDecompress(bytes);
        return JSON.parse(json);
    }
    } catch (e) {
    /* fall through to legacy */
    }
    try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(padded)));
    return JSON.parse(json);
    } catch (e) {
    return null;
    }
}

function buildShareState({ includeDefaults = false } = {}) {
    const fieldsArr = [];
    const isDefault = (key, val) => {
    const spec = queryFields[key];
    if (!spec) return false;
    const def = spec.def;
    if (spec.bool) return (!!val) === (!!def);
    if (isFinite(def)) return Number(val) === Number(def);
    return String(val) === String(def);
    };

    Object.keys(queryFields).forEach(key => {
    const val = getFieldValue(key);
    if (val === null || val === undefined) return;
    if (!includeDefaults && isDefault(key, val)) return;
    const spec = queryFields[key];
    let v = val;
    if (spec && spec.bool) v = val ? 1 : 0;
    if (isFinite(v)) v = Number(v);
    const code = fieldKeyToCode[key] || key;
    fieldsArr.push([code, v]);
    });

    // Only store collapsed sections (saves space)
    const collapses = [];
    document.querySelectorAll(".section").forEach(sec => {
    if (sec.classList.contains("collapsed")) {
        const code = sectionIdToCode[sec.id] || sec.id;
        collapses.push(code);
    }
    });

    // Only store plot visibility if hidden (default is visible)
    const plotVisible = plotCard.classList.contains("plot-visible");

    const compareOn = !!(compareModeEl && compareModeEl.checked);
    const compareMetric = (compareMetricEl && compareMetricEl.value) || 'health';
    const compareFactions = Array.from(compareActive);
    const compareDiffers = compareFactions.length !== factionList.length;

    // Legend/series toggles (store only when not default: base=true, others=false) as bitmask
    let legendMask = 0;
    if (showBaseEl && !showBaseEl.checked) legendMask |= 1 << 0;
    if (showExDefEl && showExDefEl.checked) legendMask |= 1 << 1;
    if (showExNoDefEl && showExNoDefEl.checked) legendMask |= 1 << 2;
    if (showDamageEl && showDamageEl.checked) legendMask |= 1 << 3;
    if (showScalingEl && showScalingEl.checked) legendMask |= 1 << 4;
    if (showEHPEl && showEHPEl.checked) legendMask |= 1 << 5;

    return {
    v: 2,
    f: fieldsArr,
    c: includeDefaults ? collapses : (collapses.length ? collapses : undefined),
    p: includeDefaults ? (plotVisible ? 1 : 0) : (plotVisible ? undefined : 0),
    cm: includeDefaults ? (compareOn ? 1 : 0) : (compareOn ? 1 : undefined),
    m: includeDefaults ? compareMetric : (compareMetric !== 'health' ? compareMetric : undefined),
    cf: includeDefaults ? compareFactions : (compareOn && compareDiffers ? compareFactions : undefined),
    lg: includeDefaults ? legendMask : (legendMask ? legendMask : undefined)
    };
}

shareBtn.addEventListener("click", () => {
    const state = buildShareState();
    const token = encodeStateForShare(state);

    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('s', token);

    navigator.clipboard.writeText(url.toString());
    alert("Share link copied!");
});

function applyShareStateObject(state, { skipPlotVisibility = false } = {}) {
    loadingFromQuery = true;
    if (!state) {
    loadingFromQuery = false;
    return;
    }

    if (state && state.f) {
    if (Array.isArray(state.f)) {
        state.f.forEach(([code, val]) => {
        const key = fieldCodeToKey[code] || code;
        setField(key, val);
        });
    } else {
        Object.entries(state.f).forEach(([key, val]) => setField(key, val));
    }
    }
    if (state && state.c) {
    const collapsedSet = new Set();
    if (Array.isArray(state.c)) {
        state.c.forEach(code => {
        const id = sectionCodeToId[code] || code;
        collapsedSet.add(id);
        });
    } else {
        Object.keys(state.c).forEach(id => { if (state.c[id] === 1) collapsedSet.add(id); });
    }
    document.querySelectorAll(".section").forEach(sec => {
        const id = sec.id;
        const collapsed = collapsedSet.has(id);
        sec.classList.toggle("collapsed", collapsed);
        const body = sec.querySelector(".section-body");
        if (collapsed) {
        body.style.maxHeight = "0px";
        } else {
        body.style.maxHeight = body.scrollHeight + "px";
        }
    });
    }
    if (!skipPlotVisibility && state && typeof state.p !== "undefined") {
    const visible = state.p === 0 ? false : !!state.p;
    plotCard.classList.toggle("plot-visible", visible);
    togglePlotBtn.textContent = visible ? "Hide Plot" : "Show Plot";
    }
    if (state && typeof state.cm !== "undefined") {
    if (compareModeEl) compareModeEl.checked = state.cm === 1;
    }
    if (state && state.m && compareMetricEl) {
    compareMetricEl.value = state.m;
    }
    if (state && Array.isArray(state.cf)) {
    setCompareActive(state.cf);
    }
    if (state && state.lg !== undefined) {
    const mask = state.lg | 0;
    if (showBaseEl) showBaseEl.checked = (mask & (1 << 0)) === 0; // default on; bit set means off
    if (showExDefEl) showExDefEl.checked = !!(mask & (1 << 1));
    if (showExNoDefEl) showExNoDefEl.checked = !!(mask & (1 << 2));
    if (showDamageEl) showDamageEl.checked = !!(mask & (1 << 3));
    if (showScalingEl) showScalingEl.checked = !!(mask & (1 << 4));
    if (showEHPEl) showEHPEl.checked = !!(mask & (1 << 5));
    }

    updateMindControlEnabledState();
    updateNekrosEnabledState();
    updateSummWrathEnabledState();
    updateDamageDecoyEnabledState();
    updateRadiationEnabledState();
    if (reflectiveSelectEl && state && state.reflectiveAbility) {
    reflectiveSelectEl.value = state.reflectiveAbility;
    applyReflectiveSelection(state.reflectiveAbility);
    }
    enforceReflectiveExclusive();
    syncFactionStickyFromMain();
    syncChipStates();
    loadingFromQuery = false;
    scheduleHandleChange("load");
}

// ---------- Load from query params ----------
// Reads ?key=value into the UI (including collapse state) so shared links restore state.
function applyFromQuery() {
    const qp = new URLSearchParams(window.location.search);

    // Short-share decoding (s=<token>)
    if (qp.has('s')) {
    const token = qp.get('s');
    const state = decodeStateFromShare(token);
    applyShareStateObject(state);
    return;
    }

    loadingFromQuery = true;

    const num = (v, def = 0) => (v !== null ? parseFloat(v) : def);

    // ---- Basic inputs from query ----
    Object.entries(queryFields).forEach(([key, spec]) => {
        if (!qp.has(key)) return;
        const raw = qp.get(key);
        const value = spec.bool ? raw === "1" : num(raw, spec.def);
        setField(key, value);
    });

    // ---- Collapse states ----
    document.querySelectorAll(".section").forEach(sec => {
        const id = sec.id;
        if (qp.has(id)) {
            const collapsed = qp.get(id) === "1";
            sec.classList.toggle("collapsed", collapsed);

            const body = sec.querySelector(".section-body");
            if (collapsed) {
                body.style.maxHeight = "0px";
            } else {
                body.style.maxHeight = body.scrollHeight + "px";
            }
        }
    });

    // ---- Plot visibility ----
    if (qp.has("plot")) {
        const visible = qp.get("plot") === "1";
        plotCard.classList.toggle("plot-visible", visible);
        togglePlotBtn.textContent = visible ? "Hide Plot" : "Show Plot";
    }
    if (qp.has("compareOn")) {
        if (compareModeEl) compareModeEl.checked = qp.get("compareOn") === "1";
    }
    if (qp.has("compareMetric") && compareMetricEl) {
        compareMetricEl.value = qp.get("compareMetric");
    }
    if (qp.has("compareFactions")) {
        const list = qp.get("compareFactions").split(",").filter(Boolean);
        setCompareActive(list);
    }
    if (qp.has("lg")) {
        const mask = parseInt(qp.get("lg"), 10);
        if (Number.isFinite(mask)) {
        if (showBaseEl) showBaseEl.checked = (mask & (1 << 0)) === 0;
        if (showExDefEl) showExDefEl.checked = !!(mask & (1 << 1));
        if (showExNoDefEl) showExNoDefEl.checked = !!(mask & (1 << 2));
        if (showDamageEl) showDamageEl.checked = !!(mask & (1 << 3));
        if (showScalingEl) showScalingEl.checked = !!(mask & (1 << 4));
        if (showEHPEl) showEHPEl.checked = !!(mask & (1 << 5));
        }
    }

    // ---- Enable/disable states for multipliers ----
    updateMindControlEnabledState();
    updateNekrosEnabledState();
    updateSummWrathEnabledState();
    updateDamageDecoyEnabledState();
    updateRadiationEnabledState();
    if (reflectiveSelectEl) {
        const qpRef = qp.get("reflectiveAbility");
        if (qpRef) {
        reflectiveSelectEl.value = qpRef;
        applyReflectiveSelection(qpRef);
        }
    }
    enforceReflectiveExclusive();

    syncChipStates();
    syncFactionStickyFromMain();

    loadingFromQuery = false;
    scheduleHandleChange("load");
}

// ---------- Preset A/B helpers ----------
const AB_STORAGE_KEY = 'wf_ab_presets_v1';
let abToastTimer = null;

function hasPreset(slot) { return !!(abPresets && abPresets[slot]); }
function hasBothPresets() { return hasPreset('A') && hasPreset('B'); }

function formatAgo(ts) {
    if (!ts) return '';
    const delta = Math.max(0, Date.now() - ts);
    if (delta < 45 * 1000) return 'just now';
    const mins = Math.floor(delta / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function formatPresetStatus(preset) {
    if (!preset) return 'Empty';
    const label = (preset.label && preset.label.trim()) ? preset.label.trim() : 'Saved';
    const ago = formatAgo(preset.savedAt);
    return ago ? `${label} - ${ago}` : label;
}

function setAbToast(text) {
    if (!abToast) return;
    if (abToastTimer) clearTimeout(abToastTimer);
    abToast.textContent = text || '';
    if (text) {
    abToastTimer = setTimeout(() => { abToast.textContent = ''; }, 2200);
    }
}

function persistAbPresets() {
    try {
    localStorage.setItem(AB_STORAGE_KEY, JSON.stringify({ version: 1, presets: abPresets }));
    } catch (e) {
    /* ignore storage errors */
    }
}

function loadAbPresetsFromStorage() {
    try {
    const raw = localStorage.getItem(AB_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.presets) {
        abPresets = {
        A: parsed.presets.A || null,
        B: parsed.presets.B || null
        };
    }
    } catch (e) {
    abPresets = { A: null, B: null };
    }
}

function updateAbUi() {
    const aPreset = abPresets.A;
    const bPreset = abPresets.B;
    if (abStatusA) abStatusA.textContent = formatPresetStatus(aPreset);
    if (abStatusB) abStatusB.textContent = formatPresetStatus(bPreset);
    if (abLoadA) abLoadA.disabled = !aPreset;
    if (abLoadB) abLoadB.disabled = !bPreset;
    if (abClearA) abClearA.disabled = !aPreset;
    if (abClearB) abClearB.disabled = !bPreset;
    if (abCompareToggle) {
    const ready = hasBothPresets();
    abCompareToggle.disabled = !ready;
    if (!ready) abCompareToggle.checked = false;
    }
    if (aPreset) presetActive.add('A');
    if (bPreset) presetActive.add('B');
    if (abLabelA && (document.activeElement !== abLabelA || !abLabelA.value)) {
    abLabelA.value = (aPreset && aPreset.label) ? aPreset.label : '';
    }
    if (abLabelB && (document.activeElement !== abLabelB || !abLabelB.value)) {
    abLabelB.value = (bPreset && bPreset.label) ? bPreset.label : '';
    }
    syncPresetChips();
}

function snapshotPreset(slot) {
    const labelEl = slot === 'A' ? abLabelA : abLabelB;
    const label = (labelEl?.value || '').trim();
    const params = readParams();
    const toggles = readToggles();
    applyEffectiveEnemyType(params, toggles);
    return {
    version: 1,
    label,
    savedAt: Date.now(),
    state: buildShareState({ includeDefaults: true }),
    params,
    toggles
    };
}

function savePresetSlot(slot) {
    abPresets[slot] = snapshotPreset(slot);
    presetActive.add(slot);
    persistAbPresets();
    updateAbUi();
    setAbToast(`Saved to ${slot}${abPresets[slot].label ? ` (${abPresets[slot].label})` : ''}`);
    scheduleHandleChange('change');
}

function applyPresetSlot(slot) {
    const preset = abPresets[slot];
    if (!preset) {
    setAbToast(`Preset ${slot} is empty`);
    return;
    }
    applyShareStateObject(preset.state || null, { skipPlotVisibility: true });
    if (preset.params?.scalingMode) {
    setScalingMode(preset.params.scalingMode);
    }
    presetActive.add(slot);
    ensurePresetActive();
    syncPresetChips();
    setAbToast(`Loaded ${slot}${preset.label ? ` (${preset.label})` : ''}`);
    scheduleHandleChange('change');
}

function clearPresetSlot(slot) {
    abPresets[slot] = null;
    persistAbPresets();
    updateAbUi();
    setAbToast(`Cleared ${slot}`);
    if (abCompareToggle && abCompareToggle.checked && !hasBothPresets()) {
    abCompareToggle.checked = false;
    }
    scheduleHandleChange('change');
}

function copyPreset(from, to) {
    const src = abPresets[from];
    if (!src) {
    setAbToast(`Preset ${from} is empty`);
    return;
    }
    abPresets[to] = JSON.parse(JSON.stringify(src));
    abPresets[to].savedAt = Date.now();
    persistAbPresets();
    updateAbUi();
    setAbToast(`Copied ${from} to ${to}`);
    scheduleHandleChange('change');
}

function swapPresets() {
    const temp = abPresets.A;
    abPresets.A = abPresets.B;
    abPresets.B = temp;
    persistAbPresets();
    updateAbUi();
    setAbToast('Swapped A/B');
    scheduleHandleChange('change');
}

function resetAllPresets() {
    abPresets = { A: null, B: null };
    persistAbPresets();
    presetActive.clear();
    if (abCompareToggle) abCompareToggle.checked = false;
    updateAbUi();
    setAbToast('Presets reset');
    scheduleHandleChange('change');
}

// ---------- Non-slider inputs ----------
[enemyTypeEl, enemyDifficultyEl, factionEl].forEach(el => {
    el.addEventListener('change', () => {
    if (el === enemyTypeEl) {
        const type = enemyTypeEl.value;

        if (type === 'normal') {
        showBaseEl.checked   = true;
        showExDefEl.checked  = false;
        showExNoDefEl.checked = false;
        } else if (type === 'eximus_def') {
        showBaseEl.checked   = false;
        showExDefEl.checked  = true;
        showExNoDefEl.checked = false;
        } else if (type === 'eximus_nodef') {
        showBaseEl.checked   = false;
        showExDefEl.checked  = false;
        showExNoDefEl.checked = true;
        }

        syncChipStates();
    }
    if (el === factionEl) {
        syncFactionStickyFromMain();
    }
    if (el === enemyDifficultyEl) {
        syncDifficultyStickyFromMain();
    }
    scheduleHandleChange('change');
    });
});

if (factionEl && factionSticky) {
    factionEl.addEventListener('change', () => {
        if (factionSticky) factionSticky.value = factionEl.value;
        scheduleHandleChange('change');
    });
    factionSticky.addEventListener('change', () => {
        if (factionEl) factionEl.value = factionSticky.value;
        scheduleHandleChange('change');
    });
}

if (steelPathSticky) {
    steelPathSticky.addEventListener('change', () => {
    if (enemyDifficultyEl) enemyDifficultyEl.value = steelPathSticky.checked ? 'steel' : 'normal';
    scheduleHandleChange('change');
    });
}


// ---------- Initial render ----------
// Start background layers in a neutral state
bgA.style.background = factionGradients.default;
bgB.style.background = factionGradients.default;
bgA.classList.add('on');
bgB.classList.remove('on');
bgOnA = true;

fitCanvas();

loadAbPresetsFromStorage();
updateAbUi();

// Capture the pristine state (before applying share/query overrides) for resets
initialShareState = buildShareState({ includeDefaults: true });

applyFromQuery();
syncFactionStickyFromMain();
syncDifficultyStickyFromMain();

// Restoring Plot State (animate on first open)
const qp = new URLSearchParams(location.search);
targetPlotVisible = qp.has("plot") ? qp.get("plot") === "1" : true;

const syncPlotUi = (visible) => {
        plotCard.classList.toggle("plot-visible", visible);
        document.body.classList.toggle('plot-blur-on', visible);
        togglePlotBtn.textContent = visible ? "Hide Plot" : "Show Plot";
};

// Start collapsed; only embedded auto-opens immediately
if (targetPlotVisible && isEmbedded) {
        syncPlotUi(true);
} else {
        syncPlotUi(false);
}

let plotVisible = plotCard.classList.contains("plot-visible");

togglePlotBtn.addEventListener('click', () => {
        plotVisible = !plotVisible;
        syncPlotUi(plotVisible);

        if (plotVisible) {
        triggerPlotWipe();
            const params = readParams();
            const toggles = readToggles();
            applyEffectiveEnemyType(params, toggles);
            animateTo(params, toggles, 600, { unfold: true });
        }
});

// Ensure MC controls are disabled by default if not checked (no query)
updateMindControlEnabledState();
updateNekrosEnabledState();

// After applying query params, set background to current faction
setFactionBackground(factionEl.value);

// Re-enable transitions AFTER all states are applied
requestAnimationFrame(() => {
    document.body.classList.remove("no-animate");
    startSectionEntrance();
    // Safety: ensure fallback if prefade somehow remained
    document.body.classList.remove('calc-prefade');
});

let initialParams = readParams();
let initialToggles = readToggles();
applyEffectiveEnemyType(initialParams, initialToggles);
updateReflectiveDerivedDisplays(initialParams);
const initialSeries = buildAllSeries(initialParams, initialToggles);
updateOutputs(initialParams, initialSeries);
currentParams = initialParams;
currentToggles = initialToggles;
syncDifficultyStickyFromMain();

currentBlend = {
    xs: initialSeries.xs,
    start: initialSeries.start,
    end: initialSeries.end,
    maxY: initialSeries.maxY,
    hasShield: initialSeries.hasShield,

    base: {
        enabled: initialSeries.base.enabled,
        hp: { values: initialSeries.base.hp, reveal: 1 },
        sh: { values: initialSeries.base.sh, reveal: 1 }
    },
    exDef: {
        enabled: initialSeries.exDef.enabled,
        hp: { values: initialSeries.exDef.hp, reveal: 1 },
        sh: { values: initialSeries.exDef.sh, reveal: 1 }
    },
    exNoDef: {
        enabled: initialSeries.exNoDef.enabled,
        hp: { values: initialSeries.exNoDef.hp, reveal: 1 },
        sh: { values: initialSeries.exNoDef.sh, reveal: 1 }
    },

    og: { values: initialSeries.og, reveal: 1 },
    ogEnabled: initialSeries.ogEnabled,

    damage: {
        enabled: initialSeries.damage.enabled,
        vals: { values: initialSeries.damage.vals, reveal: 1 }
    },
    scaling: {
        enabled: initialSeries.scaling.enabled,
        vals: { values: initialSeries.scaling.vals, reveal: 1 }
    },
    ehp: {
        enabled: initialSeries.ehp.enabled,
        vals: { values: initialSeries.ehp.vals, reveal: 1 }
    },
    intersections: initialSeries.intersections,
    intersectionsDamage: initialSeries.intersectionsDamage,
    intersectionsScaling: initialSeries.intersectionsScaling,
    intersectionReveal: initialSeries.intersectionReveal,
    intersectionRevealDamage: initialSeries.intersectionRevealDamage,
    intersectionRevealScaling: initialSeries.intersectionRevealScaling,
    scalingAboveEhp: initialSeries.scalingAboveEhp
};

currentMixE = 1;
drawImmediate(currentBlend, 1);

// ------ RESET BUTTON ------ //
document.getElementById("resetBtn").addEventListener("click", () => {
    
    if (!fullyInitialized) return; // Prevent breaking everything
    if (!confirm("Reset ALL settings?")) return;
    
    history.replaceState({}, "", initialUrl);

    const restoredFromSnapshot = !!initialShareState;
    if (restoredFromSnapshot) {
    applyShareStateObject(initialShareState, { skipPlotVisibility: false });
    } else {
    // Fallback to defaults if snapshot is missing for any reason
    resetFieldsToDefaults();
    if (scalingModeReflectiveEl) scalingModeReflectiveEl.checked = true;
    if (scalingModeLevelEl) scalingModeLevelEl.checked = false;
    if (scalingModeHealthEl) scalingModeHealthEl.checked = false;
    syncFactionStickyFromMain();
    syncChipStates();
    }

    updateAbUi();
    ensurePresetActive();

    // Reset internal plot + comparison state
    lastCompareMode = 'none';
    lastCompareSignature = null;
    lastPresetCompareSignature = null;
    axisState.base = { maxY: null, start: null, end: null };
    axisState.compare = { maxY: null, start: null, end: null };
    axisState.preset = { maxY: null, start: null, end: null };
    document.body.classList.remove('compare-on');
    document.body.classList.remove('ab-compare');
    setCompareCardsVisible(false);

    // Align plot visibility flags and keep plot shown after reset
    plotVisible = true;
    plotCard.classList.add("plot-visible");
    document.body.classList.add('plot-blur-on');
    togglePlotBtn.textContent = "Hide Plot";

    updateMindControlEnabledState();
    updateNekrosEnabledState();
    updateSummWrathEnabledState();
    updateDamageDecoyEnabledState();

    if (!restoredFromSnapshot) {
    // Recalculate everything once and animate from zero
    const params = readParams();
    const toggles = readToggles();
    applyEffectiveEnemyType(params, toggles);
    setFactionBackground(params.faction || "grineer");
    const toSeries = buildAllSeries(params, toggles);
    updateOutputs(params, toSeries);
    animateTo(params, toggles, 600, { unfold: true }, toSeries);
    currentParams = params;
    currentToggles = toggles;
    }
});

fullyInitialized = true;
