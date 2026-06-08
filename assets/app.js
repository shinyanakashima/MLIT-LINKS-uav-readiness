"use strict";

/*
 * 防災・災害対応ドローン即応リソースマップ / Disaster-Response Drone Readiness Map
 * data/processed/readiness.json（市区町村別の集計）を読み込み、出発地重心に円マーカーを描く。
 * 申請（計画）ベースの推定であることを UI 全体で明示する。
 * 日本語／英語の表示切替に対応（地名・機体種別は出典データの正式名称のため和名のまま）。
 */

const I18N = {
  ja: {
    htmlLang: "ja",
    title: "防災・災害対応ドローン即応リソースマップ",
    lead: '夜間・目視外に対応した「災害対応」ドローン運用が、どの地域にどれだけ分布しているかの<strong>推定</strong>。',
    h_metric: "表示する指標",
    h_filter: "能力フィルタ",
    h_stats: "集計サマリ",
    h_rank: "即応度ランキング",
    h_notice: "ご利用にあたって",
    f_night: "夜間対応あり",
    f_bvlos: "目視外対応あり",
    f_full: "完全対応あり（夜間×目視外）",
    f_tokachi: "北海道・十勝管内のみ",
    l_pref: "都道府県",
    l_kind: "機体の種類",
    opt_all: "すべて",
    reset: "フィルタをリセット",
    loading: "データを読み込み中…",
    load_fail: "データの読み込みに失敗しました: ",
    legend_note: "円の大きさ・濃さが値の大きさ。色分けは表示中データの分位。",
    static_disclaimer: "本マップは飛行計画（申請）ベースの推定であり、実際の出動可能性・実飛行・各事業者の実態を保証するものではありません。災害協定等の検討にあたっては一次情報での確認をお願いします。",
    disclaimer: "本データは飛行計画（申請）ベースであり、実飛行・実出動能力を示すものではありません。出典資料はスキャン抽出のため完全性・正確性は保証されません。",
    unknown: "（出発地不明）",
    m_score: "即応度スコア",
    m_full: "完全対応（夜間×目視外）",
    m_night: "夜間対応",
    m_bvlos: "目視外対応",
    m_disaster: "災害対応 計画数",
    hint: {
      score: "災害対応計画を能力で重み付け（完全対応×3＋夜間/目視外×2＋その他×1）。夜間×目視外の災害対応運用が集まる地域ほど高くなります。",
      full: "夜間と目視外の両方に対応した災害対応計画の数。停電下・広域捜索など、災害時に最も使える運用の目安です。",
      night: "夜間飛行に対応した災害対応計画の数。",
      bvlos: "目視外飛行に対応した災害対応計画の数。広域・長距離の捜索や被害把握に関わります。",
      disaster: "「事故・災害対応等」を目的に含む飛行計画の数（包括申請とみられる多目的行は除外済み）。",
    },
    stats: {
      munis: "表示中の市区町村",
      disaster: "災害対応 計画数（合計）",
      night: "うち夜間対応",
      bvlos: "うち目視外対応",
      full: "うち完全対応",
      nogeo: "座標なし（地図非表示）",
    },
    popup: {
      score: "即応度スコア",
      disaster: "災害対応 計画数",
      night: "夜間対応",
      bvlos: "目視外対応",
      full: "完全対応（夜間×目視外）",
      drones: "機体の種類（上位）",
    },
    rankCount: (n, m) => `（上位${n} / ${m}）`,
    tooltip: (name, label, val) => `${name}：${label} ${val}`,
    attribution: (meta) =>
      `出典：<a href="${meta.source_url}" target="_blank" rel="noopener">国土交通省 Project LINKS『無人航空機飛行計画データ（2025年度）』</a>を加工して作成。`
      + ` 対象期間 ${meta.period}。総計画 ${num(meta.total_plans)} 件のうち災害対応 ${num(meta.disaster_plans)} 件を集計（包括申請とみられる ${num(meta.comprehensive_skipped)} 件は除外）。`,
  },
  en: {
    htmlLang: "en",
    title: "Disaster-Response Drone Readiness Map",
    lead: 'An <strong>estimate</strong> of where night- and beyond-visual-line-of-sight (BVLOS) capable "disaster-response" drone operations are distributed across Japan.',
    h_metric: "Metric",
    h_filter: "Capability filters",
    h_stats: "Summary",
    h_rank: "Readiness ranking",
    h_notice: "About this data",
    f_night: "Night-capable only",
    f_bvlos: "BVLOS-capable only",
    f_full: "Full capability only (night × BVLOS)",
    f_tokachi: "Hokkaido / Tokachi subprefecture only",
    l_pref: "Prefecture",
    l_kind: "Aircraft type",
    opt_all: "All",
    reset: "Reset filters",
    loading: "Loading data…",
    load_fail: "Failed to load data: ",
    legend_note: "Circle size and shade reflect the value. Color classes are quantiles of the data currently shown.",
    static_disclaimer: "This map is an estimate based on flight-plan applications. It does not guarantee actual dispatch capability, actual flights, or any operator's real-world capacity. Please verify against primary sources when considering disaster-response agreements.",
    disclaimer: "This data is based on flight plans (applications) and does not indicate actual flights or dispatch capability. Source documents are extracted from scanned materials, so completeness and accuracy are not guaranteed.",
    unknown: "(origin unknown)",
    m_score: "Readiness score",
    m_full: "Full capability (night × BVLOS)",
    m_night: "Night-capable",
    m_bvlos: "BVLOS-capable",
    m_disaster: "Disaster-response plans",
    hint: {
      score: "Disaster-response plans weighted by capability (full × 3 + night/BVLOS × 2 + others × 1). Areas where night × BVLOS disaster operations concentrate score higher.",
      full: "Number of disaster-response plans capable of both night and BVLOS flight — the best proxy for operations usable in a disaster (e.g. power outages, wide-area search).",
      night: "Number of disaster-response plans capable of night flight.",
      bvlos: "Number of disaster-response plans capable of BVLOS flight, relevant to wide-area / long-range search and damage assessment.",
      disaster: "Number of flight plans whose purpose includes \"accident / disaster response\" (likely blanket multi-purpose applications are excluded).",
    },
    stats: {
      munis: "Municipalities shown",
      disaster: "Disaster-response plans (total)",
      night: "of which night-capable",
      bvlos: "of which BVLOS-capable",
      full: "of which full capability",
      nogeo: "No coordinates (not mapped)",
    },
    popup: {
      score: "Readiness score",
      disaster: "Disaster-response plans",
      night: "Night-capable",
      bvlos: "BVLOS-capable",
      full: "Full capability (night × BVLOS)",
      drones: "Aircraft types (top)",
    },
    rankCount: (n, m) => `(top ${n} / ${m})`,
    tooltip: (name, label, val) => `${name}: ${label} ${val}`,
    attribution: (meta) =>
      `Source: created by processing <a href="${meta.source_url}" target="_blank" rel="noopener">MLIT Project LINKS "UAV Flight Plan Data (FY2025)"</a>.`
      + ` Period ${meta.period}. Of ${num(meta.total_plans)} total plans, ${num(meta.disaster_plans)} disaster-response plans were aggregated (${num(meta.comprehensive_skipped)} likely blanket applications excluded).`,
  },
};

