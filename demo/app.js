/* ── Prove It · demo ──────────────────────────────────────────────────── */
(() => {
'use strict';

const activeModel = new URL(location.href).searchParams.get('model') === 'luna' ? 'luna' : 'deepseek';
const modelResults = window.MODEL_RESULTS?.[activeModel];
const selectedRun = new URL(location.href).searchParams.get('run');
const modelData = modelResults?.runs?.find(r=>r.run_id===selectedRun) || modelResults;
const D = window.DEMO && { ...window.DEMO, ...modelData,
  geometry: { ...window.DEMO.geometry, models: [...new Set((modelData?.claims || window.DEMO.claims).flatMap(c=>(c.models||[]).map(m=>m.model)))], runs: [modelData?.run_id || window.DEMO.run_id] } };
if (!D) {
  document.body.innerHTML =
    '<p style="padding:40px;color:#8b95a3;font:14px system-ui">data.js missing — run <code>python demo/build_assets.py</code></p>';
  return;
}

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (n, d, dp = 1) => d ? (n / d * 100).toFixed(dp) : '0.0';

/* ── verdict vocabulary (comes from the run output) ─────────────────── */
const ORDER = ['supported', 'refuted', 'no_evidence', 'needs_review', 'error', 'pending'];
const VLABEL = { supported: 'Supported', refuted: 'Refuted', no_evidence: 'No evidence', low_confidence: 'Low confidence', needs_review: 'Low confidence', error: 'Scan failed', pending: 'Not analysed' };
const VSHORT = { supported: 'Supported', refuted: 'Refuted', no_evidence: 'No evidence', low_confidence: 'Low confidence', needs_review: 'Review', error: 'Failed', pending: 'Not analysed' };
const VHEX   = { supported: '#2ea043', refuted: '#d43f3a', no_evidence: '#8b95a3', low_confidence: '#b9820c', needs_review: '#b9820c', error: '#d43f3a', pending: '#4c5766' };

const stateOf = c => ['pending','error'].includes(c.status) ? c.status : (c.verdict || 'needs_review');

/* ── derived stats: nothing hardcoded ───────────────────────────────── */
const claims = D.claims;
const scenes = D.scenes;
const sceneById = new Map(scenes.map(s => [s.sceneId, s]));
for (const [id,key] of [['showLuna','luna'],['showDeepseek','deepseek']]) {
  $('#'+id).setAttribute('aria-pressed',String(activeModel===key));
  $('#'+id).onclick=()=>{const url=new URL(location.href);url.searchParams.set('model',key);url.searchParams.delete('run');location.assign(url.href);};
}
const levelLabel=value=>value==='xhigh'?'Extra high':value==='none'?'Off':value==='not recorded'?'Not recorded':value==='mixed'?'Mixed':value?value[0].toUpperCase()+value.slice(1):'Not recorded';
const displayRunDate=id=>{const date=new Date(id.replace(/T(\d{2})-(\d{2})-(\d{2})/,'T$1:$2:$3'));return Number.isNaN(date.getTime())?'Saved run':date.toLocaleString('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'});};
$('#runSelect').innerHTML='<option value="">Current results · latest per scene</option>'+(modelResults?.runs||[]).map((r,i)=>'<option value="'+esc(r.run_id)+'">'+(i===0?'Latest saved · ':'')+esc(displayRunDate(r.run_id))+' · Reasoning: '+esc(levelLabel(r.reasoning_level))+'</option>').join('');
$('#runSelect').value=modelData?.historical?modelData.run_id:'';
$('#runSelect').onchange=e=>{const url=new URL(location.href);if(e.target.value)url.searchParams.set('run',e.target.value);else url.searchParams.delete('run');location.assign(url.href);};
const processed = claims.filter(c=>c.status==='ok');
$('#modelCoverage').textContent = (D.model_label || 'DeepSeek') + ' · ' + processed.length + ' of ' + claims.length + ' claims analysed' + ' · Reasoning: ' + levelLabel(D.reasoning_level) + (D.historical?' · This saved run only':'') + (claims.some(c=>c.status==='error')?' · '+claims.filter(c=>c.status==='error').length+' failed':'');
function setupScanning() {
  const dialog=$('#scanDialog'),list=scenes.filter(s=>s.claims.length);
  let token=null,watching=false;
  const completedMessage=job=>'Scan complete'+(job.errors?' · '+job.errors+' claims failed; rerun them':'')+(job.submission==='updated'?' · Team 4 submission updated':job.submission==='incomplete'?' · Submission needs complete results; previous export kept':'');
  const levels={luna:['none','low','medium','high','xhigh','max'],deepseek:['none','low','high','max']};
  const selected=()=>$$('#scanScenes input:checked').map(n=>n.value);
  const estimate=()=>{const ids=selected(),count=claims.filter(c=>ids.includes(c.sceneId)).length;$('#scanEstimate').textContent=ids.length+' scenes · '+count+' claims selected';$('#scanStart').disabled=!ids.length;$('#scanAll').checked=ids.length===list.length;$('#scanAll').indeterminate=ids.length>0&&ids.length<list.length;};
  const reasoning=()=>{$('#scanReasoning').innerHTML=levels[$('#scanModel').value].map(v=>'<option value="'+v+'">'+({none:'Off',xhigh:'Extra high'}[v]||v[0].toUpperCase()+v.slice(1))+'</option>').join('');$('#scanReasoning').value=$('#scanModel').value==='luna'?'medium':'high';};
  $('#rerunImages').onclick=()=>{
    $('#scanError').textContent='';$('#scanModel').value=activeModel;reasoning();
    $('#scanScenes').innerHTML=list.map(s=>'<label><input type="checkbox" value="'+esc(s.sceneId)+'" '+(current?.scene.sceneId===s.sceneId?'checked':'')+'>'+esc(s.sceneId)+' <span class="dim">'+s.claims.length+' claims</span></label>').join('');
    $$('#scanScenes input').forEach(n=>n.onchange=estimate);estimate();dialog.showModal();
  };
  $('#scanModel').onchange=reasoning;$('#scanAll').onchange=e=>{$$('#scanScenes input').forEach(n=>n.checked=e.target.checked);estimate();};
  $('#scanCancel').onclick=()=>dialog.close();
  async function watch(){
    if(!watching)return;
    try{const res=await fetch('/api/status');if(!res.ok)throw Error();const {job}=await res.json();
      if(job.state==='running'){$('#scanStatus').textContent='Scanning '+job.scenes+' scenes · '+job.finished+' of '+job.total+' checks finished';setTimeout(watch,2000);}
      else{watching=false;$('#rerunImages').disabled=false;if(job.state==='complete'){$('#scanStatus').textContent='Scan complete';const url=new URL(location.href);url.searchParams.set('model',job.model);url.searchParams.delete('run');location.assign(url.href);}else $('#scanStatus').textContent=job.message||'Scan stopped.';}
    }catch{$('#scanStatus').textContent='Connection interrupted; reconnecting…';setTimeout(watch,4000);}
  }
  $('#scanForm').onsubmit=async e=>{
    e.preventDefault();$('#scanError').textContent='';$('#scanStart').disabled=true;
    try{
      const session=await fetch('/api/session');if(!session.ok)throw Error('Start the viewer with demo/start_viewer.bat to enable scanning.');token=(await session.json()).token;
      const res=await fetch('/api/rerun',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':token},body:JSON.stringify({model:$('#scanModel').value,reasoning:$('#scanReasoning').value,passes:Number($('#scanPasses').value),scenes:selected()})});
      const payload=await res.json();if(!res.ok)throw Error(payload.error||'Unable to start scan.');
      dialog.close();watching=true;$('#rerunImages').disabled=true;watch();
    }catch(error){$('#scanError').textContent=error.message;estimate();}
  };
  fetch('/api/session').then(r=>r.ok?r.json():null).then(s=>{if(s){token=s.token;if(s.job.state==='running'){watching=true;$('#rerunImages').disabled=true;watch();}else if(s.job.state==='complete')$('#scanStatus').textContent=completedMessage(s.job);else if(s.job.state==='failed')$('#scanStatus').textContent=s.job.message;}else $('#scanStatus').textContent='Start demo/start_viewer.bat to enable scanning.';}).catch(()=>{$('#scanStatus').textContent='Scanning server unavailable. Start demo/start_viewer.bat.';});
}

const checkedClaims = processed;
const scannedSceneIds = new Set(scenes.filter(s=>s.claims.length&&claims.filter(c=>c.sceneId===s.sceneId).every(c=>c.status==='ok')).map(s=>s.sceneId));

const tally = list => {
  const t = { supported: 0, refuted: 0, no_evidence: 0, needs_review: 0, error: 0, pending: 0 };
  list.forEach(c => t[stateOf(c)]++);
  return t;
};
const T = tally(claims);
const CATS = [...new Set(claims.map(c => c.category))].sort();
const SITES = [...new Set(scenes.map(s => s.site))].sort();

const byCategory = new Map(CATS.map(cat => [cat, tally(claims.filter(c => c.category === cat))]));
const claimsByScene = new Map(scenes.map(s => [s.sceneId, claims.filter(c => c.sceneId === s.sceneId)]));

const STATS = {
  panoramas: scenes.length,
  scanned: scannedSceneIds.size,
  claims: claims.length,
  checked: checkedClaims.length,
  sites: SITES.length,
  sitesScanned: new Set(checkedClaims.map(c => sceneById.get(c.sceneId)?.site)).size,
  scenesWithClaims: scenes.filter(s => s.claims.length).length,
  scenesWithClaimsScanned: [...scannedSceneIds].filter(id => (sceneById.get(id)?.claims.length || 0) > 0).length,
  viewsPerScene: scenes[0]?.views.length ?? 0,
  issues: claims.filter(c=>c.verdict==='refuted'||c.low_confidence||c.status==='error').length,
};

/* ── model roll-up ──────────────────────────────────────────────────── */
const modelRoll = (() => {
  const map = new Map();
  checkedClaims.forEach(c => (c.models || []).forEach(m => {
    if (!map.has(m.modelId)) map.set(m.modelId, {
      id: m.modelId, model: m.model, n: 0, conf: 0,
      supported: 0, refuted: 0, no_evidence: 0, other: 0,
    });
    const r = map.get(m.modelId);
    r.n++; r.conf += m.confidence || 0;
    if (m.verdict in r) r[m.verdict]++; else r.other++;
  }));
  return [...map.values()].map(r => ({ ...r, meanConf: r.n ? r.conf / r.n : 0 }));
})();

const agreement = (() => {
  let agree = 0, split = 0;
  checkedClaims.forEach(c => {
    const v = (c.models || []).map(m => m.verdict);
    if (v.length >= 2) (new Set(v).size === 1) ? agree++ : split++;
  });
  return { agree, split };
})();

/* ════════════════════════════════════════════════════════════════════ */
/*  shared bits                                                        */
/* ════════════════════════════════════════════════════════════════════ */
const vPill = (state, label) =>
  `<span class="v-pill v-${state}"><span class="dot"></span>${esc(label || VLABEL[state])}</span>`;

function viewLabel(name) { if(name==='overview')return 'Overview'; const details=current?.scene.views.filter(v=>v.name!=='overview')||[]; const i=details.findIndex(v=>v.name===name);return i>=0?'Detail '+(i+1):'Detail'; }
const shortStmt = (s, n = 46) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(src));
    im.src = src;
  });
}

