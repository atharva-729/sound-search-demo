"use strict";
// Sound Search: the map, the panel, the audio dock and the charts. Data: DATA from data_<map>.js (scripts/build.py).

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const backOut = t => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

const MAP = DATA.map || "real";
// true when served by scripts/serve.py on this machine; false on GitHub Pages
const LOCAL = !!window.BUNDLE || ["127.0.0.1", "localhost"].includes(location.hostname);
const IT = DATA.items.map(([col, label, name, x, y, dur, tags], i) => ({i, col, label, name, x, y, dur, tags: tags ? tags.split("|") : []}));
// colour slot per collection; the two maps never show "sounds" and "music" together
const COLS = {
  podcasts: {name: "Podcasts", short: "Podcasts", slot: "podcasts", src: "39 real shows, minutes 2–10, 20 s clips"},
  voices:   {name: "Voices", short: "Voices", slot: "emotions", src: "CREMA-D actors in 6 moods, plus FSD50K speech, singing, whispers, shouts"},
  music:    {name: "Music", short: "Music", slot: "sounds", src: "FMA (11 genres), MTG-Jamendo and Musopen recordings"},
  sounds:   {name: "Sound effects", short: "Sounds", slot: "sounds", src: "VocalSound · ESC-50 · FSD50K · Xeno-canto birds"},
};
const MODELS = {auto: {name: "Auto", color: "#a78bfa"}, clap: {name: "CLAP", color: "#8f73ec"}, gemma: {name: "Gemma", color: "#5fa80f"}};
// the map's own model: Gemma hears how people talk (real audio), CLAP names sound events (sound effects)
const DEF = MAP === "real" ? "gemma" : "clap";
const M = () => S.model === "auto" ? DEF : S.model;
const isEmo = t => t.col === "voices" && t.label in EMO;
const EMO = {ANG: "angry", DIS: "disgusted", FEA: "afraid", HAP: "happy", SAD: "sad", NEU: "neutral"};
let OK = "#12a28d", BAD = "#ea6236";
// Two themes. Data colours are validated per surface (dark / light lightness band, all-pairs CVD, 3:1 contrast).
const PAL = {
  dark: {sounds: "#2a92e0", emotions: "#e14d8f", podcasts: "#c2830f", clap: "#8f73ec", gemma: "#5fa80f", ok: "#12a28d", bad: "#ea6236",
         ink: "#ffffff", inkA: "255,255,255", halo: "rgba(0,0,0,.95)", label: "rgba(236,240,255,.9)", stroke: "#0b0e1b", text: "#e6e9f8",
         mut: "#8a91b0", soft: "#bcc3de", glow: "lighter", glowK: 1, specTop: "#ffffff"},
  light: {sounds: "#1b7fd1", emotions: "#d43c80", podcasts: "#a96d00", clap: "#7a5ce0", gemma: "#4e8c0a", ok: "#0e8f7c", bad: "#d4521f",
          ink: "#14162a", inkA: "20,22,42", halo: "rgba(255,255,255,.95)", label: "rgba(20,22,42,.85)", stroke: "#ffffff", text: "#1d2140",
          mut: "#5f6684", soft: "#3c4363", glow: "source-over", glowK: .5, specTop: "#14162a"},
};
let THEME = "dark", C = PAL.dark;
try { if (localStorage.getItem("ss-theme") === "light") THEME = "light"; } catch (e) {}
function setPalette() {
  C = PAL[THEME];
  for (const c in COLS) COLS[c].color = C[COLS[c].slot];
  MODELS.auto.color = THEME === "dark" ? "#a78bfa" : "#6d28d9"; MODELS.clap.color = C.clap; MODELS.gemma.color = C.gemma; OK = C.ok; BAD = C.bad;
  document.documentElement.dataset.theme = THEME;
}
setPalette();
const present = DATA.collections.filter(c => IT.some(t => t.col === c));

const EMO_ICON = {ANG: "😠", DIS: "🤢", FEA: "😨", HAP: "😄", SAD: "😔", NEU: "😐"};
const ICON = {sports: "⚽", calm: "🧘", story: "🎭", kids: "🧒", singing: "🎤", piano: "🎹", rock: "🎸", hiphop: "🎧", jazz: "🎷",
  edm: "🎛️", folk: "🪕", siren: "🚨", dog: "🐕", owl: "🦉", birds: "🐦", baby: "👶", cough: "😷", sneeze: "🤧", laugh: "😂", sigh: "😮‍💨", throat: "🗣️", sniff: "👃", snore: "😴", crying: "😢",
  whisper: "🤫", scream: "😱", shout: "📢", anchor: "📰", banter: "🍻", angry: "😠", sad: "😔", waves: "🌊", applause: "👏",
  typing: "⌨️", rain: "🌧️"};
const pretty = l => EMO[l] || ({throatclearing: "throat clearing"}[l]) || String(l).replace(/_/g, " ");

// ---------- state ----------
const S = {model: "auto", on: new Set(present), k: 10, query: null, sel: null, playing: null, hover: null, hoverRow: null};
let current = [];   // indices of the matches on screen, best first

// ---------- verdicts: ✓ / ✗ from labels the search never saw ----------
function verdict(t, q) {
  if (!q) return null;
  if (q.kind === "similar") return t.label === IT[q.src].label ? "ok" : "bad";
  if (t.col === "podcasts") return "unk";
  if (q.labels) return q.labels.has(t.label) || t.tags.some(x => q.labels.has(x)) ? "ok" : "bad";
  return null;
}

// ---------- "by example" chips: per emotion, the CREMA-D clip whose neighbours agree with it most ----------
const EXAMPLES = ["ANG", "SAD", "HAP", "FEA"].map(lab => {
  let best = null, bs = -1;
  for (const t of IT) if (isEmo(t) && t.label === lab) {
    const s = DATA.nn[DEF][t.i].slice(0, 10).filter(j => IT[j].label === lab).length;
    if (s > bs) { bs = s; best = t.i; }
  }
  const w = pretty(lab);
  return best === null ? null : {title: `${w[0].toUpperCase() + w.slice(1)} clip → similar`, idx: best, label: lab};
}).filter(Boolean);
// The honest number beside a hand-picked example: across ALL clips of a mood, how many of the 10 nearest share it.
function typical(lab, model) {
  const ids = IT.filter(t => isEmo(t) && t.label === lab);
  return ids.reduce((a, t) => a + DATA.nn[model][t.i].slice(0, 10).filter(j => IT[j].label === lab).length, 0) / ids.length;
}