const METRIC_KEYS = ["score", "full", "night", "bvlos", "disaster"];
const COLORS = ["#3a4654", "#ffe08a", "#ffb74d", "#ff8a3d", "#f4502f", "#c81e1e"];

const state = {
  lang: "ja",
  data: null,
  munis: [],
  metric: "score",
  filters: { night: false, bvlos: false, full: false, tokachi: false, pref: "", kind: "" },
  layer: null,
  map: null,
  breaks: [],
};

function $(sel) { return document.querySelector(sel); }
function num(n) { return Number(n).toLocaleString(); }
function t() { return I18N[state.lang]; }
function metricLabel(key) { return t()["m_" + key]; }

function quantileBreaks(values) {
  // 非ゼロ値から5分位の閾値を作る（外れ値に強い色分け）。
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [1, 2, 3, 4, 5];
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const raw = [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
  const out = [];
  for (const x of raw) {
    const last = out.length ? out[out.length - 1] : 0;
    out.push(x > last ? x : last + 1);
  }
  return out;
}

function colorFor(value) {
  if (!value || value <= 0) return COLORS[0];
  const b = state.breaks;
  for (let i = 0; i < b.length; i++) {
    if (value <= b[i]) return COLORS[i + 1];
  }
  return COLORS[COLORS.length - 1];
}

function radiusFor(value, maxVal) {
  if (!value || value <= 0) return 4;
  const r = 5 + 22 * Math.sqrt(value / maxVal);
  return Math.max(5, Math.min(30, r));
}

function passesFilter(m) {
  const f = state.filters;
  if (f.night && m.night <= 0) return false;
  if (f.bvlos && m.bvlos <= 0) return false;
  if (f.full && m.full <= 0) return false;
  if (f.tokachi && !m.tokachi) return false;
  if (f.pref && m.pref !== f.pref) return false;
  if (f.kind && !(m.drones && m.drones[f.kind] > 0)) return false;
  return true;
}

function popupHtml(m) {
  const L = t();
  const drones = Object.entries(m.drones || {})
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/（.*?）/g, "")}: ${v}`)
    .join("<br>");
  return `
    <h4>${m.name || L.unknown}</h4>
    <table>
      <tr><td class="k">${L.popup.score}</td><td class="v">${m.score}</td></tr>
      <tr><td class="k">${L.popup.disaster}</td><td class="v">${m.disaster}</td></tr>
      <tr><td class="k">${L.popup.night}</td><td class="v">${m.night}</td></tr>
      <tr><td class="k">${L.popup.bvlos}</td><td class="v">${m.bvlos}</td></tr>
      <tr><td class="k">${L.popup.full}</td><td class="v"><b>${m.full}</b></td></tr>
    </table>
    ${drones ? `<div class="drones">${L.popup.drones}<br>${drones}</div>` : ""}
  `;
}

function render() {
  const metric = state.metric;
  const shown = state.munis.filter(passesFilter);
  const mapped = shown.filter((m) => m.lat != null && m.lon != null);
  const values = mapped.map((m) => m[metric]);
  state.breaks = quantileBreaks(values);
  const maxVal = Math.max(1, ...values);

  if (state.layer) state.layer.clearLayers();
  const label = metricLabel(metric);
  for (const m of mapped) {
    const val = m[metric];
    const marker = L.circleMarker([m.lat, m.lon], {
      radius: radiusFor(val, maxVal),
      fillColor: colorFor(val),
      color: "#0b1118",
      weight: 1,
      fillOpacity: val > 0 ? 0.82 : 0.35,
    });
    marker.bindPopup(popupHtml(m));
    marker.bindTooltip(t().tooltip(m.name || t().unknown, label, val));
    marker._muni = m;
    marker.addTo(state.layer);
  }

  updateLegend(metric);
  updateStats(shown, mapped);
  updateRanking(shown, metric);
}

function updateLegend(metric) {
  const b = state.breaks;
  const labels = ["0"];
  let prev = 0;
  for (let i = 0; i < b.length; i++) {
    labels.push(`${i === 0 ? 1 : prev + 1}–${b[i]}`);
    prev = b[i];
  }
  labels.push(`${prev + 1}+`);
  let rows = "";
  for (let i = 0; i < COLORS.length; i++) {
    const sz = 8 + i * 3;
    rows += `<div class="scale"><span class="dot" style="width:${sz}px;height:${sz}px;background:${COLORS[i]}"></span>${labels[i] || ""}</div>`;
  }
  $("#legend").innerHTML = `<h3>${metricLabel(metric)}</h3>${rows}<div class="note">${t().legend_note}</div>`;
}

function updateStats(shown, mapped) {
  const L = t();
  const sum = (key) => shown.reduce((a, m) => a + (m[key] || 0), 0);
  const noGeo = shown.length - mapped.length;
  const rows = [
    [L.stats.munis, num(shown.length)],
    [L.stats.disaster, num(sum("disaster"))],
    [L.stats.night, num(sum("night"))],
    [L.stats.bvlos, num(sum("bvlos"))],
    [L.stats.full, num(sum("full"))],
  ];
  let html = rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join("");
  if (noGeo > 0) html += `<div class="row muted"><span>${L.stats.nogeo}</span><span>${noGeo}</span></div>`;
  $("#stats").innerHTML = html;
}

function updateRanking(shown, metric) {
  const L = t();
  const top = [...shown].sort((a, b) => b[metric] - a[metric] || b.disaster - a.disaster).slice(0, 30);
  $("#rank-count").textContent = L.rankCount(top.length, shown.length);
  const ol = $("#ranking");
  ol.innerHTML = "";
  for (const m of top) {
    const li = document.createElement("li");
    li.innerHTML = `${m.name || L.unknown}<span class="val">${m[metric]}</span>`;
    li.addEventListener("click", () => focusMuni(m));
    ol.appendChild(li);
  }
}

function focusMuni(m) {
  if (m.lat == null || m.lon == null) return;
  state.map.flyTo([m.lat, m.lon], 9, { duration: 0.6 });
  let found = null;
  state.layer.eachLayer((l) => { if (l._muni && l._muni.name === m.name) found = l; });
  if (found) setTimeout(() => found.openPopup(), 650);
}

function applyStaticI18n() {
  const L = t();
  document.documentElement.lang = L.htmlLang;
  document.title = L.title;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (L[key] != null) el.textContent = L[key];
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (L[key] != null) el.innerHTML = L[key];
  });
  // 「すべて / All」option（先頭）の文言を更新（データ由来の選択肢は維持）。
  for (const id of ["#pref-select", "#kind-select"]) {
    const opt = document.querySelector(id + " option[value='']");
    if (opt) opt.textContent = L.opt_all;
  }
  $("#metric-hint").textContent = L.hint[state.metric];
  if (state.data) initMeta();
}

function setLang(lang) {
  if (!I18N[lang] || lang === state.lang) {
    if (lang === state.lang) return;
  }
  state.lang = lang;
  document.querySelectorAll("#lang-switch button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === lang);
  });
  applyStaticI18n();
  render();
}

function populateControls() {
  const prefs = [...new Set(state.munis.map((m) => m.pref).filter(Boolean))].sort();
  const ps = $("#pref-select");
  for (const p of prefs) {
    const o = document.createElement("option");
    o.value = p; o.textContent = p; ps.appendChild(o);
  }
  const kinds = Object.keys(state.data.meta.drone_kinds || {});
  const ks = $("#kind-select");
  for (const k of kinds) {
    const o = document.createElement("option");
    o.value = k; o.textContent = k; ks.appendChild(o);
  }
}

function wireControls() {
  document.querySelectorAll("#lang-switch button").forEach((b) => {
    b.addEventListener("click", () => setLang(b.dataset.lang));
  });
  document.querySelectorAll('input[name="metric"]').forEach((el) => {
    el.addEventListener("change", () => {
      state.metric = el.value;
      $("#metric-hint").textContent = t().hint[el.value];
      render();
    });
  });
  const bindCheck = (id, key) => $(id).addEventListener("change", (e) => { state.filters[key] = e.target.checked; render(); });
  bindCheck("#f-night", "night");
  bindCheck("#f-bvlos", "bvlos");
  bindCheck("#f-full", "full");
  bindCheck("#f-tokachi", "tokachi");
  $("#pref-select").addEventListener("change", (e) => { state.filters.pref = e.target.value; render(); });
  $("#kind-select").addEventListener("change", (e) => { state.filters.kind = e.target.value; render(); });
  $("#reset-btn").addEventListener("click", () => {
    state.filters = { night: false, bvlos: false, full: false, tokachi: false, pref: "", kind: "" };
    document.querySelectorAll(".check-group input").forEach((c) => (c.checked = false));
    $("#pref-select").value = ""; $("#kind-select").value = "";
    render();
  });
}

function initMeta() {
  const meta = state.data.meta;
  $("#disclaimer").textContent = t().disclaimer;
  $("#attribution").innerHTML = t().attribution(meta);
}

function initMap() {
  const map = L.map("map", { preferCanvas: true, zoomControl: true }).setView([37.8, 138.2], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  state.map = map;
  state.layer = L.layerGroup().addTo(map);
}

async function main() {
  applyStaticI18n();
  initMap();
  try {
    const res = await fetch("data/processed/readiness.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.data = await res.json();
  } catch (err) {
    $("#loading").textContent = t().load_fail + err.message;
    return;
  }
  state.munis = state.data.municipalities || [];
  initMeta();
  populateControls();
  wireControls();
  applyStaticI18n();
  render();
  $("#loading").classList.add("done");
}

document.addEventListener("DOMContentLoaded", main);