/* ════════════════════════════════════════════════════════════════════ */
/*  top bar + KPIs                                                     */
/* ════════════════════════════════════════════════════════════════════ */
function renderTop() { $('#topMeta').textContent=''; $('#footMeta').textContent='Image-based claim review'; $('#issueCount').textContent=STATS.issues; }

function renderKpis() {
  const row = $('#kpiRow');
  const decided = T.supported + T.refuted;

  const cards = [
    {
      label: 'Claim scenes analysed',
      val: STATS.scenesWithClaimsScanned, unit: `/ ${STATS.scenesWithClaims}`,
      sub: `<b>${STATS.sitesScanned}</b> sites · ${STATS.panoramas-STATS.scenesWithClaims} other scenes have no claims`,
      bar: [[STATS.scenesWithClaimsScanned / STATS.scenesWithClaims, 'var(--accent)']],
    },
    {
      label: 'Model-supported claims',
      val: T.supported, unit: `of ${STATS.checked}`,
      sub: `model predictions · <b>${T.pending}</b> pending · <b>${T.error}</b> failed`,
      bar: [
        [T.supported / STATS.claims, VHEX.supported],
        [T.refuted / STATS.claims, VHEX.refuted],
        [T.needs_review / STATS.claims, VHEX.needs_review],
      ],
    },
    {
      label: 'Supported share',
      val: pct(T.supported, STATS.checked) + '%', unit: '',
      sub: `<b>${T.supported}</b> of ${STATS.checked} checked claims supported`,
      bar: [[T.supported / Math.max(1, STATS.checked), VHEX.supported]],
    },
    {
      label: 'Refuted share',
      val: pct(T.refuted, STATS.checked) + '%', unit: '',
      sub: `<b>${T.refuted}</b> refuted · <b>${T.no_evidence}</b> no evidence · <b>${claims.filter(c=>c.low_confidence).length}</b> low confidence`,
      bar: [[T.refuted / Math.max(1, STATS.checked), VHEX.refuted]],
    },
    {
      label: 'Model flags',
      val: STATS.issues, unit: 'flags',
      sub: `<b>${T.refuted}</b> refuted · <b>${claims.filter(c=>c.low_confidence).length}</b> low confidence · <b>${T.error}</b> failed across <b>${new Set(
        claims.filter(c => (c.verdict==='refuted'||c.low_confidence||c.status==='error')).map(c => c.sceneId)).size}</b> scenes`,
      click: '#sec-issues',
      bar: [
        [T.refuted / Math.max(1, STATS.issues), VHEX.refuted],
        [claims.filter(c=>c.low_confidence&&c.verdict!=='refuted').length / Math.max(1, STATS.issues), VHEX.low_confidence],
        [T.error / Math.max(1, STATS.issues), VHEX.error],
      ],
    },
  ];

  row.innerHTML = cards.map(c => `
    <div class="kpi ${c.click ? 'click' : ''}" ${c.click ? `data-goto="${c.click}"` : ''}>
      <div class="k-label">${esc(c.label)}</div>
      <div class="k-val">${esc(String(c.val))}${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ''}</div>
      <div class="k-sub">${c.sub}</div>
      <div class="k-bar">${c.bar.map(([w, col]) =>
        `<i style="width:${Math.max(2, w * 100).toFixed(1)}%;background:${col}"></i>`).join('')}</div>
    </div>`).join('');

  $$('.kpi[data-goto]').forEach(n =>
    n.addEventListener('click', () => $(n.dataset.goto)?.scrollIntoView({ behavior: 'smooth' })));
}