// ---------- top bar ----------
function countUp(el, to) {
  const t0 = performance.now();
  const f = now => { const p = clamp((now - t0) / 1100); el.textContent = Math.round(to * ease(p)).toLocaleString(); if (p < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}
function renderLayers() {
  $("layers").innerHTML = present.map(c => `<span class="layer ${S.on.has(c) ? "" : "off"}" data-col="${c}" style="--c:${COLS[c].color}" role="button" tabindex="0">
    <i></i>${COLS[c].short} <span class="n">${IT.filter(t => t.col === c).length.toLocaleString()}</span></span>`).join("");
}
$("layers").onclick = e => {
  const c = e.target.closest(".layer")?.dataset.col; if (!c) return;
  if (S.on.has(c)) { if (S.on.size > 1) S.on.delete(c); } else S.on.add(c);
  renderLayers(); renderMini(); recompute(true);
};
function renderModels() { document.querySelectorAll("#models button").forEach(b => b.classList.toggle("on", b.dataset.m === S.model)); }
document.querySelectorAll(".maptab").forEach(a => a.classList.toggle("on", a.dataset.map === MAP));
$("models").onclick = e => {
  const m = e.target.closest("button")?.dataset.m; if (!m || m === S.model) return;
  S.model = m; renderModels(); rerun();
};

// ---------- chips ----------
const GROUP_OF = {angry: "Moods", sad: "Moods"};
const groups = MAP === "real" ? {"People talking": [], "Voices": [], "Moods": [], "Music": []} : {"Body sounds": [], "Places & things": [], "Animals": []};
DATA.chips.forEach((c, n) => (groups[GROUP_OF[c.key] || c.group] ||= []).push(n));
function renderChips() {
  const q = S.query;
  const chip = n => { const c = DATA.chips[n];
    return `<button class="chip ${q?.chip === n ? "on" : ""}" data-chip="${n}"><span class="e">${ICON[c.key] || "🔊"}</span>${esc(c.title)}</button>`; };
  const h = Object.entries(groups).filter(([, ns]) => ns.length).map(([g, ns]) => `<span class="cg"><span class="gl">${esc(g)}</span>${ns.map(chip).join("")}${
    g === "Moods" && EXAMPLES.length && IT.some(isEmo) ? `<span class="or">or start from a clip, no words:</span>` + EXAMPLES.map((x, n) =>
      `<button class="chip ex ${q?.ex === n ? "on" : ""}" data-ex="${n}" title="Plays one ${pretty(x.label)} actor clip, then lights up the clips that sound most like it"><span class="e">${EMO_ICON[x.label]}</span>${esc(x.title)}</button>`).join("") : ""}</span>`).join("");
  const live = q || S.playing !== null || S.on.size < present.length || V.w < .97;
  $("chips").innerHTML = h + `<button class="reset ${live ? "live" : ""}" id="reset" title="Clear everything and show the whole map (Esc)">↺ Reset</button>`;
}
$("chips").onmouseover = e => {
  const b = e.target.closest("button"); let pv = null;
  if (b?.dataset.chip !== undefined && S.query?.chip !== +b.dataset.chip) { const c = DATA.chips[+b.dataset.chip]; pv = c[S.model === "auto" ? c.model : S.model].map(x => x[0]); }
  else if (b?.dataset.ex !== undefined && S.query?.ex !== +b.dataset.ex) pv = DATA.nn[M()][EXAMPLES[+b.dataset.ex].idx];
  const ids = pv ? pv.filter(i => S.on.has(IT[i].col)).slice(0, 10) : null;
  if (String(ids) !== String(S.preview)) { S.preview = ids; S.previewT = performance.now(); kick(); }
};
$("chips").onmouseleave = () => { S.preview = null; kick(); };
$("chips").onclick = e => {
  S.preview = null;
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "reset") return resetAll();
  if (b.dataset.chip !== undefined) {
    const n = +b.dataset.chip;
    if (S.query?.chip === n) return deselect();   // second click turns it off
    runChip(n, true); playBest();
  } else {
    const n = +b.dataset.ex;
    if (S.query?.ex === n) return deselect();
    runSimilar(EXAMPLES[n].idx, n); play(EXAMPLES[n].idx);
  }
};

// ---------- search box ----------
const PH = ["a dog barking", "a door slamming", "someone nervous", "a crowd at a stadium", "a kettle whistling", "late-night radio host",
  "two people arguing", "birds at dawn", "a baby giggling", "someone eating crisps"];
let phI = 0, phC = 0, phDel = false;
function typePH() {
  const inp = $("q");
  if (document.activeElement !== inp && !inp.value) {
    const w = PH[phI];
    phC += phDel ? -1 : 1;
    inp.placeholder = `Try “${w.slice(0, phC)}”`;
    if (!phDel && phC === w.length) { phDel = true; return setTimeout(typePH, 1600); }
    if (phDel && phC === 0) { phDel = false; phI = (phI + 1) % PH.length; }
  } else inp.placeholder = "Describe any sound or vibe…";
  setTimeout(typePH, phDel ? 28 : 65);
}
$("form").onsubmit = e => { e.preventDefault(); const q = $("q").value.trim(); if (q) { $("q").blur(); runText(q); } };

// ---------- queries ----------
function setQuery(q) { q.t0 = performance.now(); S.query = q; recompute(true); }
function recompute(fly) {
  const q = S.query;
  current = q && q.ranked ? q.ranked.filter(i => S.on.has(IT[i].col)).slice(0, S.k) : [];
  if (q) q.t0 = performance.now();
  renderChips(); renderPanel(); baseDirty = true;
  if (fly && current.length) flyTo(current.concat(q.kind === "similar" ? [q.src] : []));
  kick();
}
function runChip(n, useDefault) {
  const c = DATA.chips[n];
  const m = S.model === "auto" ? c.model : S.model;
  setQuery({kind: "chip", chip: n, key: c.key, title: c.title, icon: ICON[c.key] || "🔊", labels: c.labels.length ? new Set(c.labels) : null,
            scope: c.scope, model: m, ranked: c[m].map(x => x[0]), scores: new Map(c[m].map(x => [x[0], x[1]]))});
}
let textSeq = 0;
async function runText(text) {
  const my = ++textSeq, model = S.model;
  setQuery({kind: "text", text, title: `“${text}”`, icon: "⌨️", labels: null, ranked: [], loading: true, model});
  $("sweep").classList.add("on");
  try {
    const get = async m => { const r = await fetch(`/search?map=${MAP}&model=${m}&q=${encodeURIComponent(text)}`); if (!r.ok) throw new Error(r.status); return (await r.json()).scores; };
    const z = a => { const mu = a.reduce((x, y) => x + y, 0) / a.length, sd = Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length) || 1; return a.map(v => (v - mu) / sd); };
    let s;
    if (model === "auto") { const [a, b] = await Promise.all([get("clap"), get("gemma")]); const za = z(a), zb = z(b); s = za.map((v, i) => (v + zb[i]) / 2); }
    else s = await get(model);
    if (my !== textSeq) return;
    const ranked = s.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 500);
    const ch = DATA.chips.find(c => c.title.toLowerCase() === text.toLowerCase());
    Object.assign(S.query, {ranked: ranked.map(x => x[1]), scores: new Map(ranked.map(x => [x[1], x[0]])), loading: false,
                            labels: ch && ch.labels.length ? new Set(ch.labels) : null});
  } catch (err) {
    if (my !== textSeq) return;
    Object.assign(S.query, {loading: false, error: true});
  }
  $("sweep").classList.remove("on");
  recompute(true);
}
function runSimilar(idx, ex) {
  const t = IT[idx];
  S.sel = idx;
  setQuery({kind: "similar", src: idx, ex, title: "Clips that sound like it", icon: isEmo(t) ? EMO_ICON[t.label] : "≈", labels: null,
            model: M(), ranked: DATA.nn[M()][idx]});
}
function rerun() {
  const q = S.query; if (!q) return;
  if (q.kind === "chip") runChip(q.chip, false);
  else if (q.kind === "text") runText(q.text);
  else runSimilar(q.src, q.ex);
}
function clearQuery() { S.query = null; current = []; renderChips(); renderPanel(); baseDirty = true; kick(); }
// play the best match that its human label confirms (a cough for "Coughing"), else the top match
function playBest() {
  const q = S.query; if (!q || !current.length) return;
  play(current.find(i => verdict(IT[i], q) === "ok") ?? current[0]);
}
function deselect() { clearQuery(); stopAudio(); S.sel = null; goTo({x0: 0, y0: 0, w: 1, h: 1}); }
function resetAll() {
  S.on = new Set(present); S.k = 10; S.preview = null; $("q").value = "";
  if (S.model !== "auto") { S.model = "auto"; renderModels(); }
  renderLayers(); renderMini(); deselect();
}

