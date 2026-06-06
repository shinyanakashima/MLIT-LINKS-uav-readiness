"use strict";

/*
 * 防災・災害対応ドローン即応リソースマップ
 * data/processed/readiness.json（市区町村別の集計）を読み込み、出発地重心に円マーカーを描く。
 * 申請（計画）ベースの推定であることを UI 全体で明示する。
 */

const METRIC_INFO = {
  score:    { label: "即応度スコア", hint: "災害対応計画を能力で重み付け（完全対応×3＋夜間/目視外×2＋その他×1）。夜間×目視外の災害対応運用が集まる地域ほど高くなります。" },
  full:     { label: "完全対応（夜間×目視外）", hint: "夜間と目視外の両方に対応した災害対応計画の数。停電下・広域捜索など、災害時に最も使える運用の目安です。" },
  night:    { label: "夜間対応", hint: "夜間飛行に対応した災害対応計画の数。" },
  bvlos:    { label: "目視外対応", hint: "目視外飛行に対応した災害対応計画の数。広域・長距離の捜索や被害把握に関わります。" },
  disaster: { label: "災害対応 計画数", hint: "「事故・災害対応等」を目的に含む飛行計画の数（包括申請とみられる多目的行は除外済み）。" },
};

const COLORS = ["#3a4654", "#ffe08a", "#ffb74d", "#ff8a3d", "#f4502f", "#c81e1e"];

const state = {
  data: null,
  munis: [],
  metric: "score",
  filters: { night: false, bvlos: false, full: false, tokachi: false, pref: "", kind: "" },
  layer: null,
  map: null,
  breaks: [],
};

function $(sel) { return document.querySelector(sel); }

function quantileBreaks(values) {
  // 非ゼロ値から5分位の閾値を作る（外れ値に強い色分け）。
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [1, 2, 3, 4, 5];
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const raw = [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
  // 重複を除いて単調増加に整える
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
  const drones = Object.entries(m.drones || {})
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/（.*?）/g, "")}: ${v}`)
    .join("<br>");
  return `
    <h4>${m.name || "（出発地不明）"}</h4>
    <table>
      <tr><td class="k">即応度スコア</td><td class="v">${m.score}</td></tr>
      <tr><td class="k">災害対応 計画数</td><td class="v">${m.disaster}</td></tr>
      <tr><td class="k">夜間対応</td><td class="v">${m.night}</td></tr>
      <tr><td class="k">目視外対応</td><td class="v">${m.bvlos}</td></tr>
      <tr><td class="k">完全対応（夜間×目視外）</td><td class="v"><b>${m.full}</b></td></tr>
    </table>
    ${drones ? `<div class="drones">機体の種類（上位）<br>${drones}</div>` : ""}
  `;
}

function render() {
  const metric = state.metric;
  const shown = state.munis.filter(passesFilter);
  const mapped = shown.filter((m) => m.lat != null && m.lon != null);
  const values = mapped.map((m) => m[metric]);
  state.breaks = quantileBreaks(values);
  const maxVal = Math.max(1, ...values);

  // markers
  if (state.layer) state.layer.clearLayers();
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
    marker.bindTooltip(`${m.name}：${METRIC_INFO[metric].label} ${val}`);
    marker._muni = m;
    marker.addTo(state.layer);
  }

  updateLegend(metric);
  updateStats(shown, mapped);
  updateRanking(shown, metric);
}

function updateLegend(metric) {
  const b = state.breaks;
  const labels = [];
  labels.push(`0`);
  let prev = 0;
  for (let i = 0; i < b.length; i++) {
    const lo = prev + (i === 0 ? 1 : 0);
    labels.push(`${i === 0 ? 1 : prev + 1}–${b[i]}`);
    prev = b[i];
  }
  labels.push(`${prev + 1}+`);
  let rows = "";
  for (let i = 0; i < COLORS.length; i++) {
    const sz = 8 + i * 3;
    rows += `<div class="scale"><span class="dot" style="width:${sz}px;height:${sz}px;background:${COLORS[i]}"></span>${labels[i] || ""}</div>`;
  }
  $("#legend").innerHTML = `
    <h3>${METRIC_INFO[metric].label}</h3>
    ${rows}
    <div class="note">円の大きさ・濃さが値の大きさ。色分けは表示中データの分位。</div>`;
}

function updateStats(shown, mapped) {
  const sum = (key) => shown.reduce((a, m) => a + (m[key] || 0), 0);
  const noGeo = shown.length - mapped.length;
  const rows = [
    ["表示中の市区町村", shown.length.toLocaleString()],
    ["災害対応 計画数（合計）", sum("disaster").toLocaleString()],
    ["うち夜間対応", sum("night").toLocaleString()],
    ["うち目視外対応", sum("bvlos").toLocaleString()],
    ["うち完全対応", sum("full").toLocaleString()],
  ];
  let html = rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join("");
  if (noGeo > 0) html += `<div class="row muted"><span>座標なし（地図非表示）</span><span>${noGeo}</span></div>`;
  $("#stats").innerHTML = html;
}

function updateRanking(shown, metric) {
  const top = [...shown].sort((a, b) => b[metric] - a[metric] || b.disaster - a.disaster).slice(0, 30);
  $("#rank-count").textContent = `（上位${top.length} / ${shown.length}）`;
  const ol = $("#ranking");
  ol.innerHTML = "";
  for (const m of top) {
    const li = document.createElement("li");
    li.innerHTML = `${m.name || "（出発地不明）"}<span class="val">${m[metric]}</span>`;
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
  document.querySelectorAll('input[name="metric"]').forEach((el) => {
    el.addEventListener("change", () => {
      state.metric = el.value;
      $("#metric-hint").textContent = METRIC_INFO[el.value].hint;
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
    document.querySelectorAll('.check-group input').forEach((c) => (c.checked = false));
    $("#pref-select").value = ""; $("#kind-select").value = "";
    render();
  });
  $("#metric-hint").textContent = METRIC_INFO[state.metric].hint;
}

function initMeta() {
  const meta = state.data.meta;
  $("#disclaimer").textContent = meta.disclaimer || "";
  $("#attribution").innerHTML =
    `出典：<a href="${meta.source_url}" target="_blank" rel="noopener">国土交通省 Project LINKS『無人航空機飛行計画データ（2025年度）』</a>を加工して作成。`
    + ` 対象期間 ${meta.period}。総計画 ${Number(meta.total_plans).toLocaleString()} 件のうち災害対応 ${Number(meta.disaster_plans).toLocaleString()} 件を集計（包括申請とみられる ${Number(meta.comprehensive_skipped).toLocaleString()} 件は除外）。`;
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
  initMap();
  try {
    const res = await fetch("data/processed/readiness.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.data = await res.json();
  } catch (err) {
    $("#loading").textContent = "データの読み込みに失敗しました: " + err.message;
    return;
  }
  state.munis = state.data.municipalities || [];
  initMeta();
  populateControls();
  wireControls();
  render();
  $("#loading").classList.add("done");
}

document.addEventListener("DOMContentLoaded", main);