/* ════════════════════════════════════════════════════════════════════ */
/*  overview panels                                                    */
/* ════════════════════════════════════════════════════════════════════ */
function renderOverview() {
  // outcome
  const total = Math.max(1, STATS.claims);
  $('#outcomePanel').innerHTML = `
    <div class="panel-title">Claim outcomes</div>
    <div class="outcome-bar">
      ${ORDER.map(k => T[k] ? `<i style="width:${(T[k] / total * 100).toFixed(2)}%;background:${VHEX[k]}" title="${VLABEL[k]}: ${T[k]}"></i>` : '').join('')}
    </div>
    <div class="outcome-legend">
      ${ORDER.map(k => `
        <div class="leg">
          <span class="dot" style="background:${VHEX[k]}"></span>
          <span>${VLABEL[k]}</span>
          <span class="leg-val">${T[k]}</span>
          <span class="leg-pct">${pct(T[k], total)}%</span>
        </div>`).join('')}
    </div>`;

  // by site
  const siteRows = SITES.map(site => {
    const list = claims.filter(c => sceneById.get(c.sceneId)?.site === site);
    return { site, t: tally(list), total: list.length, flags: list.filter(c=>c.verdict==='refuted'||c.low_confidence||c.status==='error').length };
  }).filter(r => r.total).sort((a, b) => b.flags-a.flags);

  $('#throughputPanel').innerHTML = `
    <div class="panel-title">By site</div>
    <div class="th-list">
      ${siteRows.map(r => {
        const bad = r.flags;
        return `<div class="th-row">
          <div class="th-name">${esc(r.site)}</div>
          <div class="th-track">${ORDER.filter(k => r.t[k]).map(k =>
            `<i style="width:${(r.t[k] / r.total * 100).toFixed(1)}%;background:${VHEX[k]}"></i>`).join('')}</div>
          <div class="th-val" style="color:${bad ? 'var(--review-fg)' : 'var(--dim)'}">${bad ? bad + ' flag' + (bad > 1 ? 's' : '') : r.t.supported + ' ok'}</div>
        </div>`;
      }).join('')}
    </div>`;

  // models
  $('#modelPanel').innerHTML = `
    <div class="panel-title">Model predictions</div>
    <table class="model-tbl">
      <thead><tr><th>Model</th><th>Supported / refuted / no evidence per pass</th><th>Self-reported confidence</th><th>Pass decisions</th></tr></thead>
      <tbody>
        ${modelRoll.map(r => `
          <tr>
            <td class="m-name">${esc(r.model)}</td>
            <td>
              <span style="color:var(--supported-fg)">${r.supported}</span>
              <span class="dim">/</span>
              <span style="color:var(--refuted-fg)">${r.refuted}</span>
              <span class="dim">/</span>
              <span style="color:var(--review-fg)">${r.no_evidence}</span>
            </td>
            <td>${(r.meanConf * 100).toFixed(1)}%</td>
            <td class="dim">${r.n} claim decisions</td>
          </tr>`).join('')}

      </tbody>
    </table>
    <div class="dim" style="margin-top:11px;font-size:10.5px;line-height:1.5">
      ${esc(claims.find(c => c.score_meaning)?.score_meaning || '')}
    </div>`;
}

/* ════════════════════════════════════════════════════════════════════ */
/*  categories                                                         */
/* ════════════════════════════════════════════════════════════════════ */
function renderCategories() {
  $('#catMeta').textContent = `${CATS.length} categories · ${STATS.claims} claims`;
  $('#categoryPanel').innerHTML = CATS.map(cat => {
    const t = byCategory.get(cat);
    const total = ORDER.reduce((a, k) => a + t[k], 0);
    const done = t.supported + t.refuted;
    return `<div class="cat-row" data-cat="${esc(cat)}">
      <div class="cat-name"><span class="swatch"></span>${esc(cat.replace(/_/g, ' '))}</div>
      <div class="cat-count"><b>${done}</b> <span class="dim">/ ${total}</span></div>
      <div class="cat-bar">
        ${ORDER.filter(k => t[k]).map(k => `<i style="width:${(t[k] / total * 100).toFixed(1)}%;background:${VHEX[k]}"></i>`).join('')}
      </div>
      <div class="cat-split">
        ${ORDER.map(k => t[k] ? `<span><i class="dot" style="background:${VHEX[k]}"></i>${t[k]}</span>` : '').join('')}
      </div>
    </div>`;
  }).join('');

  $$('.cat-row').forEach(n => n.addEventListener('click', () => {
    filters.category = n.dataset.cat;
    renderFilters(); renderScenes();
    $('#sec-scenes').scrollIntoView({ behavior: 'smooth' });
  }));
}

/* ════════════════════════════════════════════════════════════════════ */
/*  filters + scene grid                                               */
/* ════════════════════════════════════════════════════════════════════ */
const filters = { verdict: 'all', category: null, site: null, hasClaims: true, q: '' };