// ---------- panel ----------
function donut(n, d, color) {
  const r = 26, C = 2 * Math.PI * r, f = d ? n / d : 0;
  return `<svg class="donut" width="68" height="68" viewBox="0 0 68 68" aria-label="${n} of ${d}">
    <circle cx="34" cy="34" r="${r}" fill="none" stroke="rgba(${C.inkA},.1)" stroke-width="7"/>
    ${d ? "" : "<!--"}<circle cx="34" cy="34" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C * f} ${C}"
      transform="rotate(-90 34 34)" style="filter:drop-shadow(0 0 6px ${color});transition:stroke-dasharray .6s"/>${d ? "" : "-->"}
    <text x="34" y="40" text-anchor="middle" font-size="18">${d ? n : "?"}</text></svg>`;
}
function labelMix(ids) {
  const m = new Map();
  ids.forEach(i => { const l = kindOf(IT[i]); m.set(l, (m.get(l) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, n]) => `<span><b>${n}×</b> ${esc(l)}</span>`).join("");
}
const SUGG = MAP === "real"
  ? [["anchor", "podcasts", "A way of talking, found in real podcasts"], ["piano", "music", "Music, described in words"]]
  : [["waves", "sounds", "A sound effect, named in words"], ["owl", "sounds", "A real field recording"]];
const ONMAP = MAP === "real"
  ? `<b>Real recordings of people and music.</b> Podcasts (how people talk), voices (moods, whispers, singing, kids) and music (11 genres).
     <div class="tryline">Try: <i>“someone nervous”</i>, <i>“two people arguing”</i>, <i>“late-night radio host”</i>, <i>“sad piano”</i></div>
     <div class="mhow"><b>Model:</b> leave it on <b>Auto</b>. Gemma hears <b>how people talk</b>; CLAP knows <b>music and sound effects</b>. Auto asks both.</div>`
  : `<b>Labelled sound effects and nature.</b> Coughs, sneezes, rain, sirens, dogs, birds: every clip has a human label, so each search is scored ✓ / ✗.
     <div class="tryline">Try: <i>“a door slamming”</i>, <i>“glass breaking”</i>, <i>“a crowd cheering”</i></div>
     <div class="mhow"><b>Model:</b> CLAP is the expert here (it learned from captioned sound effects). Auto leans on it.</div>`;
function emptyPanel() {
  const sg = SUGG.map(([k, col, sub]) => { const n = DATA.chips.findIndex(c => c.key === k); if (n < 0 || !present.includes(col)) return "";
    return `<button class="sg" data-chip="${n}" style="--c:${COLS[col].color}"><span class="e">${ICON[k] || "🔊"}</span><span><div class="t">${esc(DATA.chips[n].title)}</div><div class="s">${sub}</div></span></button>`; });
  if (EXAMPLES.length) sg.push(`<button class="sg" data-ex="0" style="--c:${COLS.voices.color}"><span class="e">😠</span><span><div class="t">Angry clip → similar</div><div class="s">No words: plays an angry clip, finds ones like it</div></span></button>`);
  return `<div class="empty"><div class="onmap"><div class="kick" style="margin-bottom:3px">On this map</div>${ONMAP}</div><h3>Where should we listen?</h3><p>Every dot is a clip. Clips that sound alike sit together.</p>
    <div class="sugg">${sg.join("")}</div>
    <div class="how3"><div><span>1</span>Pick a search above, or type your own words</div><div><span>2</span>Matches light up on the map, and are scored ✓ / ✗ here</div><div><span>3</span>Click any dot or row to hear it</div></div>
    <div class="wbox" id="clusters"><h4>🏷️ What the capital words on the map mean</h4><ul>
      <li><b>The model only places the clips.</b> The words are added afterwards, from the datasets' human labels.</li>
      <li>If most clips of one label (cough, dogs, rain…) sit tightly together, the label is written at their centre. Podcasts are named by show type; acted emotions share one island.</li>
      <li><b>No word over an area</b>: that kind of sound is spread out. More words appear as you zoom in.</li></ul></div></div>`;
}
function renderPanel() {
  const q = S.query, P = $("panel");
  if (!q) { P.innerHTML = emptyPanel(); return; }
  const qm = q.model || M();
  const mp = `<span class="mp" style="--c:${MODELS[qm].color}">${qm === "auto" ? "Auto: CLAP + Gemma" : MODELS[qm].name}</span>`;
  const kind = {chip: "Ready-made search", text: "Your words", similar: "Search by example"}[q.kind];
  let h = `<div class="phead"><button class="pclear" data-clear title="Clear (Esc)">✕</button><div class="qrow"><div class="qicon">${q.icon}</div><div style="min-width:0"><div class="qkind">${kind} ${mp}</div>
    <div class="qtitle">${esc(q.title)}</div></div></div>`;
  if (q.kind === "similar") {
    const sc = IT[q.src];
    h += `<div class="srcc" data-i="${q.src}" style="--c:${COLS[sc.col].color}"><button class="pb" aria-label="Play">${S.playing === q.src && !audio.paused ? "❚❚" : "▶"}</button>
      <div style="min-width:0"><div class="sk">You started from this clip</div><div class="rn">${esc(cap(sc.name))}</div></div></div>`;
  }
  if (q.loading) { P.innerHTML = h + `</div><div class="loading">Listening to ${IT.length.toLocaleString()} clips…${"<div class='shim'></div>".repeat(5)}</div>`; return; }
  if (q.error) { P.innerHTML = h + `</div><div class="err">Typed search runs the models live, so it needs ${window.BUNDLE ? "the full version: double-click start.bat (see START HERE)" : "the local version (scripts/serve.py)"}. The ready-made searches and “→ similar” work here.</div>`; return; }
  const v = current.map(i => verdict(IT[i], q)), lab = v.filter(x => x === "ok" || x === "bad"), ok = v.filter(x => x === "ok").length;
  if (lab.length) {
    const what = q.kind === "similar" ? `the same kind as the clip you picked (<b>${esc(pretty(IT[q.src].label))}</b>)` : "<b>right</b>, by their human labels";
    h += `<div class="score">${donut(ok, lab.length, ok / lab.length >= .5 ? OK : BAD)}<div><div class="sline"><b>${ok} of ${lab.length}</b> are ${what}</div>
      <div class="mix">${labelMix(current)}</div></div></div>`;
  } else if (current.length) {
    h += `<div class="score">${donut(0, 0, C.mut)}<div><div class="sline">${q.kind === "text" ? "No answer key for your own words." : "Podcasts have no clip labels."} <b>Listen</b> and judge.</div>
      <div class="mix">${labelMix(current)}</div></div></div>`;
  }
  if (q.kind === "similar" && isEmo(IT[q.src]))
    h += `<div class="note">${q.ex !== undefined ? "Hand-picked as the most typical clip. " : ""}Across <b>all</b> ${esc(pretty(IT[q.src].label))} clips, about <b>${typical(IT[q.src].label, M()).toFixed(1)} of 10</b> neighbours share the mood (chance 1.7).</div>`;
  h += `</div>`;
  if (!current.length) {
    const sc = q.scope ? q.scope.filter(c => !S.on.has(c)).map(c => COLS[c].short) : [];
    h += `<div class="err">${sc.length ? `This search covers ${sc.join(", ")}: switch that layer on.` : "Nothing in the collections on show."}</div>`;
    P.innerHTML = h; return;
  }
  let lo = Infinity, hi = -Infinity;
  if (q.scores) current.forEach(i => { const s = q.scores.get(i); lo = Math.min(lo, s); hi = Math.max(hi, s); });
  h += `<div class="rows" id="rows">` + current.map((i, r) => {
    const t = IT[i], vv = v[r], c = COLS[t.col].color;
    const bar = q.scores ? `<div class="rbar"><b style="width:${hi > lo ? 35 + 65 * (q.scores.get(i) - lo) / (hi - lo) : 100}%"></b></div>` : "";
    const meta = t.col === "podcasts" ? esc(t.label) : `label: ${esc(kindOf(t))}`;
    return `<div class="row ${S.playing === i ? "playing" : ""}" data-i="${i}" style="--c:${c};animation-delay:${r * 28}ms">
      <span class="rk">${String(r + 1).padStart(2, "0")}</span>
      <button class="pb" data-play="${i}" aria-label="Play">${S.playing === i && !audio.paused ? "❚❚" : "▶"}</button>
      <div style="min-width:0"><div class="rn">${esc(cap(t.name))}</div><div class="rm"><i></i>${COLS[t.col].short} · ${meta}</div>${bar}</div>
      <button class="sb" data-sim="${i}" title="Find clips that sound like this">≈</button>
      <span class="vb ${vv || ""}">${vv === "ok" ? "✓" : vv === "bad" ? "✗" : vv === "unk" ? "?" : ""}</span>
      <div class="rprog"><b></b></div></div>`;
  }).join("") + `</div>`;
  h += `<div class="pfoot"><span>${current.length} best matches</span><span class="kseg">${[10, 20, 50].map(k => `<button class="${S.k === k ? "on" : ""}" data-k="${k}">Top ${k}</button>`).join("")}</span></div>`;
  P.innerHTML = h;
}
$("panel").onclick = e => {
  if (e.target.closest("[data-clear]")) return deselect();
  const k = e.target.closest("[data-k]"); if (k) { S.k = +k.dataset.k; return recompute(true); }
  const sim = e.target.closest("[data-sim]"); if (sim) return runSimilar(+sim.dataset.sim);
  const ch = e.target.closest("[data-chip]"); if (ch) { runChip(+ch.dataset.chip, true); return playBest(); }
  const ex = e.target.closest("[data-ex]"); if (ex) { const n = +ex.dataset.ex; runSimilar(EXAMPLES[n].idx, n); return play(EXAMPLES[n].idx); }
  const row = e.target.closest("[data-i]"); if (row) play(+row.dataset.i);
};
$("panel").onmouseover = e => { const r = e.target.closest(".row"); const i = r ? +r.dataset.i : null; if (i !== S.hoverRow) { S.hoverRow = i; kick(); } };
$("panel").onmouseleave = () => { S.hoverRow = null; kick(); };

// ---------- audio + dock ----------
const audio = $("audio");
let AC = null, analyser = null, freq = null, wave = null, level = 0;
function initAudio() {
  if (location.protocol === "file:") return;   // browsers mute file:// audio routed through Web Audio; play it plain
  if (AC) { if (AC.state === "suspended") AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const src = AC.createMediaElementSource(audio);
    analyser = AC.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .72;
    src.connect(analyser); analyser.connect(AC.destination);
    freq = new Uint8Array(analyser.frequencyBinCount); wave = new Uint8Array(analyser.fftSize);
  } catch (e) { AC = null; }
}
function play(i) {
  initAudio();
  if (S.playing === i && audio.src) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
  S.playing = i; S.sel = i;
  audio.src = window.BUNDLE ? `clips/${MAP}/${i}.mp3` : `/audio/${MAP}/${i}`;
  audio.play().catch(() => {});
  showDock(); syncRows(); kick();
}
function showDock() {
  const t = IT[S.playing]; if (!t) return;
  const c = COLS[t.col].color;
  $("dock").style.setProperty("--c", c);
  $("dname").textContent = cap(t.name);
  $("dmeta").innerHTML = `<i></i>${COLS[t.col].name} · ${esc(t.col === "podcasts" ? t.label : pretty(t.label))}`;
  $("dock").classList.add("on");
}
function syncRows() {
  document.querySelectorAll(".row").forEach(r => {
    const i = +r.dataset.i, on = i === S.playing;
    r.classList.toggle("playing", on);
    r.querySelector(".pb").textContent = on && !audio.paused ? "❚❚" : "▶";
  });
  const sc = document.querySelector(".srcc");
  if (sc) sc.querySelector(".pb").textContent = +sc.dataset.i === S.playing && !audio.paused ? "❚❚" : "▶";
  const rs = $("reset"); if (rs) rs.classList.toggle("live", !!(S.query || S.playing !== null || S.on.size < present.length || V.w < .97));
  $("dplay").textContent = audio.paused ? "▶" : "❚❚";
  document.body.classList.toggle("playing", !audio.paused);
}
audio.onplay = audio.onpause = audio.onended = () => { syncRows(); kick(); };
audio.ontimeupdate = () => {
  const f = audio.duration ? audio.currentTime / audio.duration : 0;
  $("dprog").style.width = `${f * 100}%`;
  const b = document.querySelector(".row.playing .rprog b"); if (b) b.style.width = `${f * 100}%`;
};
audio.onerror = () => {
  if (S.playing === null || !audio.src) return;
  toast(!LOCAL ? "Audio isn't hosted on this public page (licences). The local version plays every clip." :
        location.protocol === "file:" ? "Open the page through scripts/serve.py to hear clips." : "This clip's audio isn't on this laptop yet.");
};
$("dplay").onclick = () => S.playing !== null && play(S.playing);
$("dsim").onclick = () => S.playing !== null && runSimilar(S.playing);
function stopAudio() { audio.pause(); $("dock").classList.remove("on"); S.playing = null; syncRows(); kick(); }
$("dclose").onclick = stopAudio;
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200); }
const spec = $("spec"), sctx = spec.getContext("2d");
function drawSpec() {
  const w = spec.width, h = spec.height, n = 30, c = COLS[IT[S.playing]?.col]?.color || "#a78bfa";
  sctx.clearRect(0, 0, w, h);
  const bw = w / n;
  for (let k = 0; k < n; k++) {
    const v = freq && !audio.paused ? freq[Math.floor(k * 1.6) + 1] / 255 : 0.04 + 0.03 * Math.sin(k);
    const bh = Math.max(3, v * h);
    const g = sctx.createLinearGradient(0, h, 0, h - bh);
    g.addColorStop(0, c); g.addColorStop(1, C.specTop);
    sctx.fillStyle = g; sctx.globalAlpha = .9;
    sctx.beginPath(); sctx.roundRect(k * bw + 1.5, h - bh, bw - 3, bh, 2); sctx.fill();
  }
  sctx.globalAlpha = 1;
}