function renderFilters() {
  const f = $('#filters');
  const verdictCounts = { all: STATS.claims, ...T, low_confidence: claims.filter(c=>c.low_confidence).length };

  f.innerHTML = `
    <div class="fgroup">
      <span class="f-label">State</span>
      ${['all', ...ORDER.filter(k=>k!=='needs_review'), 'low_confidence'].map(k => `
        <button class="chip ${filters.verdict === k ? 'on' : ''}" data-verdict="${k}">
          ${k === 'all' ? 'All' : `<span class="dot" style="background:${VHEX[k]}"></span>${VLABEL[k]}`}
          <span class="n">${verdictCounts[k]}</span>
        </button>`).join('')}
    </div>
    <div class="fgroup">
      <span class="f-label">Category</span>
      ${CATS.map(c => `
        <button class="chip ${filters.category === c ? 'on' : ''}" data-cat="${esc(c)}">
          ${esc(c.replace(/_/g, ' '))}<span class="n">${Object.values(byCategory.get(c)).reduce((a, b) => a + b, 0)}</span>
        </button>`).join('')}
      ${filters.category ? '<button class="chip" data-cat="">clear</button>' : ''}
    </div>
    <div class="fgroup">
      <span class="f-label">Site</span>
      ${SITES.map(s => `
        <button class="chip ${filters.site === s ? 'on' : ''}" data-site="${esc(s)}">${esc(s)}</button>`).join('')}
      ${filters.site ? '<button class="chip" data-site="">clear</button>' : ''}
    </div>
    <div class="f-spacer"></div>
    <button class="chip ${filters.hasClaims ? 'on' : ''}" data-toggle="hasClaims">
      With claims<span class="n">${STATS.scenesWithClaims}</span>
    </button>
    <span class="f-count" id="fCount"></span>`;

  $$('[data-verdict]', f).forEach(b => b.addEventListener('click', () => {
    filters.verdict = b.dataset.verdict; renderFilters(); renderScenes();
  }));
  $$('[data-cat]', f).forEach(b => b.addEventListener('click', () => {
    filters.category = b.dataset.cat || null; renderFilters(); renderScenes();
  }));
  $$('[data-site]', f).forEach(b => b.addEventListener('click', () => {
    filters.site = b.dataset.site || null; renderFilters(); renderScenes();
  }));
  $('[data-toggle]', f).addEventListener('click', () => {
    filters.hasClaims = !filters.hasClaims; renderFilters(); renderScenes();
  });
}

function visibleScenes() {
  return scenes.filter(s => {
    if (filters.hasClaims && !s.claims.length) return false;
    if (filters.site && s.site !== filters.site) return false;
    const list = claimsByScene.get(s.sceneId) || [];
    if (filters.category && !list.some(c => c.category === filters.category)) return false;
    if(filters.verdict==='low_confidence' ? !list.some(c=>c.low_confidence) : filters.verdict!=='all' && !list.some(c=>stateOf(c)===filters.verdict))return false;
    if (filters.q) {
      const hay = (s.sceneId + ' ' + list.map(c => c.claimId + ' ' + c.statement + ' ' + c.category).join(' ')).toLowerCase();
      if (!hay.includes(filters.q)) return false;
    }
    return true;
  });
}

function renderScenes() {
  const list = visibleScenes();
  const grid = $('#sceneGrid');
  $('#sceneMeta').textContent = `${list.length} of ${scenes.length} scenes`;
  const fc = $('#fCount');
  if (fc) fc.textContent = `${list.length} shown`;

  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No scenes match the current filters.</div>`;
    return;
  }

  grid.innerHTML = list.map(s => {
    const cs = claimsByScene.get(s.sceneId) || [];
    const t = tally(cs);
    const flags = ORDER.filter(k => t[k]).map(k => `<i style="background:${VHEX[k]}" title="${VLABEL[k]} ${t[k]}"></i>`).join('');
    return `<article class="scene-card" data-scene="${esc(s.sceneId)}">
      <div class="scene-thumb">
        <img src="${esc(s.views[0]?.src || '')}" alt="" loading="lazy"
             onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
        <div class="noimg" style="display:none">assets not built</div>
        <div class="scene-badge">${esc(s.site)}</div>
        <div class="scene-flag">${flags}</div>
      </div>
      <div class="scene-body">
        <div class="scene-title">
          <span class="site">${esc(s.site)}/</span><span class="scene">${esc(s.scene)}</span>
          <span class="chev">→</span>
        </div>
        <div class="claim-chips">
          ${cs.slice(0, 3).map(c => `
            <span class="claim-chip v-${stateOf(c)}">
              <span class="dot" style="background:${VHEX[stateOf(c)]}"></span>
              <span class="txt">${esc(shortStmt(c.statement))}</span>
            </span>`).join('')}
        </div>
        ${cs.length > 3 ? `<div class="scene-more">+${cs.length - 3} more claim${cs.length - 3 > 1 ? 's' : ''}</div>` : ''}
        ${!cs.length ? `<div class="scene-more">no claims against this scene</div>` : ''}
      </div>
    </article>`;
  }).join('');

  $$('.scene-card', grid).forEach(n =>
    n.addEventListener('click', () => openScene(n.dataset.scene)));
}

/* ════════════════════════════════════════════════════════════════════ */
/*  issues                                                             */
/* ════════════════════════════════════════════════════════════════════ */
function renderIssues() {
  const bad = claims.filter(c => (c.verdict==='refuted'||c.low_confidence||c.status==='error'));
  $('#issueMeta').textContent = `${bad.length} claims flagged · ${new Set(bad.map(c => c.sceneId)).size} scenes`;

  const groups = [...new Set(bad.map(c => c.sceneId))].map(id => ({
    scene: sceneById.get(id),
    items: bad.filter(c => c.sceneId === id),
  })).sort((a, b) => b.items.length - a.items.length);

  if (!groups.length) {
    $('#issuePanel').innerHTML = `<div class="empty">No flagged claims in the current run.</div>`;
    return;
  }

  $('#issuePanel').innerHTML = groups.map(g => {
    const t = tally(g.items);
    return `<div class="issue-scene">
      <div class="issue-head" data-scene="${esc(g.scene.sceneId)}">
        <span class="id">${esc(g.scene.sceneId)}</span>
        <span class="tally">
          ${ORDER.filter(k => t[k]).map(k => `<span><i style="background:${VHEX[k]}"></i>${t[k]} ${VSHORT[k].toLowerCase()}</span>`).join('')}
        </span>
      </div>
      ${g.items.map(c => {
        const st = stateOf(c);
        const conf = c.models?.length
          ? Math.max(...c.models.map(m => m.confidence || 0))
          : null;
        const obs = c.observation || c.models?.find(m => m.observation)?.observation || '';
        return `<div class="issue-claim" data-scene="${esc(c.sceneId)}" data-claim="${esc(c.claimId)}">
          <div>${vPill(st)}${c.low_confidence?vPill('low_confidence'):''}<div style="margin-top:6px;font:10px var(--mono);color:var(--dim)">${esc(c.claimId)}</div></div>
          <div>
            <div class="stmt">${esc(c.statement)}</div>
            ${obs ? `<div class="obs">${esc(obs)}</div>` : ''}
          </div>
          <div class="conf">
            <div>${esc(c.category.replace(/_/g, ' '))}</div>
            ${conf != null ? `<div style="margin-top:3px">peak conf. ${(conf * 100).toFixed(0)}%</div>
              <div class="bar"><i style="width:${(conf * 100).toFixed(0)}%;background:${VHEX[st]}"></i></div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  $$('[data-scene]', $('#issuePanel')).forEach(n =>
    n.addEventListener('click', () => openScene(n.dataset.scene, n.dataset.claim, true)));
}

/* ════════════════════════════════════════════════════════════════════ */
/*  panorama viewer (pan / zoom + minimap)                             */
/* ════════════════════════════════════════════════════════════════════ */
class PanoramaViewer {
  constructor(canvas, minimap) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.mm = minimap; this.mctx = minimap.getContext('2d');
    this.s = 1; this.tx = 0; this.ty = 0;
    this.img = null; this.iw = 0; this.ih = 0;
    this.regions = [];        // {x,y,w,h,name}
    this.highlight = new Set();
    this.anim = null;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.fitScale = 1;

    this._bind();
    this._resize();
    new ResizeObserver(() => { this._resize(); this.draw(); }).observe(canvas.parentElement);
    new ResizeObserver(() => this.drawMinimap()).observe(minimap.parentElement);
  }

  _resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    this.cw = r.width; this.ch = r.height;
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    const m = this.mm.parentElement.getBoundingClientRect();
    this.mw = m.width; this.mh = m.height;
    this.mm.width = Math.round(m.width * this.dpr);
    this.mm.height = Math.round(m.height * this.dpr);
    if (this.iw && this.cw && this.ch && !this._userZoomed) this.fit();
    this.draw(); this.drawMinimap();
  }

  setImage(img, iw, ih, regions) {
    this.img = img; this.iw = iw; this.ih = ih;
    this.regions = regions;
    this._userZoomed = false;
    this.fit();
  }

  /* force a re-measure; ResizeObserver alone can lag behind a display:none toggle */
  refresh() { this._resize(); }

  fit() {
    if (!this.iw || !this.ih || !this.cw || !this.ch) return;
    this.fitScale = Math.min(this.cw / this.iw, this.ch / this.ih);
    if (!Number.isFinite(this.fitScale) || this.fitScale <= 0) return;
    this.s = this.fitScale;
    this.tx = (this.cw - this.iw * this.s) / 2;
    this.ty = (this.ch - this.ih * this.s) / 2;
    this._userZoomed = false;
    this.draw(); this.drawMinimap();
  }

  actual() { this.zoomTo(1); }

  zoomTo(target, cx = this.cw / 2, cy = this.ch / 2) {
    target = Math.max(this.fitScale, Math.min(6, target));
    const k = target / this.s;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.s = target;
    this._clamp(); this._userZoomed = Math.abs(this.s - this.fitScale) > 1e-3;
    this.draw(); this.drawMinimap();
  }

  _clamp() {
    const iw = this.iw * this.s, ih = this.ih * this.s;
    this.tx = iw <= this.cw ? (this.cw - iw) / 2 : Math.min(0, Math.max(this.cw - iw, this.tx));
    this.ty = ih <= this.ch ? (this.ch - ih) / 2 : Math.min(0, Math.max(this.ch - ih, this.ty));
  }

  /* animate to a source region */
  flyTo(x, y, w, h, pad = 0.82) {
    const target = Math.max(this.fitScale, Math.min(6, Math.min(this.cw / (w * pad), this.ch / (h * pad))));
    const tx = this.cw / 2 - (x + w / 2) * target;
    const ty = this.ch / 2 - (y + h / 2) * target;
    this._animate({ s: target, tx, ty });
  }

  _animate(target) {
    cancelAnimationFrame(this.anim);
    const from = { s: this.s, tx: this.tx, ty: this.ty };
    const t0 = performance.now(), dur = 520;
    const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = ease(p);
      this.s = from.s + (target.s - from.s) * e;
      this.tx = from.tx + (target.tx - from.tx) * e;
      this.ty = from.ty + (target.ty - from.ty) * e;
      this._clamp();
      this.draw(); this.drawMinimap();
      if (p < 1) this.anim = requestAnimationFrame(step);
      else { this._userZoomed = Math.abs(this.s - this.fitScale) > 1e-3; this.draw(); }
    };
    this.anim = requestAnimationFrame(step);
  }

  _bind() {
    const wrap = this.cv.parentElement;
    let dragging = false, lx = 0, ly = 0, vx = 0, vy = 0, last = 0, moved = 0;

    wrap.addEventListener('pointerdown', e => {
      dragging = true; moved = 0;
      lx = e.clientX; ly = e.clientY; vx = vy = 0; last = performance.now();
      cancelAnimationFrame(this.anim);
      wrap.classList.add('dragging');
      wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.tx += dx; this.ty += dy;
      const dt = Math.max(1, performance.now() - last); last = performance.now();
      vx = dx / dt * 16; vy = dy / dt * 16;
      this._clamp(); this.draw(); this.drawMinimap();
      if (moved > 22) $('#panoHint')?.classList.add('gone');
    });

    const release = () => {
      if (!dragging) return;
      dragging = false; wrap.classList.remove('dragging');
      const decay = () => {
        vx *= .93; vy *= .93;
        if (Math.abs(vx) < .12 && Math.abs(vy) < .12) return;
        this.tx += vx; this.ty += vy;
        this._clamp(); this.draw(); this.drawMinimap();
        this.anim = requestAnimationFrame(decay);
      };
      this.anim = requestAnimationFrame(decay);
    };
    wrap.addEventListener('pointerup', release);
    wrap.addEventListener('pointercancel', release);

    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      this.zoomTo(this.s * Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
      $('#panoHint')?.classList.add('gone');
    }, { passive: false });

    wrap.addEventListener('dblclick', e => {
      const r = wrap.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      if (Math.abs(this.s - this.fitScale) < 1e-3) {
        const region = this.regions.find(g => {
          const gx = this.tx + g.x * this.s, gy = this.ty + g.y * this.s;
          return cx >= gx && cx <= gx + g.w * this.s && cy >= gy && cy <= gy + g.h * this.s;
        });
        region ? this.flyTo(region.x, region.y, region.w, region.h, 1)
               : this.zoomTo(this.s * 2.6, cx, cy);
      } else this.fit();
    });

    // minimap navigation
    const mmNav = e => {
      const r = this.mm.getBoundingClientRect();
      const { scale, offY } = this._mm();
      const ix = (e.clientX - r.left) / scale;
      const iy = (e.clientY - r.top + offY) / scale;
      this._animate({
        s: this.s,
        tx: this.cw / 2 - ix * this.s,
        ty: this.ch / 2 - iy * this.s,
      });
    };
    this.mm.addEventListener('pointerdown', e => {
      this.mm.setPointerCapture(e.pointerId);
      this._mmDrag = true; mmNav(e);
    });
    this.mm.addEventListener('pointermove', e => { if (this._mmDrag) mmNav(e); });
    this.mm.addEventListener('pointerup', () => this._mmDrag = false);
    this.mm.addEventListener('pointercancel', () => this._mmDrag = false);
  }

  _mm() {
    const scale = this.mw / this.iw;
    const offY = (this.ih * scale - this.mh) / 2;
    return { scale, offY };
  }

  draw() {
    const { ctx, cw, ch, dpr, img } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!img) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, this.tx, this.ty, this.iw * this.s, this.ih * this.s);

    for (const r of this.regions) {
      const x = this.tx + r.x * this.s, y = this.ty + r.y * this.s;
      const w = r.w * this.s, h = r.h * this.s;
      const on = this.highlight.has(r.name);
      if (on) {
        ctx.fillStyle = 'rgba(110,168,254,.13)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(110,168,254,.92)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      } else if (this.highlight.size) {
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
      }
    }

    const zoom = $('#zoomReadout');
    if (zoom) {
      const ratio = this.fitScale > 0 ? Math.round(this.s / this.fitScale * 100) : 100;
      zoom.textContent = (Number.isFinite(ratio) ? ratio : 100) + '%';
    }
  }

  drawMinimap() {
    const { mctx, mw, mh, dpr, img } = this;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.clearRect(0, 0, mw, mh);
    if (!img) return;
    const { scale, offY } = this._mm();
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(img, 0, -offY, this.iw * scale, this.ih * scale);

    for (const r of this.regions) {
      const x = r.x * scale, w = r.w * scale;
      const on = this.highlight.has(r.name);
      mctx.fillStyle = on ? 'rgba(110,168,254,.34)' : 'rgba(255,255,255,.07)';
      mctx.fillRect(x, 0, w, mh);
      mctx.strokeStyle = on ? 'rgba(110,168,254,.9)' : 'rgba(255,255,255,.16)';
      mctx.lineWidth = 1;
      mctx.strokeRect(x + .5, .5, w - 1, mh - 1);
    }

    // viewport rectangle
    const vx = -this.tx / this.s * scale, vy = -this.ty / this.s * scale - offY;
    const vw = this.cw / this.s * scale, vh = this.ch / this.s * scale;
    mctx.strokeStyle = '#e9edf3';
    mctx.lineWidth = 1.5;
    mctx.strokeRect(vx, vy, vw, vh);
    mctx.fillStyle = 'rgba(233,237,243,.1)';
    mctx.fillRect(vx, vy, vw, vh);
  }
}