// ---------- map ----------
const cv = $("map"), ctx = cv.getContext("2d");
const base = document.createElement("canvas"), bctx = base.getContext("2d");
let W = 0, H = 0, DPR = 1, baseDirty = true, raf = null;
const PAD = 28;
let V = {x0: 0, y0: 0, w: 1, h: 1}, tween = null;
const INTRO = {t0: performance.now(), dur: 1700};
const introP = now => matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : clamp((now - INTRO.t0) / INTRO.dur);
const px = t => PAD + (t.x - V.x0) / V.w * (W - 2 * PAD), py = t => PAD + (V.y0 + V.h - t.y) / V.h * (H - 2 * PAD);
const toData = (mx, my) => [V.x0 + (mx - PAD) / (W - 2 * PAD) * V.w, V.y0 + V.h - (my - PAD) / (H - 2 * PAD) * V.h];
function fitStage() {
  const st = document.querySelector(".stage");
  if (location.hash.includes("tall")) return document.documentElement.style.setProperty("--stage", "640px");   // screenshots only
  if (innerWidth > 1000) document.documentElement.style.setProperty("--stage", `${Math.max(480, innerHeight - st.getBoundingClientRect().top - window.scrollY - 16)}px`);
}
function resize() {
  fitStage();
  const r = cv.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
  for (const c of [cv, base]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  baseDirty = true; kick();
}
const sprites = {};
function sprite(color, r) {
  const k = color + r; if (sprites[k]) return sprites[k];
  const c = document.createElement("canvas"), s = Math.ceil(r * 2 * DPR); c.width = c.height = s;
  const g = c.getContext("2d"), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, color); gr.addColorStop(.25, color + "cc"); gr.addColorStop(1, color + "00");
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return sprites[k] = c;
}