/* ════════════════════════════════════════════════════════════════════ */
/*  lightbox (tile viewer)                                             */
/* ════════════════════════════════════════════════════════════════════ */
class Lightbox {
  constructor() {
    this.root = $('#lightbox');
    this.cv = $('#lbCanvas'); this.ctx = this.cv.getContext('2d');
    this.s = 1; this.tx = 0; this.ty = 0;
    this.img = null; this.iw = 0; this.ih = 0; this.fitScale = 1;
    this.views = []; this.index = 0;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this._bind();
    new ResizeObserver(() => { this._resize(); this.draw(); }).observe(this.cv.parentElement);
  }

  _resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    this.cw = r.width; this.ch = r.height;
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    if (this.img && this.cw && this.ch) this.fit();
  }

  open(views, index) {
    this.views = views;
    this.root.hidden = false;
    document.body.style.overflow = 'hidden';
    this._go(index);
  }

  close() {
    this.root.hidden = true;
    document.body.style.overflow = '';
    if (this.onClose) this.onClose();
  }

  refresh() { this._resize(); }

  async _go(i) {
    this.index = (i + this.views.length) % this.views.length;
    const v = this.views[this.index];
    this._resize();
    try { this.img = await loadImage(v.src); } catch { this.img = null; }
    this.iw = this.img?.width || 1; this.ih = this.img?.height || 1;
    this.fit();
    $('#lbName').textContent = viewLabel(v.name);
    $('#lbRegion').textContent = '';
    $('#lbStrip').innerHTML = this.views.map((q, n) => `
      <div class="lb-thumb ${n === this.index ? 'on' : ''}" data-i="${n}">
        <img src="${esc(q.src)}" alt="">
      </div>`).join('');
    $$('#lbStrip .lb-thumb').forEach(n =>
      n.addEventListener('click', () => this._go(+n.dataset.i)));
    if (this.onIndex) this.onIndex(this.index);
  }

  fit() {
    if (!this.cw || !this.ch || !this.iw || !this.ih) return;
    const base = Math.min(this.cw / this.iw, this.ch / this.ih) * .96;
    if (!Number.isFinite(base) || base <= 0) return;
    this.fitScale = base;
    this.s = this.fitScale;
    this.tx = (this.cw - this.iw * this.s) / 2;
    this.ty = (this.ch - this.ih * this.s) / 2;
    this.draw();
  }

  zoomTo(target, cx = this.cw / 2, cy = this.ch / 2) {
    target = Math.max(this.fitScale * .5, Math.min(8, target));
    const k = target / this.s;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.s = target; this.draw();
  }

  draw() {
    const { ctx, cw, ch, dpr, img } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!img) {
      ctx.fillStyle = '#6f7b8b';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Image unavailable', cw / 2, ch / 2);
      return;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, this.tx, this.ty, this.iw * this.s, this.ih * this.s);
    const z = $('#lbZoom');
    if (z) {
      const ratio = this.fitScale > 0 ? Math.round(this.s / this.fitScale * 100) : 100;
      z.textContent = (Number.isFinite(ratio) ? ratio : 100) + '%';
    }
  }

  _bind() {
    const stage = this.cv.parentElement;
    let dragging = false, lx = 0, ly = 0;

    stage.addEventListener('pointerdown', e => {
      dragging = true; lx = e.clientX; ly = e.clientY;
      stage.classList.add('dragging');
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (!dragging) return;
      this.tx += e.clientX - lx; this.ty += e.clientY - ly;
      lx = e.clientX; ly = e.clientY; this.draw();
    });
    const up = () => { dragging = false; stage.classList.remove('dragging'); };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);

    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      this.zoomTo(this.s * Math.exp(-e.deltaY * 0.0018), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    $('#lbClose').addEventListener('click', () => this.close());
    $('#lbPrev').addEventListener('click', () => this._go(this.index - 1));
    $('#lbNext').addEventListener('click', () => this._go(this.index + 1));
    $('#lbZoomIn').addEventListener('click', () => this.zoomTo(this.s * 1.45));
    $('#lbZoomOut').addEventListener('click', () => this.zoomTo(this.s / 1.45));
    $('.lb-scrim').addEventListener('click', () => this.close());

    window.addEventListener('keydown', e => {
      if (this.root.hidden) return;
      // swallow handled keys so the scene viewer behind us does not react too
      e.stopImmediatePropagation();
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this._go(this.index - 1);
      else if (e.key === 'ArrowRight') this._go(this.index + 1);
      else if (e.key === '+' || e.key === '=') this.zoomTo(this.s * 1.45);
      else if (e.key === '-') this.zoomTo(this.s / 1.45);
      else if (e.key === '0') this.fit();
    });
  }
}

/* ════════════════════════════════════════════════════════════════════ */
/*  scene overlay                                                      */
/* ════════════════════════════════════════════════════════════════════ */
const overlay = $('#sceneOverlay');
const pano = new PanoramaViewer($('#pano'), $('#minimap'));
const lightbox = new Lightbox();
let current = null;      // {scene, claims}
let activeClaim = null;
let navigatingIssues = false, issueIndex = -1;
// Match the Issues list: scenes with most flags first, then claim order.
const issueGroups = new Map();
for(const c of claims.filter(c=>c.verdict==='refuted'||c.low_confidence||c.status==='error')) {
  if(!issueGroups.has(c.sceneId))issueGroups.set(c.sceneId,[]);
  issueGroups.get(c.sceneId).push(c);
}
const issueQueue=[...issueGroups.values()].sort((a,b)=>b.length-a.length).flat();
function updateIssueNavigation() {
  $('#issueNav').hidden=!navigatingIssues||!issueQueue.length;
  $('#issuePosition').textContent='Issue '+(issueIndex+1)+' of '+issueQueue.length+' · ← / →';
  $('#previousIssue').disabled=issueIndex<=0;
  $('#nextIssue').disabled=issueIndex<0||issueIndex>=issueQueue.length-1;
}
function moveIssue(direction) {
  if(!navigatingIssues)return;
  const next=issueIndex+direction;
  if(next<0||next>=issueQueue.length)return;
  issueIndex=next;
  const c=issueQueue[next];
  if(current?.scene.sceneId===c.sceneId)focusClaim(c.claimId,true);
  else void openScene(c.sceneId,c.claimId,true);
}

async function openScene(sceneId, claimId, issues=false) {
  const scene = sceneById.get(sceneId);
  if (!scene) return;
  const list = claimsByScene.get(sceneId) || [];
  navigatingIssues=issues;
  if(issues){
    if(!claimId)claimId=issueQueue.find(c=>c.sceneId===sceneId)?.claimId;
    issueIndex=issueQueue.findIndex(c=>c.claimId===claimId);
  }
  current = { scene, claims: list };
  const opened=current;
  activeClaim=claimId||null;
  updateIssueNavigation();
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  pano.refresh();

  $('#svTitle').textContent = scene.sceneId;
  $('#svSub').textContent = list.length + ' claims';

  renderRail();
  renderViewStrip();
  setMode('panorama');

  // reset + load imagery
  pano.setImage(null, scene.width, scene.height, []);
  if(claimId)focusClaim(claimId,false);
  try {
    const img = await loadImage(scene.panorama);
    if(current!==opened)return;
    pano.setImage(img, scene.width, scene.height, scene.views.map(v => ({
      x: v.regions[0][0], y: v.regions[0][1], w: v.regions[0][2], h: v.regions[0][3], name: v.name,
    })));
    if(activeClaim)focusClaim(activeClaim,true);
  } catch {
    if(current!==opened)return;
    const ctx = $('#pano').getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, $('#pano').width, $('#pano').height);
    ctx.fillStyle = '#6f7b8b';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Image unavailable',
      $('#pano').width / 2, $('#pano').height / 2);
    if(activeClaim)focusClaim(activeClaim,false);
  }
}

function closeScene() {
  overlay.hidden = true;
  document.body.style.overflow = '';
  current = null; activeClaim = null;
  navigatingIssues=false;issueIndex=-1;updateIssueNavigation();
}

function citedViews(claim) {
  const agg = claim.evidence_views || [];
  if (agg.length) return agg;
  // needs_review rows carry no aggregate citation; fall back to the per-model ones
  return [...new Set((claim.models || []).flatMap(m => m.views || []))];
}

function focusClaim(claimId, fly) {
  if (!current) return;
  activeClaim = claimId;
  if(navigatingIssues){const index=issueQueue.findIndex(c=>c.claimId===claimId);if(index>=0)issueIndex=index;updateIssueNavigation();}
  renderRail();
  renderViewStrip();
  const claim = current.claims.find(c => c.claimId === claimId);
  if (!claim) return;

  const cited = new Set(citedViews(claim));
  pano.highlight = cited;
  pano.draw(); pano.drawMinimap();

  const node = $(`#claimList .claim[data-claim="${claimId}"]`);
  node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  if (fly) {
    const region = current.scene.views.find(v => cited.has(v.name));
    if (region) pano.flyTo(region.regions[0][0], region.regions[0][1], region.regions[0][2], region.regions[0][3]);
  }
}

function renderRail() {
  if (!current) return;
  const list = current.claims;
  $('#railFilter').innerHTML = list.length
    ? ORDER.filter(k => list.some(c => stateOf(c) === k)).map(k => {
        const n = list.filter(c => stateOf(c) === k).length;
        return `<span class="chip"><span class="dot" style="background:${VHEX[k]}"></span>${n}</span>`;
      }).join('')
    : '';

  $('#claimList').innerHTML = list.map(c => {
    const st = stateOf(c);
    const cited = citedViews(c);
    const open = activeClaim === c.claimId;
    return `<div class="claim ${open ? 'active' : ''}" data-claim="${esc(c.claimId)}">
      <div class="claim-top">
        <span class="claim-id">${esc(c.claimId)}</span>
        ${vPill(st)}${c.low_confidence?'<span class="v-pill v-needs_review">Low confidence</span>':''}
        <span class="claim-cat">${esc(c.category.replace(/_/g, ' '))}</span>
      </div>
      <div class="claim-stmt">${esc(c.statement)}</div>
      <div class="claim-detail" ${open ? '' : 'hidden'}>

        <div class="model-answer">


        ${c.observation ? `<div class="sub-lbl">Observation</div><div class="note">${esc(c.observation)}</div>` : ''}

        ${(c.models || []).map(m => `
          <div class="note">
            <div class="who">
              <span>${esc(m.model)} · Pass ${esc(m.pass)}</span>
              <span class="dim">· ${(m.confidence * 100).toFixed(0)}%</span>
              ${vPill(m.verdict)}
            </div>
            ${esc(m.observation)}
            ${m.limitation ? `<div class="lim">${esc(m.limitation)}</div>` : ''}
          </div>`).join('')}

        ${cited.length ? `
          <div class="sub-lbl">${c.evidence_views?.length ? 'Cited evidence' : 'Views cited by models'}</div>
          <div class="view-chips">
            ${cited.map(v => current.scene.views.some(view=>view.name===v)?`<button class="view-chip ${c.evidence_views?.length ? '' : 'alt'}" data-view="${esc(v)}">
              <span class="dot"></span>${esc(viewLabel(v))}</button>`:'<span class="dim">Saved evidence view has no matching preview.</span>').join('')}
          </div>` : '<div class="sub-lbl">Cited evidence</div><div class="dim" style="font-size:11px">no views cited</div>'}

        ${c.status === 'pending' ? '<div class="dim" style="margin-top:11px;font-size:11px">Not yet analysed by this model.</div>' : ''}
        </div>
      </div>
    </div>`;
  }).join('') || '<div class="empty" style="margin:16px">No claims against this scene.</div>';

  $$('#claimList .claim').forEach(n => n.addEventListener('click', e => {
    if (e.target.closest('.view-chip')) return;
    activeClaim = activeClaim === n.dataset.claim ? null : n.dataset.claim;
    renderRail(); renderViewStrip();
    if (activeClaim) focusClaim(activeClaim, false);
    else { pano.highlight = new Set(); pano.draw(); pano.drawMinimap(); }
  }));

  $$('#claimList .view-chip').forEach(n => n.addEventListener('click', e => {
    e.stopPropagation();
    const name = n.dataset.view;
    const v = current.scene.views.find(q => q.name === name);
    if (!v) return;
    pano.highlight = new Set([name]);
    pano.flyTo(v.regions[0][0], v.regions[0][1], v.regions[0][2], v.regions[0][3]);
  }));


}