// cluster labels: groups of one kind that sit tightly together get a name on the map
const SYN = {coughing: "cough", sneezing: "sneeze", laughing: "laughter", "chuckle and chortle": "laughter", giggle: "giggles", clapping: "applause",
  "keyboard typing": "typing", "sea waves": "waves", "waves and surf": "waves", "crying baby": "baby crying", "crying and sobbing": "sobbing",
  dog: "dogs", bark: "dogs", "chirping birds": "birdsong", "chirp and tweet": "birdsong", "female speech and woman speaking": "speech",
  "male speech and man speaking": "speech", "child speech and kid speaking": "kids talking", "vehicle horn and car horn and honking": "car horns",
  "car horn": "car horns", siren: "sirens", "door wood knock": "knocking", "crackling fire": "fire", "water drops": "drips", drip: "drips",
  cricket: "crickets", frog: "frogs", meow: "cats", cat: "cats", purr: "cats", rooster: "chickens", hen: "chickens", thunderstorm: "thunder",
  sigh: "sighs", sniff: "sniffs", train: "trains", engine: "engines", car: "engines", bus: "engines", truck: "engines", motorcycle: "engines",
  "church bells": "bells", "bicycle bell": "bells", screaming: "screams", shout: "shouts", whispering: "whispers", "hand saw": "sawing",
  "mouse click": "clicks", "clock tick": "ticking", "clock alarm": "alarms", "vacuum cleaner": "vacuum", "glass breaking": "glass breaking",
  "toilet flush": "toilet flush", "singing": "singing", pig: "pigs", cow: "cows", sheep: "sheep", crow: "crows", "chewing and mastication": "chewing"};
const kindOf = t => { if (t.col === "podcasts" || t.col === "music") return t.label; if (isEmo(t)) return EMO[t.label]; const p = pretty(t.label).toLowerCase(); return SYN[p] || p; };
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const LABELS = (() => {
  const g = new Map();
  for (const t of IT) {
    let name;
    if (isEmo(t)) name = "acted emotions";
    else if (t.col === "podcasts" || t.col === "music") name = t.label;
    else { const p = pretty(t.label).toLowerCase(); name = SYN[p] || p; }
    const k = t.col + "|" + name;
    if (!g.has(k)) g.set(k, {col: t.col, name, pts: []});
    g.get(k).pts.push(t);
  }
  const out = [];
  for (const v of g.values()) {
    if (v.pts.length < 10) continue;
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const cx = med(v.pts.map(t => t.x)), cy = med(v.pts.map(t => t.y));
    const d = v.pts.map(t => Math.hypot(t.x - cx, t.y - cy)).sort((a, b) => a - b), r = d[Math.floor(d.length * .7)];
    if (r > .07) continue;
    out.push({col: v.col, name: v.name, x: cx, y: cy, pri: v.pts.length / (r + .01)});
  }
  return out.sort((a, b) => b.pri - a.pri);
})();

function renderBase(now = performance.now()) {
  bctx.clearRect(0, 0, W, H);
  const ip = introP(now), cx0 = W / 2, cy0 = H / 2;
  // during the intro each dot travels from the centre on its own small delay
  const P = ip >= 1 ? (t => [px(t), py(t)]) : (t => {
    const d = ((t.i * 7919) % 1000) / 1000 * 650, e = ease(clamp((now - INTRO.t0 - d) / 1000));
    return [cx0 + (px(t) - cx0) * e, cy0 + (py(t) - cy0) * e];
  });
  const active = current.length > 0 || S.query?.loading;
  const coreR = clamp(1.25 / Math.sqrt(V.w), 1.25, 3), glowK = clamp(Math.sqrt(1 / V.w), 1, 2.2);
  for (const c of present) {
    if (!S.on.has(c)) continue;
    const col = COLS[c].color, glow = sprite(col, 7);
    const pts = IT.filter(t => t.col === c);
    bctx.globalCompositeOperation = C.glow;
    bctx.globalAlpha = (active ? .035 : .08) * glowK * C.glowK;
    for (const t of pts) { const [x, y] = P(t); if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue; bctx.drawImage(glow, x - 7, y - 7, 14, 14); }
    bctx.globalCompositeOperation = "source-over";
    bctx.fillStyle = col; bctx.globalAlpha = active ? .28 : .72;
    for (const t of pts) { const [x, y] = P(t); if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue; bctx.beginPath(); bctx.arc(x, y, coreR, 0, 7); bctx.fill(); }
  }
  bctx.globalAlpha = 1;
  // labels with simple collision avoidance
  bctx.font = "600 10.5px Segoe UI Variable Text, Segoe UI, sans-serif";
  if ("letterSpacing" in bctx) bctx.letterSpacing = "0.8px";
  bctx.textBaseline = "middle";
  const placed = [], labA = clamp((ip - .75) / .25);
  if (labA <= 0) return;
  const zoomBoost = Math.min(3, 1 / V.w);
  let n = 0;
  for (const L of LABELS) {
    if (!S.on.has(L.col)) continue;
    if (n > 26 + zoomBoost * 8) break;
    const x = px(L), y = py(L), text = L.name.toUpperCase(), w = bctx.measureText(text).width + 8, h = 16;
    const box = [x - w / 2, y - h / 2 - 12, x + w / 2, y + h / 2 - 12];
    if (box[0] < 8 || box[2] > W - 8 || box[1] < 8 || box[3] > H - 8) continue;
    if (placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
    placed.push(box); n++;
    bctx.globalAlpha = (active ? .32 : .9) * labA;
    // names only, no marker: a dot here would read as a clip
    bctx.shadowColor = C.halo; bctx.shadowBlur = 8;
    bctx.fillStyle = C.label; bctx.textAlign = "center";
    bctx.fillText(text, x, y - 12);
    bctx.shadowBlur = 0; bctx.textAlign = "start";
  }
  bctx.globalAlpha = 1;
}

function frame(now) {
  raf = null;
  let again = false;
  if (tween) {
    const p = clamp((now - tween.t0) / tween.dur), e = ease(p);
    V = {x0: tween.a.x0 + (tween.b.x0 - tween.a.x0) * e, y0: tween.a.y0 + (tween.b.y0 - tween.a.y0) * e,
         w: tween.a.w + (tween.b.w - tween.a.w) * e, h: tween.a.h + (tween.b.h - tween.a.h) * e};
    baseDirty = true;
    if (p >= 1) tween = null; else again = true;
  }
  if (introP(now) < 1) { baseDirty = true; again = true; }
  if (baseDirty) { renderBase(now); baseDirty = false; updateMini(); }
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(base, 0, 0, W, H);
  const q = S.query, t0 = q?.t0 || 0;
  // similar: constellation lines from the picked clip to its neighbours
  if (q && q.kind === "similar" && current.length) {
    const s = IT[q.src], sx = px(s), sy = py(s);
    current.forEach((i, r) => {
      const p = clamp((now - t0 - r * 35) / 480); if (p < 1) again = true;
      const t = IT[i], x = sx + (px(t) - sx) * ease(p), y = sy + (py(t) - sy) * ease(p);
      const g = ctx.createLinearGradient(sx, sy, x, y);
      g.addColorStop(0, `rgba(${C.inkA},.65)`); g.addColorStop(1, COLS[t.col].color);
      ctx.strokeStyle = g; ctx.globalAlpha = .55; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }
  // matches: glow, pop-in, a one-off sonar ping, and a ring that carries the verdict
  for (let r = current.length - 1; r >= 0; r--) {
    const i = current[r], t = IT[i], x = px(t), y = py(t), col = COLS[t.col].color;
    const pin = clamp((now - t0 - r * 45) / 380), sc = pin <= 0 ? 0 : backOut(pin);
    if (pin < 1) again = true;
    ctx.globalCompositeOperation = C.glow; ctx.globalAlpha = .95 * C.glowK * clamp(pin * 2);
    const g = sprite(col, 20); ctx.drawImage(g, x - 20 * sc, y - 20 * sc, 40 * sc, 40 * sc);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    const ping = clamp((now - t0 - r * 45) / 1100);
    if (ping > 0 && ping < 1) {
      again = true;
      ctx.strokeStyle = col; ctx.globalAlpha = (1 - ping) * .85; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6 + 34 * ease(ping), 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (sc <= 0) continue;
    ctx.fillStyle = col; ctx.strokeStyle = C.stroke; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4.2 * sc, 0, 7); ctx.fill(); ctx.stroke();
    const v = verdict(t, q);
    ctx.lineWidth = 2;
    ctx.strokeStyle = v === "ok" ? OK : v === "bad" ? BAD : `rgba(${C.inkA},.85)`;
    ctx.setLineDash(v === "bad" ? [3, 3] : []);
    ctx.beginPath(); ctx.arc(x, y, 9.5 * sc, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (q && q.kind === "similar") {
    const s = IT[q.src], x = px(s), y = py(s);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
  }
  // chip hover preview: ghost rings
  if (S.preview) {
    const a = clamp((now - S.previewT) / 250); if (a < 1) again = true;
    ctx.setLineDash([3, 4]); ctx.lineWidth = 1.6;
    for (const i of S.preview) {
      const t = IT[i], x = px(t), y = py(t);
      ctx.strokeStyle = `rgba(${C.inkA},.75)`; ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  // the clip being played ripples with its actual loudness
  if (S.playing !== null && S.on.has(IT[S.playing].col)) {
    const t = IT[S.playing], x = px(t), y = py(t), col = COLS[t.col].color;
    if (!audio.paused) {
      again = true;
      if (analyser) {
        analyser.getByteTimeDomainData(wave); analyser.getByteFrequencyData(freq);
        let s = 0; for (const b of wave) s += ((b - 128) / 128) ** 2;
        level = level * .6 + Math.sqrt(s / wave.length) * .4;
      }
      for (let k = 0; k < 3; k++) {
        const f = ((now / 1300) + k / 3) % 1;
        ctx.strokeStyle = col; ctx.globalAlpha = (1 - f) * .7; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, 8 + 46 * f, 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = C.glow; ctx.globalAlpha = C.glowK;
      const rr = 12 + level * 120, g = sprite(col, 30);
      ctx.drawImage(g, x - rr, y - rr, rr * 2, rr * 2);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      drawSpec();
    } else drawSpec();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke();
  }
  // hover from the panel: crosshair on the map
  if (S.hoverRow !== null && S.on.has(IT[S.hoverRow].col)) {
    const t = IT[S.hoverRow], x = px(t), y = py(t);
    ctx.strokeStyle = `rgba(${C.inkA},.25)`; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke();
  }
  if (S.hover !== null) {
    const t = IT[S.hover], x = px(t), y = py(t);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke();
  }
  if (again) kick();
}
function kick() { if (!raf) raf = requestAnimationFrame(frame); }

function flyTo(ids) {
  if (!ids.length) return;
  const xs = ids.map(i => IT[i].x), ys = ids.map(i => IT[i].y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = clamp(Math.max(x1 - x0, y1 - y0) * 1.6, .14, 1);
  if (s >= .95) return goTo({x0: 0, y0: 0, w: 1, h: 1});
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  goTo({x0: cx - s / 2, y0: cy - s / 2, w: s, h: s});
}
function goTo(b) { tween = {a: {...V}, b, t0: performance.now(), dur: 850}; kick(); }
function zoomBy(f, mx = W / 2, my = H / 2) {
  const [dx, dy] = toData(mx, my);
  if (V.w * f >= 1) return goTo({x0: 0, y0: 0, w: 1, h: 1});
  V = {x0: dx - (dx - V.x0) * f, y0: dy - (dy - V.y0) * f, w: V.w * f, h: V.h * f};
  tween = null; baseDirty = true; kick();
}
function nearest(mx, my) {
  let best = null, bd = 13 * 13;
  for (const t of IT) { if (!S.on.has(t.col)) continue; const d = (px(t) - mx) ** 2 + (py(t) - my) ** 2; if (d < bd) { bd = d; best = t.i; } }
  return best;
}
cv.addEventListener("wheel", e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? .8 : 1.25, e.clientX - r.left, e.clientY - r.top); }, {passive: false});
let drag = null;
cv.onmousedown = e => { drag = {x: e.clientX, y: e.clientY, v: {...V}, moved: false}; };
window.addEventListener("mouseup", () => { cv.classList.remove("grab"); setTimeout(() => drag = null, 0); });
cv.onmousemove = e => {
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  if (drag && e.buttons) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      cv.classList.add("grab"); tween = null;
      V = {...drag.v, x0: drag.v.x0 - dx / (W - 2 * PAD) * V.w, y0: drag.v.y0 + dy / (H - 2 * PAD) * V.h};
      $("tip").style.display = "none"; baseDirty = true; return kick();
    }
  }
  const i = nearest(mx, my), tip = $("tip");
  if (i !== S.hover) { S.hover = i; kick(); }
  if (i === null) { tip.style.display = "none"; return; }
  const t = IT[i], v = verdict(t, S.query);
  tip.style.setProperty("--c", COLS[t.col].color);
  tip.innerHTML = `<div class="tn">${esc(cap(t.name))}</div><div class="tm"><i></i>${COLS[t.col].short} · ${esc(t.col === "podcasts" ? t.label : pretty(t.label))}${v === "ok" ? " · ✓" : v === "bad" ? " · ✗" : ""}</div><div class="th">Click to play · ${t.dur.toFixed(0)} s</div>`;
  tip.style.display = "block";
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = `${mx + 18 + tw > W ? mx - tw - 14 : mx + 18}px`;
  tip.style.top = `${clamp(my - th / 2, 8, H - th - 8)}px`;
};
cv.onmouseleave = () => { S.hover = null; $("tip").style.display = "none"; kick(); };
cv.onclick = e => {
  if (drag?.moved) return;
  const r = cv.getBoundingClientRect(), i = nearest(e.clientX - r.left, e.clientY - r.top);
  if (i !== null) play(i);
};
cv.ondblclick = e => { const r = cv.getBoundingClientRect(); zoomBy(.5, e.clientX - r.left, e.clientY - r.top); };
$("zin").onclick = () => zoomBy(.67); $("zout").onclick = () => zoomBy(1.5);
$("zreset").onclick = () => goTo({x0: 0, y0: 0, w: 1, h: 1});

$("zfit").onclick = () => { const q = S.query; if (current.length) flyTo(current.concat(q.kind === "similar" ? [q.src] : [])); };

// minimap
const mini = $("mini"), mctx = mini.getContext("2d"), miniBase = document.createElement("canvas");
function renderMini() {
  const d = Math.min(2, window.devicePixelRatio || 1);
  mini.width = miniBase.width = 150 * d; mini.height = miniBase.height = 104 * d;
  const g = miniBase.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, 150, 104);
  for (const t of IT) { if (!S.on.has(t.col)) continue; g.fillStyle = COLS[t.col].color; g.globalAlpha = .55; g.fillRect(6 + t.x * 138, 6 + (1 - t.y) * 92, 1.3, 1.3); }
  updateMini();
}
function updateMini() {
  const on = V.w < .97; mini.classList.toggle("on", on); if (!on) return;
  const d = mini.width / 150;
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, mini.width, mini.height); mctx.drawImage(miniBase, 0, 0);
  mctx.setTransform(d, 0, 0, d, 0, 0);
  mctx.strokeStyle = C.ink; mctx.lineWidth = 1.5; mctx.fillStyle = `rgba(${C.inkA},.08)`;
  const x = 6 + V.x0 * 138, y = 6 + (1 - V.y0 - V.h) * 92;
  mctx.fillRect(x, y, V.w * 138, V.h * 92); mctx.strokeRect(x, y, V.w * 138, V.h * 92);
}
mini.onclick = e => {
  const r = mini.getBoundingClientRect(), dx = (e.clientX - r.left - 6) / 138, dy = 1 - (e.clientY - r.top - 6) / 92;
  goTo({...V, x0: dx - V.w / 2, y0: dy - V.h / 2});
};

function renderLegend() {
  $("mlegend").innerHTML = present.map(c => `<span><i style="--c:${COLS[c].color}"></i>${COLS[c].name}</span>`).join("") +
    `<hr><span><i class="ring" style="--c:${OK}"></i>Match, label agrees ✓</span>
     <span><i class="ring dash" style="--c:${BAD}"></i>Match, label disagrees ✗</span>
     <span><i class="ring" style="--c:${C.ink}"></i>Match, no label ?</span>`;
}

// ---------- keyboard ----------
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing) { e.preventDefault(); $("q").focus(); }
  else if (e.key === "Escape") { if (typing) $("q").blur(); else deselect(); }
  else if (e.key === " " && !typing && S.playing !== null && e.target === document.body) { e.preventDefault(); play(S.playing); }
});