function renderViewStrip() {
  if (!current) return;
  const cited = activeClaim ? new Set(citedViews(current.claims.find(c => c.claimId === activeClaim) || {})) : new Set();
  $('#viewStrip').innerHTML = current.scene.views.map((v, i) => `
    <div class="vs-tile ${cited.has(v.name) ? 'cited' : ''}" data-i="${i}">
      <img src="${esc(v.src)}" alt="" loading="lazy">
      ${cited.has(v.name) ? '<span class="vs-cited">cited</span>' : ''}
      <div class="vs-name">${esc(viewLabel(v.name))}</div>
    </div>`).join('');

  $$('#viewStrip .vs-tile').forEach(n => {
    const v = current.scene.views[+n.dataset.i];
    n.addEventListener('click', () => {
      lightbox.open(current.scene.views, +n.dataset.i);
    });
    n.addEventListener('mouseenter', () => {
      pano.highlight = new Set([v.name]); pano.draw(); pano.drawMinimap();
    });
    n.addEventListener('mouseleave', () => {
      pano.highlight = activeClaim
        ? new Set(citedViews(current.claims.find(c => c.claimId === activeClaim) || {}))
        : new Set();
      pano.draw(); pano.drawMinimap();
    });
  });
}

function setMode(mode) {
  $$('#svMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('#panoWrap').hidden = mode !== 'panorama';
  $('#minimapWrap').hidden = mode !== 'panorama';
  $('#breakdown').hidden = mode !== 'breakdown';
  if (mode === 'breakdown') renderBreakdown();
  else pano.refresh();
}

function renderBreakdown() {
  if (!current) return;
  const cited = activeClaim ? new Set(citedViews(current.claims.find(c => c.claimId === activeClaim) || {})) : new Set();
  $('#breakdown').innerHTML = `<div class="bd-grid">${current.scene.views.map((v, i) => `
    <div class="bd-tile ${cited.has(v.name) ? 'cited' : ''}" data-i="${i}">
      <div class="bd-img">
        <img src="${esc(v.src)}" alt="">
        <span class="bd-tag">${esc(v.kind)}</span>
        ${cited.has(v.name) ? '<span class="bd-cited">cited</span>' : ''}
      </div>
      <div class="bd-meta">
        <div class="bd-name">${esc(viewLabel(v.name))}</div>
        <div class="bd-region"></div>
      </div>
    </div>`).join('')}</div>`;

  $$('#breakdown .bd-tile').forEach(n =>
    n.addEventListener('click', () => lightbox.open(current.scene.views, +n.dataset.i)));
}

/* ── overlay wiring ─────────────────────────────────────────────────── */
$$('[data-close]').forEach(n => n.addEventListener('click', closeScene));
$('#svFit').addEventListener('click', () => pano.fit());
$('#svFull').addEventListener('click', () => pano.actual());
$('#previousIssue').addEventListener('click',()=>moveIssue(-1));
$('#nextIssue').addEventListener('click',()=>moveIssue(1));
$$('#svMode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

window.addEventListener('keydown', e => {
  if (!overlay.hidden && lightbox.root.hidden) {
    if(e.target?.closest('input,select,textarea,[contenteditable="true"]')||e.altKey||e.ctrlKey||e.metaKey)return;
    if (e.key === 'Escape') closeScene();
    else if(navigatingIssues&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();moveIssue(e.key==='ArrowRight'?1:-1);}
    else if (e.key === 'f' || e.key === 'F') pano.fit();
  }
});

/* ════════════════════════════════════════════════════════════════════ */
/*  nav, search, boot                                                  */
/* ════════════════════════════════════════════════════════════════════ */
function setupNav() {
  const nav = $('#secNav');
  const links = $$('#secNav a');
  const underline = $('#navUnderline');
  const move = a => {
    underline.style.width = a.offsetWidth + 'px';
    underline.style.transform = `translateX(${a.offsetLeft}px)`;
    links.forEach(l => l.classList.toggle('on', l === a));
  };
  requestAnimationFrame(() => move(links[0]));

  const obs = new IntersectionObserver(entries => {
    const vis = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (vis) {
      const a = links.find(l => l.getAttribute('href') === '#' + vis.target.id);
      if (a) move(a);
    }
  }, { rootMargin: '-118px 0px -62% 0px', threshold: 0 });
  $$('.sec').forEach(s => obs.observe(s));

  window.addEventListener('resize', () => {
    const on = links.find(l => l.classList.contains('on')) || links[0];
    move(on);
  });
}

function setupSearch() {
  const input = $('#search');
  input.addEventListener('input', () => {
    filters.q = input.value.trim().toLowerCase();
    renderScenes();
    if (filters.q) $('#sec-scenes').scrollIntoView({ behavior: 'smooth' });
  });
  window.addEventListener('keydown', e => {
    if (e.key === '/' && !document.activeElement?.matches('input,select,textarea') && !$('#scanDialog').open && lightbox.root.hidden) {
      e.preventDefault(); input.focus();
    }
    if (e.key === 'Escape' && document.activeElement === input) {input.value = '';filters.q='';renderScenes();}
  });
}

renderTop();
renderKpis();
renderOverview();
renderCategories();
renderFilters();
renderScenes();
renderIssues();
setupScanning();
setupNav();
setupSearch();

})();