// ---------- charts ----------
function chipScore(c, m) {
  const L = new Set(c.labels);
  return c[m].map(x => x[0]).filter(i => IT[i].col !== "podcasts").slice(0, 10).filter(i => L.has(IT[i].label)).length;
}
function ctip(box, html, ev) {
  const t = box.querySelector(".ctip"), r = box.getBoundingClientRect();
  if (!html) { t.style.display = "none"; return; }
  t.innerHTML = html; t.style.display = "block";
  t.style.left = `${Math.min(ev.clientX - r.left + 14, r.width - t.offsetWidth)}px`; t.style.top = `${ev.clientY - r.top - 36}px`;
}
function goTop() { window.scrollTo({top: 0, behavior: "smooth"}); }
function chartWords() {
  const box = $("ch-words"), rows = DATA.chips.map((c, n) => ({c, n})).filter(r => r.c.labels.length)
    .map(r => ({...r, clap: chipScore(r.c, "clap"), gemma: chipScore(r.c, "gemma")})).sort((a, b) => b.clap - a.clap || b.gemma - a.gemma);
  const Wc = box.clientWidth, LW = Math.min(190, Wc * .42), X0 = LW + 14, X1 = Wc - 14, RH = 30, top = 8, Hc = top + rows.length * RH + 30;
  const x = v => X0 + v / 10 * (X1 - X0);
  let s = `<svg viewBox="0 0 ${Wc} ${Hc}" height="${Hc}">`;
  for (let v = 0; v <= 10; v += 2) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${Hc - 24}" stroke="rgba(${C.inkA},${v ? .07 : .16})"/>
    <text x="${x(v)}" y="${Hc - 8}" fill="${C.mut}" font-size="11" text-anchor="middle">${v}</text>`;
  rows.forEach((r, k) => {
    const y = top + k * RH + RH / 2, a = x(r.clap), b = x(r.gemma), tie = r.clap === r.gemma ? 5 : 0;
    s += `<g class="rowhit" data-n="${r.n}"><rect class="bgr" x="0" y="${y - RH / 2}" width="${Wc}" height="${RH}" rx="8" fill="transparent"/>
      <text x="${LW}" y="${y + 4}" text-anchor="end" fill="${C.text}" font-size="12.5">${esc(r.c.title)}  ${ICON[r.c.key] || ""}</text>
      <line x1="${Math.min(a, b)}" x2="${Math.max(a, b)}" y1="${y}" y2="${y}" stroke="rgba(${C.inkA},.25)" stroke-width="2"/>
      <circle cx="${b}" cy="${y + tie}" r="6.5" fill="${MODELS.gemma.color}" stroke="${C.stroke}" stroke-width="2" data-m="gemma" data-v="${r.gemma}" style="filter:drop-shadow(0 0 5px ${MODELS.gemma.color})"/>
      <circle cx="${a}" cy="${y - tie}" r="6.5" fill="${MODELS.clap.color}" stroke="${C.stroke}" stroke-width="2" data-m="clap" data-v="${r.clap}" style="filter:drop-shadow(0 0 5px ${MODELS.clap.color})"/></g>`;
  });
  s += `</svg>`;
  box.querySelector("svg")?.remove(); box.insertAdjacentHTML("afterbegin", s);
  box.onmousemove = e => {
    const c = e.target.closest("circle[data-m]"), g = e.target.closest(".rowhit");
    if (c) ctip(box, `<b>${MODELS[c.dataset.m].name}</b>: ${c.dataset.v} of 10 right · click to run`, e);
    else if (g) { const r = rows.find(r => r.n === +g.dataset.n); ctip(box, `${esc(r.c.title)}: CLAP <b>${r.clap}</b> · Gemma <b>${r.gemma}</b>`, e); }
    else ctip(box, null);
  };
  box.onmouseleave = () => ctip(box, null);
  box.onclick = e => {
    const g = e.target.closest(".rowhit"); if (!g) return;
    const c = e.target.closest("circle[data-m]");
    if (c) { S.model = c.dataset.m; renderModels(); runChip(+g.dataset.n, false); } else runChip(+g.dataset.n, true);
    goTop();
  };
  const avg = m => rows.reduce((a, r) => a + r[m], 0) / rows.length;
  const sounds = rows.filter(r => !["angry", "sad"].includes(r.c.key));
  $("t-clap").innerHTML = `${avg("clap").toFixed(1)}<small> / 10</small>`;
  $("t-gemma").innerHTML = `${avg("gemma").toFixed(1)}<small> / 10</small>`;
  const good = sounds.filter(r => r.clap >= 8).length, gWin = rows.filter(r => r.gemma > r.clap).map(r => r.c.title);
  $("pts-words").innerHTML = `
    <li><mark class="hl">CLAP names sound events</mark>: ${good} of ${sounds.length} sound searches get 8+ of 10 right, from a text description alone.</li>
    <li><b>Gemma mostly can't</b> (avg ${avg("gemma").toFixed(1)}), yet it is the one that finds <b>the news anchor</b> in real podcasts: it hears <mark class="hl">how people talk</mark>, not what makes a noise.${gWin.length ? ` It beats CLAP only on ${gWin.map(esc).join(", ")}.` : ""}</li>
    <li><b>Mood words score 0 for both.</b> That is not the end of the story ↓</li>`;
}
function chartEmo() {
  const box = $("ch-emo"), labs = Object.keys(EMO).filter(l => IT.some(t => isEmo(t) && t.label === l));
  if (!labs.length) { box.closest(".sec").style.display = "none"; return; }
  const rows = labs.map(l => ({l, clap: typical(l, "clap"), gemma: typical(l, "gemma")})).sort((a, b) => b.clap - a.clap);
  const Wc = box.clientWidth, LW = 120, X0 = LW + 12, X1 = Wc - 40, RH = 44, top = 18, Hc = top + rows.length * RH + 28;
  const x = v => X0 + v / 10 * (X1 - X0), mx = 6;
  const xs = v => X0 + v / mx * (X1 - X0);
  let s = `<svg viewBox="0 0 ${Wc} ${Hc}" height="${Hc}">`;
  for (let v = 0; v <= mx; v++) s += `<line x1="${xs(v)}" x2="${xs(v)}" y1="${top}" y2="${Hc - 24}" stroke="rgba(${C.inkA},${v ? .06 : .16})"/>
    <text x="${xs(v)}" y="${Hc - 8}" fill="${C.mut}" font-size="11" text-anchor="middle">${v}</text>`;
  const ch = xs(10 / 6);
  rows.forEach((r, k) => {
    const y = top + k * RH + 8;
    s += `<g class="rowhit" data-l="${r.l}"><rect class="bgr" x="0" y="${y - 6}" width="${Wc}" height="${RH - 2}" rx="8" fill="transparent"/>
      <text x="${LW}" y="${y + 16}" text-anchor="end" fill="${C.text}" font-size="13">${EMO[r.l]}  ${EMO_ICON[r.l]}</text>
      <rect x="${X0}" y="${y + 2}" width="${xs(r.clap) - X0}" height="12" rx="4" fill="${MODELS.clap.color}" data-m="clap" data-v="${r.clap.toFixed(1)}"/>
      <rect x="${X0}" y="${y + 17}" width="${xs(r.gemma) - X0}" height="12" rx="4" fill="${MODELS.gemma.color}" data-m="gemma" data-v="${r.gemma.toFixed(1)}"/>
      <text x="${xs(r.clap) + 6}" y="${y + 12}" fill="${C.text}" font-size="11.5" font-weight="600">${r.clap.toFixed(1)}</text></g>`;
  });
  s += `<line x1="${ch}" x2="${ch}" y1="${top - 8}" y2="${Hc - 24}" stroke="${C.soft}" stroke-dasharray="4 4" stroke-width="1.5"/>
    <text x="${ch + 5}" y="${top - 2}" fill="${C.soft}" font-size="11">chance 1.7</text></svg>`;
  box.querySelector("svg")?.remove(); box.insertAdjacentHTML("afterbegin", s);
  box.onmousemove = e => {
    const b = e.target.closest("rect[data-m]");
    if (b) ctip(box, `<b>${MODELS[b.dataset.m].name}</b>: ${b.dataset.v} of 10 neighbours share the mood · click to try`, e); else ctip(box, null);
  };
  box.onmouseleave = () => ctip(box, null);
  box.onclick = e => {
    const g = e.target.closest(".rowhit"); if (!g) return;
    const b = e.target.closest("rect[data-m]"); if (b) { S.model = b.dataset.m; renderModels(); }
    const lab = g.dataset.l;
    let best = null, bs = -1;
    for (const t of IT) if (isEmo(t) && t.label === lab) {
      const sc = DATA.nn[M()][t.i].slice(0, 10).filter(j => IT[j].label === lab).length; if (sc > bs) { bs = sc; best = t.i; }
    }
    if (best !== null) { runSimilar(best); goTop(); }
  };
  const angry = DATA.chips.find(c => c.key === "angry");
  const typed = angry ? Math.max(chipScore(angry, "clap"), chipScore(angry, "gemma")) : 0, clicked = typical("ANG", "clap");
  $("t-typed").innerHTML = `${typed}<small> / 10</small>`;
  $("t-clicked").innerHTML = `${clicked.toFixed(1)}<small> / 10</small>`;
  const top2 = rows.slice(0, 2).map(r => EMO[r.l]);
  $("pts-emo").innerHTML = `
    <li><mark class="hl">Encoded, not nameable</mark>: the words “an angry voice” find ${typed} angry clips, but an angry clip's neighbours are angry ${(clicked / (10 / 6)).toFixed(1)}× more often than chance.</li>
    <li><b>Coarse, though.</b> ${top2.join(" and ")} stand out; the other moods sit near chance. Good for “find more like this”, <mark class="hl">not for labelling</mark> anyone's mood.</li>
    <li><b>CLAP beats Gemma here too</b>, even though Gemma is the speech model: CLAP keeps more of the voice itself.</li>`;
}
function collectionCards() {
  $("colcards").innerHTML = present.map(c => {
    const pts = IT.filter(t => t.col === c), m = new Map();
    pts.forEach(t => { const l = kindOf(t); m.set(l, (m.get(l) || 0) + 1); });
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const shown = c === "podcasts" ? 10 : 14;
    const ic = l => c === "voices" && Object.values(EMO).includes(l) ? EMO_ICON[Object.keys(EMO).find(k => EMO[k] === l)] + " " : "";
    const body = `<canvas class="cmap" data-col="${c}"></canvas><div class="pills">${top.slice(0, shown).map(([l, n]) => `<span>${ic(l)}${esc(l)}${c === "podcasts" ? ` <b>${n}</b>` : ""}</span>`).join("")}${top.length > shown ? `<span>+${top.length - shown} more</span>` : ""}</div>`;
    return `<div class="ccard" style="--c:${COLS[c].color}"><h3><i></i>${COLS[c].name}</h3><div class="big">${pts.length.toLocaleString()}</div>
      <div class="src">${COLS[c].src} · ${top.length} kinds</div>${body}<button class="rand" data-col="${c}">▶ Play a random one</button></div>`;
  }).join("");
  document.querySelectorAll(".cmap").forEach(cm => {
    const d = Math.min(2, devicePixelRatio || 1), w = cm.clientWidth, h = cm.clientHeight, g = cm.getContext("2d");
    cm.width = w * d; cm.height = h * d; g.setTransform(d, 0, 0, d, 0, 0);
    const X = t => 8 + t.x * (w - 16), Y = t => 8 + (1 - t.y) * (h - 16);
    g.fillStyle = `rgba(${C.inkA},.14)`;
    for (const t of IT) if (t.col !== cm.dataset.col) g.fillRect(X(t), Y(t), 1.2, 1.2);
    const col = COLS[cm.dataset.col].color, gl = sprite(col, 6);
    g.globalCompositeOperation = C.glow; g.globalAlpha = .12 * C.glowK;
    for (const t of IT) if (t.col === cm.dataset.col) g.drawImage(gl, X(t) - 6, Y(t) - 6, 12, 12);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = .9; g.fillStyle = col;
    for (const t of IT) if (t.col === cm.dataset.col) g.fillRect(X(t) - .8, Y(t) - .8, 1.6, 1.6);
  });
  $("colcards").onclick = e => {
    const b = e.target.closest(".rand"); if (!b) return;
    const pts = IT.filter(t => t.col === b.dataset.col), t = pts[Math.floor(Math.random() * pts.length)];
    play(t.i); flyTo([t.i]);
  };
}
function sparks() {
  for (const id of ["spark1", "spark2"]) $(id).innerHTML = Array.from({length: 12}, (_, k) => `<i style="height:${6 + Math.abs(Math.sin(k * 1.7 + (id === "spark2" ? .4 : 0))) * 20}px"></i>`).join("");
}

// ---------- theme toggle ----------
function renderThemeBtn() { $("theme").innerHTML = THEME === "dark" ? "☀️ Light" : "🌙 Dark"; }
$("theme").onclick = () => {
  THEME = THEME === "dark" ? "light" : "dark";
  try { localStorage.setItem("ss-theme", THEME); } catch (e) {}
  setPalette(); renderThemeBtn();
  renderLayers(); renderLegend(); renderChips(); renderPanel(); renderMini(); chartWords(); chartEmo(); collectionCards();
  if (S.playing !== null) showDock();
  baseDirty = true; kick();
};

// ---------- boot ----------
function boot() {
  renderThemeBtn(); renderLayers(); renderModels(); renderLegend(); renderChips(); renderPanel(); sparks();
  countUp($("st-clips"), IT.length);
  countUp($("st-kinds"), new Set(IT.map(t => t.col + t.label)).size);
  resize(); renderMini();
  chartWords(); chartEmo(); collectionCards();
  typePH();
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { resize(); chartWords(); chartEmo(); collectionCards(); }, 120); });
  // deep links: #chip=cough, #ex=0, #q=a door slamming, #play=123
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("chip")) { const n = DATA.chips.findIndex(c => c.key === h.get("chip")); if (n >= 0) runChip(n, true); }
  else if (h.get("ex")) runSimilar(EXAMPLES[+h.get("ex")].idx, +h.get("ex"));
  else if (h.get("q")) { $("q").value = h.get("q"); runText(h.get("q")); }
  if (h.get("play")) { S.playing = +h.get("play"); showDock(); kick(); }
  if (h.has("light")) $("theme").click();   // screenshots only
}
boot();
