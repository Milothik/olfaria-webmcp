import { OlfariaAtlas } from './atlas.js?v=20260808-blender';
import { loadDataset, normalizeText } from './data.js?v=20260606-focus';

const $ = (selector) => document.querySelector(selector);
const state = {
  dataset: null,
  atlas: null,
  sessionText: '',
  activeIds: new Map(),
  relatedIds: new Set(),
  autoParams: null,
  graphMode: 'raw',
  fullCorpus: false,
  processTimer: null,
};

boot();

async function boot() {
  try {
    setStatus('Preparing crystals...', 'offline');
    state.dataset = await loadDataset();
    state.atlas = new OlfariaAtlas($('#atlas-canvas'), $('#tooltip'));
    state.atlas.externalRenderer = true;
    state.atlas.setData(state.dataset.nodes, state.dataset.relations);
    state.atlas.onSelect = renderInspector;
    bindUi();
    exposeExternalApi();
    rebuild();
    renderCorpusContract();
    setStatus('Crystal Neural Erdos ready to explore.', 'online');
    $('#dataset-status').textContent = `${state.dataset.nodes.length.toLocaleString('en-US')} olfemes · ${state.dataset.relations.length.toLocaleString('en-US')} relationships`;
    window.dispatchEvent(new CustomEvent('olfaria:ready', {
      detail: { olfemas: state.dataset.nodes.length, relaciones: state.dataset.relations.length },
    }));
  } catch (error) {
    setStatus(`The Atlas could not be loaded: ${error.message}`, 'offline');
  }
}

function renderCorpusContract() {
  const audit = state.dataset.meta.corpusAudit;
  if (!audit) return;
  const active = audit.published_counts.relations_active.toLocaleString('en-US');
  const requested = audit.requested_counts.relations.toLocaleString('en-US');
  $('#top-catalog').textContent = `${active} relationships loaded`;
  $('#corpus-contract').textContent = `v4 · ${audit.published_counts.olfemas.toLocaleString('en-US')} olfemes · ${active} active relationships`;
  $('#corpus-gap').textContent = `The source contains ${audit.discrepancy.missing_relation_records} fewer relationships than the requested ${requested}; none are synthesized.`;
  $('#corpus-hash').textContent = `SHA-256 ${audit.source_sha256.slice(0, 16)}…`;
}

function bindUi() {
  $('#activate-session').addEventListener('click', () => setSessionText($('#session-text').value, 'ui'));
  $('#clear-session').addEventListener('click', () => setSessionText('', 'ui'));
  $('#export-jsonld').addEventListener('click', exportJsonLd);
  $('#copy-extract').addEventListener('click', copyExtraction);
  $('#polarity-filter')?.addEventListener('change', rebuild);
  $('#disconnected-mode')?.addEventListener('change', rebuild);
  $('#corpus-fluid')?.addEventListener('click', () => setCorpusView(false));
  $('#corpus-full')?.addEventListener('click', () => setCorpusView(true));
  window.addEventListener('olfaria:select', (event) => selectNodeById(event.detail?.id));
  $('#reset-view').addEventListener('click', () => {
    state.atlas.rotX = -0.23;
    state.atlas.rotY = 0.68;
    state.atlas.zoom = 1;
    state.atlas.requestRender();
    window.dispatchEvent(new CustomEvent('olfaria:three-command', { detail: { type: 'reset' } }));
  });
  $('#fit-session').addEventListener('click', () => centerSession());
  $('#close-inspector').addEventListener('click', () => $('#inspector').classList.remove('open'));
}

function setCorpusView(fullCorpus) {
  state.fullCorpus = Boolean(fullCorpus);
  rebuild();
  setStatus(state.fullCorpus
    ? 'Full corpus: 5,000 olfemes and audited relationships in the field.'
    : 'Fluid view restored.', 'online');
}

function paramsFromUi() {
  if (!state.autoParams) state.autoParams = deriveAutoParams();
  return { ...state.autoParams };
}

function rebuild() {
  if (!state.atlas) return;
  state.autoParams = deriveAutoParams();
  state.atlas.setActive(state.activeIds);
  state.relatedIds = state.atlas.relatedIds || new Set();
  const summary = state.atlas.rebuild(paramsFromUi());
  state.relatedIds = state.atlas.relatedIds || state.relatedIds;
  renderMetrics(summary);
  renderSessionSummary();
  renderLegend(summary);
  renderProcessComments();
  publishRenderState();
}

function publishRenderState() {
  const detail = {
    nodes: state.atlas.nodes,
    edges: state.atlas.edges,
    activeIds: [...state.activeIds.keys()],
    selectedId: state.atlas.selected?.id || null,
  };
  window.__OLFARIA_ATLAS_STATE__ = detail;
  window.dispatchEvent(new CustomEvent('olfaria:atlas-state', { detail }));
}

function selectNodeById(id) {
  if (!id || !state.atlas) return;
  const node = state.atlas.nodes.find((item) => item.id === id);
  if (!node) return;
  state.atlas.selected = node;
  renderInspector(node, state.atlas.neighbors(node));
  publishRenderState();
}

function renderMetrics(summary) {
  $('#metric-nodes').textContent = summary.nodes.toLocaleString('en-US');
  $('#metric-edges').textContent = summary.edges.toLocaleString('en-US');
  $('#metric-degree').textContent = summary.averageDegree.toFixed(2);
  $('#metric-active').textContent = summary.active;
}

function setSessionText(text, source = 'api', extractedActive = null) {
  state.sessionText = String(text || '').trim();
  $('#session-text').value = state.sessionText;
  state.activeIds = extractedActive || matchSession(state.sessionText);
  if (!state.sessionText) $('#inspector').classList.remove('open');
  rebuild();
  if (state.sessionText) {
    state.atlas.startSessionFormation();
    centerSession();
    startProcessTicker();
  } else {
    state.atlas.clearSessionFormation();
    stopProcessTicker();
  }
  setStatus(state.sessionText ? `Session activated by ${source}.` : 'Session cleared.', 'online');
}

function deriveAutoParams() {
  const activeNodes = [...state.activeIds.keys()]
    .map((id) => state.dataset.nodes.find((node) => node.id === id))
    .filter(Boolean);
  const families = new Set(activeNodes.map((node) => node.family));
  const phases = new Set(activeNodes.map((node) => node.phase));
  const avgIntensity = activeNodes.reduce((sum, node) => sum + node.intensity, 0) / Math.max(1, activeNodes.length);
  const avgPolarityAbs = activeNodes.reduce((sum, node) => sum + Math.abs(node.hedonicPolarity), 0) / Math.max(1, activeNodes.length);
  const mode = 'raw';
  const defaultVisible = window.innerWidth <= 680 ? 700 : window.innerWidth <= 1120 ? 1100 : 1800;
  const visibleCount = state.fullCorpus ? state.dataset.nodes.length : Math.min(defaultVisible, state.dataset.nodes.length);
  const targetDistance = clamp(0.34 + families.size * 0.018 + phases.size * 0.012 + avgPolarityAbs * 0.08, 0.34, 0.62);
  const tolerance = clamp(0.045 + Math.min(0.08, activeNodes.length / 1200) + avgIntensity * 0.035, 0.045, 0.13);
  return {
    mode,
    visibleCount: activeNodes.length ? activeNodes.length : visibleCount,
    targetDistance,
    tolerance,
    maxDegree: Number.POSITIVE_INFINITY,
    edgeOpacity: activeNodes.length ? 0.34 : 0.12,
    family: 'all',
    phase: 'all',
    predicate: 'all',
    scope: activeNodes.length ? 'active' : 'all',
    activeIds: state.activeIds,
    maxDepth: 3,
    minConfidence: 0,
    showUncertain: true,
    polarityFilter: $('#polarity-filter')?.value || 'all',
    edgeDensity: activeNodes.length || state.fullCorpus ? 'json' : 'medium',
    disconnectedMode: activeNodes.length ? 'hidden' : ($('#disconnected-mode')?.value || 'visible'),
    respectRawRelations: true,
    sessionGraph: activeNodes.length > 0,
  };
}

function renderLegend(summary) {
  const params = paramsFromUi();
  const activeNodes = [...state.activeIds.keys()]
    .map((id) => state.dataset.nodes.find((node) => node.id === id))
    .filter(Boolean);
  const families = countBy(activeNodes, (node) => node.family).slice(0, 3).map(([family]) => family).join(', ') || '--';
  $('#mode-caption').textContent = 'crystal JSON';
  $('#top-mode').textContent = state.fullCorpus && !state.activeIds.size ? 'full field' : modeLabel(params.mode);
  $('#top-scope').textContent = state.activeIds.size
    ? `${state.activeIds.size.toLocaleString('en-US')} active · no extra neighbors`
    : `${params.visibleCount.toLocaleString('en-US')} visible · ${state.dataset.nodes.length.toLocaleString('en-US')} loaded`;
  $('#legend-visible').textContent = state.activeIds.size ? `${summary.nodes} / ${state.dataset.nodes.length}` : `${params.visibleCount} / ${state.dataset.nodes.length}`;
  $('#legend-mode').textContent = modeLabel(params.mode);
  $('#legend-depth').textContent = params.maxDepth;
  $('#legend-confidence').textContent = params.minConfidence.toFixed(2);
  $('#legend-degree').textContent = Number.isFinite(params.maxDegree) ? params.maxDegree : 'unlimited';
  $('#legend-polarity').textContent = polarityLabel(params.polarityFilter);
  $('#legend-families').textContent = families;
  $('#legend-relations').textContent = state.activeIds.size ? `${summary.edges} session relationships` : `${summary.edges} edges`;
  $('#mode-caption').textContent = state.activeIds.size ? 'activation' : 'crystal JSON';
  const fluidButton = $('#corpus-fluid');
  const fullButton = $('#corpus-full');
  fluidButton?.classList.toggle('active', !state.fullCorpus);
  fullButton?.classList.toggle('active', state.fullCorpus);
  fluidButton?.setAttribute('aria-pressed', String(!state.fullCorpus));
  fullButton?.setAttribute('aria-pressed', String(state.fullCorpus));
  const viewNote = $('#corpus-view-note');
  if (viewNote) {
    viewNote.textContent = state.activeIds.size
      ? `${summary.nodes.toLocaleString('en-US')} active olfemes in the session.`
      : state.fullCorpus
        ? `${summary.nodes.toLocaleString('en-US')} olfemes and ${summary.edges.toLocaleString('en-US')} visible relationships.`
        : `${summary.nodes.toLocaleString('en-US')} visible olfemes for smooth rendering.`;
  }
}

function centerSession() {
  if (!state.atlas || !state.activeIds.size) return;
  if (state.atlas.externalRenderer) {
    window.dispatchEvent(new CustomEvent('olfaria:three-command', {
      detail: { type: 'focus', activeIds: [...state.activeIds.keys()] },
    }));
    return;
  }
  if (state.atlas.focusActiveCluster?.()) return;
  const active = state.atlas.nodes.filter((node) => state.activeIds.has(node.id) && node.position);
  if (!active.length) return;
  const avg = active.reduce((acc, node) => {
    acc.x += node.position[0];
    acc.y += node.position[1];
    acc.z += node.position[2];
    return acc;
  }, { x: 0, y: 0, z: 0 });
  avg.x /= active.length;
  avg.y /= active.length;
  avg.z /= active.length;
  state.atlas.rotY = -Math.atan2(avg.x, avg.z);
  state.atlas.rotX = Math.atan2(avg.y, Math.sqrt(avg.x * avg.x + avg.z * avg.z));
  state.atlas.zoom = Math.max(1.05, state.atlas.zoom);
  state.atlas.requestRender();
}

function matchSession(text) {
  const query = normalizeText(text);
  const scores = new Map();
  if (!query) return scores;
  const stopwords = new Set([
    'con', 'del', 'los', 'las', 'una', 'uno', 'para', 'por', 'que', 'bajo', 'sobre', 'entre',
    'consigo', 'trajo', 'golpe', 'aroma', 'olor', 'olfativo', 'crystal', 'copo', 'nodo',
    'the', 'and', 'with', 'from', 'into',
  ]);
  const tokens = query
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length > 3 && !stopwords.has(token));
  for (const node of state.dataset.nodes) {
    let score = 0;
    let hits = 0;
    for (const token of tokens) {
      if (node.searchText.includes(token)) {
        score += token.length > 5 ? 0.24 : 0.16;
        hits += 1;
      }
      if (normalizeText(node.family) === token) {
        score += 0.18;
        hits += 1;
      }
      if (normalizeText(node.role) === token) {
        score += 0.18;
        hits += 1;
      }
    }
    const label = normalizeText(node.label);
    const exactPhrase = tokens.length >= 2 && tokens.some((token) => label.includes(token)) && query.includes(label);
    if (score >= 0.42 || hits >= 3 || exactPhrase) scores.set(node.id, Math.min(1, score));
  }
  return new Map([...scores.entries()].sort((a, b) => b[1] - a[1]));
}

function renderSessionSummary() {
  const box = $('#session-summary');
  if (!state.sessionText) {
    box.classList.add('empty');
    box.textContent = 'No active session.';
    renderActivationFeed([], []);
    renderProcessComments();
    return;
  }
  box.classList.remove('empty');
  const activeNodes = [...state.activeIds.entries()]
    .map(([id, score]) => ({ node: state.dataset.nodes.find((item) => item.id === id), score }))
    .filter((item) => item.node);
  const previewNodes = activeNodes.slice(0, 14);
  const families = countBy(activeNodes, (item) => item.node.family).slice(0, 6).map(([key, value]) => `${key} ${value}`).join(' · ');
  const phases = countBy(activeNodes, (item) => item.node.phase).slice(0, 5).map(([key, value]) => `${key} ${value}`).join(' · ');
  const sessionEdges = state.atlas?.edges || [];
  const relationshipSummaries = sessionEdges.slice(0, 3).map(formatRelationshipSummary);
  box.innerHTML = `
    <strong>${activeNodes.length} active olfemes</strong><br>
    ${sessionEdges.length} internal relationships · ${state.dataset.nodes.length - activeNodes.length} inactive olfemes hidden<br>
    Dominant families: ${escapeHtml(families || 'no direct matches')}<br>
    Phases: ${escapeHtml(phases || 'no dominant phase')}<br>
    ${relationshipSummaries.map((summary) => `Relationship: ${escapeHtml(summary)}`).join('<br>')}
    ${relationshipSummaries.length ? '<br>' : ''}
    Primary sample: ${previewNodes.map((item) => escapeHtml(nodeDisplayId(item.node))).join(', ') || 'no olfemes detected'}
  `;
  renderActivationFeed(activeNodes, sessionEdges);
  renderProcessComments();
}

function renderActivationFeed(activeNodes, sessionEdges) {
  const feed = $('#activation-feed');
  if (!feed) return;
  if (!state.sessionText) {
    feed.className = 'activation-feed idle';
    feed.innerHTML = `
      <article>
        <span>Field at rest</span>
        <strong>Morulas on standby</strong>
        <small>Activate a description to observe crystallization.</small>
      </article>
    `;
    return;
  }
  if (!activeNodes.length) {
    feed.className = 'activation-feed idle';
    feed.innerHTML = `
      <article>
        <span>No matches found</span>
        <strong>The field remains at rest</strong>
        <small>Try more specific corpus descriptors.</small>
      </article>
    `;
    return;
  }

  const polarity = activeNodes.reduce((sum, item) => sum + (Number(item.node.hedonicPolarity) || 0), 0) / activeNodes.length;
  const polarityLabel = polarity > 0.22 ? 'Bright and positive' : polarity < -0.22 ? 'Dark and contrasting' : 'Balanced and ambivalent';
  const phaseCounts = countBy(activeNodes, (item) => item.node.phase).slice(0, 3);
  const phases = phaseCounts.map(([phase, count]) => `${phase} ${count}`).join(' · ');
  const relationClasses = countBy(sessionEdges, (edge) => edge.relationClass || 'neutral').slice(0, 2);
  const relationTheme = relationClasses.map(([kind, count]) => `${kind} ${count}`).join(' · ');
  const averageQuality = sessionEdges.length
    ? sessionEdges.reduce((sum, edge) => sum + (Number(edge.quality) || 0), 0) / sessionEdges.length
    : 0;

  feed.className = 'activation-feed active';
  feed.innerHTML = `
    <article>
      <span>Overall polarity</span>
      <strong>${escapeHtml(polarityLabel)}</strong>
      <small>Mean index ${polarity.toFixed(2)} across ${activeNodes.length} active olfemes.</small>
    </article>
    <article>
      <span>Graph phases</span>
      <strong>${escapeHtml(phases || 'No dominant phase')}</strong>
      <small>Phases describe the temporal evolution of the accord.</small>
    </article>
    <article>
      <span>Resonance</span>
      <strong>${sessionEdges.length} connections</strong>
      <small>${escapeHtml(relationTheme || 'no direct relationship')} · confidence ${averageQuality.toFixed(2)}</small>
    </article>
  `;
}

function renderProcessComments() {
  const box = $('#process-comments');
  if (!box) return;
  if (!state.sessionText || !state.activeIds.size) {
    box.classList.add('empty');
    box.innerHTML = '<strong>Process</strong><span>Activate a session to see how the active flakes combine.</span>';
    return;
  }
  box.classList.remove('empty');
  const edges = state.atlas?.edges || [];
  const progress = state.atlas?.sessionProgress?.() ?? 1;
  const activeIndex = Math.max(0, Math.min(edges.length - 1, Math.floor(progress * Math.max(1, edges.length))));
  const visible = edges.slice(0, 6);
  box.innerHTML = `
    <strong>Combination process</strong>
    <span>${state.activeIds.size} active · ${edges.length} relationships between active olfemes</span>
    <div class="process-steps">
      ${visible.map((edge, index) => `
        <div class="process-step ${index <= activeIndex ? 'lit' : ''}">
          <b>${escapeHtml(edge.source)} + ${escapeHtml(edge.target)}</b>
          <small>${escapeHtml(formatRelationshipDetails(edge))}</small>
        </div>
      `).join('') || '<div class="process-step lit"><b>No direct relationship</b><small>The active olfemes remain isolated because the session contains no supported relationship.</small></div>'}
    </div>
  `;
}

function nodeDisplayId(node) {
  return node?.idKey || node?.id || node?.code || 'unknown';
}

function formatRelationshipSummary(edge) {
  return `${edge.source} → ${edge.target} · ${edge.predicate || 'related'}`;
}

function formatRelationshipDetails(edge) {
  const predicate = edge.predicate || 'related';
  const confidence = Number(edge.confidence ?? edge.quality);
  return Number.isFinite(confidence)
    ? `${predicate} · confidence ${confidence.toFixed(2)}`
    : predicate;
}

function startProcessTicker() {
  stopProcessTicker();
  state.processTimer = window.setInterval(renderProcessComments, 180);
  window.setTimeout(stopProcessTicker, 7600);
}

function stopProcessTicker() {
  if (!state.processTimer) return;
  window.clearInterval(state.processTimer);
  state.processTimer = null;
}

function renderInspector(node, neighbors) {
  $('#ins-title').textContent = node.label;
  $('#ins-sub').textContent = `${node.code} · ${node.family} · ${node.role}`;
  const topNeighbors = neighbors.slice(0, 12);
  const profile = state.atlas.distanceProfile(node, paramsFromUi().maxDepth);
  const counts = relationCounts(neighbors);
  const closest = profile.slice().sort((a, b) => a.distance - b.distance).slice(0, 5);
  const creative = profile.slice().sort((a, b) => b.creativeScore - a.creativeScore).slice(0, 5);
  const distant = profile.slice().filter((item) => Number.isFinite(item.distance)).sort((a, b) => b.distance - a.distance).slice(0, 5);
  const disconnected = Math.max(0, state.dataset.nodes.length - profile.length - 1);
  const crystal = node.crystal || {};
  const metrics = crystal.crystal_metrics || {};
  $('#ins-body').innerHTML = `
    <div class="ins-kpis">
      <span><b>${neighbors.length}</b>directas</span>
      <span><b>${counts.positive}</b>positivas</span>
      <span><b>${counts.creative}</b>creativas</span>
      <span><b>${counts.negative}</b>negativas</span>
      <span><b>${counts.risk}</b>riesgo</span>
      <span><b>${disconnected}</b>sin ruta</span>
    </div>
    <div><b>Polaridad</b> ${node.hedonicPolarity.toFixed(2)} · <b>Volatilidad</b> ${node.volatility.toFixed(2)} · <b>Intensidad</b> ${node.intensity.toFixed(2)}</div>
    <div class="crystal-metrics">
      <span><b>${formatMetric(metrics.symmetry)}</b>simetria</span>
      <span><b>${formatMetric(metrics.branch_density)}</b>densidad</span>
      <span><b>${formatMetric(metrics.semantic_tension)}</b>tension</span>
      <span><b>${formatMetric(metrics.purity)}</b>pureza</span>
    </div>
    ${crystalAxisSummary(crystal)}
    <div><b>Lectura</b> ${escapeHtml(node.subfamily || 'descriptor general')}.</div>
    ${pathSection('Mas cercanos', closest)}
    ${pathSection('Diferencia creativa', creative)}
    ${pathSection('Mas distantes con ruta', distant)}
    <div class="neighbor-list">
      ${topNeighbors.map(({ edge, node: other }) => `
        <div class="neighbor-pill">
          <b>${escapeHtml(other.label)}</b>
          <span>${edge.distance.toFixed(3)}</span>
          <small>${escapeHtml(edge.predicate)} · ${escapeHtml(edge.relationClass)} · q ${edge.quality.toFixed(2)} · ${escapeHtml(other.family)}</small>
        </div>
      `).join('') || '<span class="empty">Sin vecinos con los parametros actuales.</span>'}
    </div>
  `;
  $('#inspector').classList.add('open');
  renderCrystalArtifactPanel(node, neighbors);
}

function renderCrystalArtifactPanel(node, neighbors) {
  const body = $('#artifact-body');
  if (!body) return;
  const crystal = node.crystal || {};
  const metrics = crystal.crystal_metrics || {};
  body.classList.remove('empty');
  body.innerHTML = `
    <div class="artifact-selected">
      <b>${escapeHtml(node.label)}</b>
      <span>${escapeHtml(node.family)} · ${escapeHtml(node.phase)} · ${escapeHtml(node.code)}</span>
    </div>
    <div class="artifact-metrics">
      ${artifactMetric('simetria', metrics.symmetry)}
      ${artifactMetric('densidad', metrics.branch_density)}
      ${artifactMetric('tension', metrics.semantic_tension)}
      ${artifactMetric('pureza', metrics.purity)}
    </div>
    <p class="artifact-caption">Cristal volumetrico de seis ejes visible en el campo · ramas semanticas: ${snowflakeBranchCount(crystal)} · vecinos directos: ${neighbors.length}</p>
  `;
  startCrystalArtifact(node);
}

let crystalArtifactFrame = 0;

function startCrystalArtifact(node) {
  const canvas = $('#crystal-artifact-canvas');
  if (!canvas) return;
  if (crystalArtifactFrame) cancelAnimationFrame(crystalArtifactFrame);
  let lastDraw = 0;
  const render = (time) => {
    if (time - lastDraw > 33) {
      drawCrystalArtifact(canvas, node, time * 0.001);
      lastDraw = time;
    }
    crystalArtifactFrame = requestAnimationFrame(render);
  };
  render(0);
}

function drawCrystalArtifact(canvas, node, time) {
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width || 340));
  const height = Math.max(1, Math.round(rect.height || 210));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const crystal = node.crystal || {};
  const metrics = crystal.crystal_metrics || {};
  const axes = crystal.axes || {};
  const axisNames = ['matter', 'sensation', 'hedonic', 'phase', 'context', 'associations'];
  const symmetry = clamp01(metrics.symmetry ?? 0.68);
  const density = clamp01(metrics.branch_density ?? 0.5);
  const tension = clamp01(metrics.semantic_tension ?? 0.25);
  const base = Math.min(width, height) * (0.34 + density * 0.07);
  const cx = width / 2;
  const cy = height / 2;
  const spin = time * 0.32 + seededUnit(node.id) * Math.PI * 2;
  const tilt = Math.sin(time * 0.45) * 0.12;

  const gradient = ctx.createRadialGradient(width / 2, height / 2, 12, width / 2, height / 2, Math.min(width, height) * 0.52);
  gradient.addColorStop(0, crystalColor(node.hedonicPolarity, 0.13));
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 9; index += 1) {
    const glintAngle = seededUnit(`${node.id}:glint-angle:${index}`) * Math.PI * 2 + time * 0.035;
    const glintRadius = base * (0.3 + seededUnit(`${node.id}:glint-radius:${index}`) * 0.78);
    const gx = cx + Math.cos(glintAngle) * glintRadius;
    const gy = cy + Math.sin(glintAngle) * glintRadius * 0.8;
    const size = 0.7 + seededUnit(`${node.id}:glint-size:${index}`) * 1.4;
    ctx.beginPath();
    ctx.moveTo(gx - size * 3, gy);
    ctx.lineTo(gx + size * 3, gy);
    ctx.moveTo(gx, gy - size * 3);
    ctx.lineTo(gx, gy + size * 3);
    ctx.strokeStyle = `rgba(248,251,250,${0.1 + Math.sin(time * 1.2 + index) * 0.04})`;
    ctx.lineWidth = 0.55;
    ctx.stroke();
  }

  drawSnowflakeLayer(ctx, node, axes, axisNames, {
    cx,
    cy,
    radius: base,
    spin,
    scaleY: 0.84 + tilt,
    alpha: 0.32,
    lineScale: 0.78,
    density,
    tension,
    symmetry,
  });
  drawSnowflakeLayer(ctx, node, axes, axisNames, {
    cx,
    cy,
    radius: base * 0.92,
    spin: -spin * 0.42,
    scaleY: 1.02 - tilt * 0.6,
    alpha: 0.5,
    lineScale: 1,
    density,
    tension,
    symmetry,
  });
  drawSnowflakeLayer(ctx, node, axes, axisNames, {
    cx,
    cy,
    radius: base * 0.55,
    spin: spin * 0.24 + Math.PI / 6,
    scaleY: 0.94,
    alpha: 0.34,
    lineScale: 0.72,
    density,
    tension,
    symmetry,
  });

  drawArtifactCore(ctx, node, cx, cy, base * 0.145, spin, 0.96 - tilt);
}

function drawSnowflakeLayer(ctx, node, axes, axisNames, options) {
  const { cx, cy, radius, spin, scaleY, alpha, lineScale, density, tension, symmetry } = options;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'screen';
  ctx.translate(cx, cy);
  ctx.rotate(spin);
  ctx.scale(1, scaleY);
  axisNames.forEach((axis, axisIndex) => {
    const angle = -Math.PI / 2 + axisIndex * Math.PI / 3;
    const descriptors = axes[axis] || [];
    const irregular = 0.93 + symmetry * 0.07 + seededSigned(`${node.id}:flake:${axis}`) * (0.04 + tension * 0.05);
    drawSnowArm2d(ctx, node, descriptors, angle, radius * irregular, axisIndex, lineScale, density, tension);
  });
  [0.28, 0.48, 0.68].forEach((step, ringIndex) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = -Math.PI / 2 + i * Math.PI / 3;
      const wobble = 1 + seededSigned(`${node.id}:flake-ring:${i}:${ringIndex}`) * tension * 0.025;
      const x = Math.cos(angle) * radius * step * wobble;
      const y = Math.sin(angle) * radius * step * wobble;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = crystalColor(node.hedonicPolarity, 0.22);
    ctx.lineWidth = 0.7 * lineScale;
    ctx.stroke();
  });
  ctx.restore();
}

function drawSnowArm2d(ctx, node, descriptors, angle, length, axisIndex, lineScale, density, tension) {
  const branchCount = Math.max(3, Math.min(7, descriptors.length + 3 + Math.round(density * 2)));
  ctx.save();
  ctx.rotate(angle);
  drawArtifactShard(ctx, 0, 0, length, 0, Math.max(2.1, length * 0.038) * lineScale, node.hedonicPolarity, 0.5, 0.78);
  for (let i = 0; i < branchCount; i += 1) {
    const descriptor = descriptors[i % Math.max(1, descriptors.length)] || {};
    const t = (i + 1) / (branchCount + 1);
    const x = length * t;
    const weight = descriptor.weight || 0.48;
    const branchLength = length * (0.13 + weight * 0.13) * (1 - t * 0.34);
    const tilt = Math.PI / (3.4 + density) + seededSigned(`${node.id}:flake-tilt:${axisIndex}:${i}`) * tension * 0.14;
    [-1, 1].forEach((side) => {
      const branchAngle = side * tilt;
      const bx = x + Math.cos(branchAngle) * branchLength;
      const by = Math.sin(branchAngle) * branchLength;
      const polarity = descriptor.polarity ?? node.hedonicPolarity;
      drawArtifactShard(ctx, x, 0, bx, by, Math.max(1.2, branchLength * 0.065) * lineScale, polarity, 0.38 + (descriptor.volatility || 0.4) * 0.18, 0.62);
      if (i < branchCount - 1) {
        const twig = branchLength * 0.36;
        drawArtifactShard(ctx, bx, by, bx - Math.cos(branchAngle * 1.65) * twig, by + Math.sin(branchAngle * 1.65) * twig, Math.max(0.7, twig * 0.06) * lineScale, polarity, 0.2, 0.36);
      }
    });
  }
  ctx.restore();
}

function drawArtifactShard(ctx, x1, y1, x2, y2, width, polarity, fillAlpha, strokeAlpha) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const px = -dy / length * width;
  const py = dx / length * width;
  const shoulderX = x1 + dx * 0.84;
  const shoulderY = y1 + dy * 0.84;
  ctx.beginPath();
  ctx.moveTo(x1 + px, y1 + py);
  ctx.lineTo(shoulderX + px * 0.5, shoulderY + py * 0.5);
  ctx.lineTo(x2, y2);
  ctx.lineTo(shoulderX - px * 0.5, shoulderY - py * 0.5);
  ctx.lineTo(x1 - px, y1 - py);
  ctx.closePath();
  ctx.fillStyle = crystalFacetColor(polarity, 'base', fillAlpha);
  ctx.strokeStyle = crystalFacetColor(polarity, 'light', strokeAlpha);
  ctx.lineWidth = Math.max(0.45, width * 0.18);
  ctx.shadowColor = crystalColor(polarity, 0.24);
  ctx.shadowBlur = Math.min(8, width * 1.5);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'rgba(255,255,255,0.42)';
  ctx.lineWidth = Math.max(0.35, width * 0.12);
  ctx.stroke();
}

function drawArtifactCore(ctx, node, cx, cy, radius, spin, scaleY) {
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = spin + Math.PI / 6 + index * Math.PI / 3;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * scaleY];
  });
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(point[0], point[1]);
    ctx.lineTo(next[0], next[1]);
    ctx.closePath();
    ctx.fillStyle = crystalFacetColor(node.hedonicPolarity, index % 3 === 0 ? 'light' : index % 2 ? 'shadow' : 'base', 0.78);
    ctx.fill();
  });
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]));
  ctx.closePath();
  ctx.strokeStyle = 'rgba(248,251,250,0.92)';
  ctx.lineWidth = 1.1;
  ctx.shadowColor = crystalColor(node.hedonicPolarity, 0.5);
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function artifactMetric(label, value) {
  const normalized = clamp01(value ?? 0);
  return `
    <span>
      <b>${formatMetric(value)}</b>
      <em>${escapeHtml(label)}</em>
      <i style="--value:${normalized.toFixed(3)}"></i>
    </span>
  `;
}

function snowflakeBranchCount(crystal) {
  return Object.values(crystal?.axes || {}).reduce((sum, axis) => sum + Math.max(1, Array.isArray(axis) ? axis.length : 0), 0);
}

function crystalColor(polarity, alpha) {
  if (polarity < -0.25) return `rgba(205,136,112,${alpha})`;
  if (polarity > 0.25) return `rgba(155,216,198,${alpha})`;
  return `rgba(220,227,224,${alpha})`;
}

function crystalFacetColor(polarity, tone, alpha) {
  if (polarity < -0.25) {
    if (tone === 'light') return `rgba(244,197,178,${alpha})`;
    if (tone === 'shadow') return `rgba(116,61,50,${alpha})`;
    return `rgba(205,136,112,${alpha})`;
  }
  if (polarity > 0.25) {
    if (tone === 'light') return `rgba(224,248,240,${alpha})`;
    if (tone === 'shadow') return `rgba(61,112,98,${alpha})`;
    return `rgba(155,216,198,${alpha})`;
  }
  if (tone === 'light') return `rgba(248,251,250,${alpha})`;
  if (tone === 'shadow') return `rgba(105,119,115,${alpha})`;
  return `rgba(220,227,224,${alpha})`;
}

function seededUnit(value) {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function seededSigned(value) {
  return seededUnit(value) * 2 - 1;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function crystalAxisSummary(crystal) {
  const axes = crystal?.axes || {};
  const labels = {
    matter: 'materia',
    sensation: 'sensacion',
    hedonic: 'hedonica',
    phase: 'fase',
    context: 'contexto',
    associations: 'asociaciones',
  };
  const rows = Object.entries(labels).map(([axis, label]) => {
    const items = Array.isArray(axes[axis]) ? axes[axis].slice(0, 3) : [];
    return `
      <span>
        <b>${label}</b>
        ${items.map((item) => escapeHtml(item.label)).join(', ') || 'sin ramas'}
      </span>
    `;
  }).join('');
  return `<div class="crystal-axis-grid">${rows}</div>`;
}

function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function exposeExternalApi() {
  const api = {
    setSessionText: (text) => setSessionText(text, 'window-api'),
    getSessionText: () => state.sessionText,
    getAtlasSnapshot: () => getSnapshot(),
    getExtraction: () => buildExtraction(),
    getJsonLd: () => buildJsonLd(),
    rebuild,
  };
  window.OlfariaCrystalErdos = api;
  window.OlfemasNeuralErdos = api;

  window.OlfariaAtlasApi = Object.freeze({
    isReady: () => Boolean(state.dataset && state.atlas),
    focusNodes: (identifiers, options = {}) => {
      const requested = Array.isArray(identifiers) ? identifiers : [];
      const active = options.clearExisting === false
        ? new Map(state.activeIds)
        : new Map();
      const selected = [];
      const missing = [];

      requested.forEach((identifier) => {
        const key = String(identifier || '').trim().toLocaleLowerCase();
        const node = state.dataset.nodes.find((candidate) => [
          candidate.id, candidate.code, candidate.idKey,
        ].some((value) => String(value || '').toLocaleLowerCase() === key));
        if (!node) {
          missing.push(identifier);
          return;
        }
        active.set(node.id, 1);
        selected.push(node);
      });

      if (selected.length) {
        setSessionText(
          selected.map((node) => node.idKey).join(', '),
          'webmcp',
          active,
        );
      }

      return {
        selected: selected.map((node) => ({
          codigo: node.code,
          id_key: node.idKey,
        })),
        missing,
        selected_count: selected.length,
        total_focused: state.activeIds.size,
      };
    },
    getFocusedIdentifiers: () => [...state.activeIds.keys()],
  });
}

function buildExtraction() {
  const snapshot = getSnapshot();
  const activeIds = new Set(snapshot.activeNodes.map((node) => node.id));
  const visibleIds = new Set(state.atlas.nodes.map((node) => node.id));
  return {
    ...snapshot,
    dataset: {
      name: state.dataset.meta.dataset,
      version: state.dataset.meta.version,
      totalNodes: state.dataset.nodes.length,
      totalRelations: state.dataset.relations.length,
      requestedRelations: state.dataset.meta.corpusAudit?.requested_counts?.relations ?? null,
      missingRelationRecords: state.dataset.meta.corpusAudit?.discrepancy?.missing_relation_records ?? null,
      sourceSha256: state.dataset.meta.corpusAudit?.source_sha256 ?? null,
    },
    visibleNodes: state.atlas.nodes.map((node) => serializeNode(node, state.activeIds.get(node.id) || 0)),
    visibleRelations: state.atlas.edges.map(serializeEdge),
    officialOlfemas: state.dataset.nodes.map(serializeOfficialOlfema),
    officialRelations: state.dataset.relations.map(serializeOfficialRelation),
    activeRelations: state.dataset.relations
      .filter((relation) => activeIds.has(relation.source) && activeIds.has(relation.target))
      .map(serializeOfficialRelation),
    hiddenByScope: state.dataset.nodes.length - visibleIds.size,
    contract: {
      node: 'Olfema perceptivo-linguistico normalizado.',
      crystal: 'Cristal radial de seis ejes generado para cada olfema.',
      edge: 'Distancia olfativa fertil, relacion semantica o puente compositivo; no igualdad.',
      use: 'Datos preparados para exploracion local y exportacion JSON-LD trazable.',
    },
  };
}

function buildJsonLd() {
  const extraction = buildExtraction();
  return {
    '@context': {
      olfaria: 'https://olfaria.org/vocab#',
      schema: 'https://schema.org/',
      skos: 'http://www.w3.org/2004/02/skos/core#',
      label: 'olfaria:label',
      family: 'olfaria:family',
      facet: 'olfaria:facet',
      phase: 'olfaria:phase',
      polarity: 'olfaria:polarity',
      intensity: 'olfaria:intensity',
      volatility: 'olfaria:volatility',
      role: 'olfaria:role',
      score: 'olfaria:activationScore',
      distance: 'olfaria:olfactoryDistance',
      predicate: 'olfaria:predicate',
      codigo: 'olfaria:codigo',
      id_key: 'olfaria:idKey',
      etiqueta: 'olfaria:etiqueta',
      familia: 'olfaria:familia',
      faceta: 'olfaria:faceta',
      fase: 'olfaria:fase',
      intensidad: 'olfaria:intensidad',
      polaridad: 'olfaria:polaridad',
      sinonimos: 'olfaria:sinonimos',
      ingredientes_materiales: 'olfaria:ingredientesMateriales',
      procedencia: 'olfaria:procedencia',
      incertidumbre: 'olfaria:incertidumbre',
      codigo_original: 'olfaria:codigoOriginal',
      relacion: 'olfaria:relacion',
      origen: 'olfaria:origen',
      predicado: 'olfaria:predicado',
      destino: 'olfaria:destino',
      confianza: 'olfaria:confianza',
      peso: 'olfaria:peso',
      racional_comentario: 'olfaria:racionalComentario',
    },
    '@type': 'olfaria:ResonanceAtlasSession',
    '@id': `olfaria:session/${Date.now()}`,
    'olfaria:created': new Date().toISOString(),
    'olfaria:prompt': extraction.sessionText,
    'olfaria:visualMode': extraction.params.mode,
    'olfaria:scope': extraction.params.scope,
    'olfaria:targetDistance': extraction.params.targetDistance,
    'olfaria:tolerance': extraction.params.tolerance,
    'olfaria:graphStats': extraction.graph,
    'olfaria:dataset': extraction.dataset,
    'olfaria:olfemas': extraction.officialOlfemas,
    'olfaria:relations': extraction.officialRelations,
    'olfaria:visualOlfemas': extraction.visibleNodes.map((node) => ({
      '@id': `olfaria:${node.id}`,
      '@type': 'olfaria:Olfema',
      label: node.label,
      'olfaria:code': node.code,
      family: node.family,
      facet: node.subfamily,
      phase: node.phase,
      polarity: node.hedonicPolarity,
      intensity: node.intensity,
      volatility: node.volatility,
      role: node.role,
      score: node.activationScore,
      'olfaria:active': node.activationScore > 0,
      'olfaria:materials': node.materials,
      'olfaria:synonyms': node.synonyms,
      'olfaria:crystalMetrics': node.crystal?.crystal_metrics,
    })),
    'olfaria:visualRelations': extraction.visibleRelations.map((edge) => ({
      '@id': `olfaria:relation/${edge.id}`,
      '@type': 'olfaria:OlfactoryRelation',
      'olfaria:source': `olfaria:${edge.source}`,
      'olfaria:target': `olfaria:${edge.target}`,
      predicate: edge.predicate,
      distance: edge.distance,
      'olfaria:edgeLength': edge.edgeLength,
      'olfaria:polarityScore': edge.polarityScore,
      'olfaria:relationClass': edge.relationClass,
      'olfaria:confidence': edge.confidence,
      'olfaria:uncertainty': edge.uncertainty,
      'olfaria:weight': edge.weight,
      'olfaria:rationale': edge.rationale,
    })),
  };
}

function serializeOfficialOlfema(node) {
  const raw = node.raw && typeof node.raw === 'object' ? { ...node.raw } : {};
  return {
    '@id': `olfaria:${node.id}`,
    '@type': 'olfaria:Olfema',
    codigo: raw.codigo ?? node.code,
    id_key: raw.id_key ?? node.idKey ?? node.id,
    etiqueta: raw.etiqueta ?? node.label,
    familia: raw.familia ?? node.family,
    faceta: raw.faceta ?? node.subfamily,
    fase: raw.fase ?? node.phase,
    intensidad: raw.intensidad ?? node.intensityRange,
    polaridad: raw.polaridad ?? node.hedonicPolarity,
    sinonimos: raw.sinonimos ?? node.synonyms ?? [],
    ingredientes_materiales: raw.ingredientes_materiales ?? node.materials ?? [],
    procedencia: raw.procedencia ?? [],
    incertidumbre: raw.incertidumbre,
    codigo_original: raw.codigo_original,
    estado_validacion: raw.estado_validacion,
    fila_fuente: raw.fila_fuente,
    evidencia: raw.evidencia,
    raw_json: raw,
    'olfaria:crystal': node.crystal || null,
  };
}

function serializeOfficialRelation(relation) {
  const raw = relation.raw && typeof relation.raw === 'object' ? { ...relation.raw } : {};
  return {
    '@id': `olfaria:relation/${relation.id}`,
    '@type': 'olfaria:OlfactoryRelation',
    relacion: raw.relacion ?? relation.id,
    origen: raw.origen ?? relation.source,
    predicado: raw.predicado ?? relation.predicate,
    destino: raw.destino ?? relation.target,
    confianza: raw.confianza ?? relation.confidence,
    peso: raw.peso ?? relation.weight,
    incertidumbre: raw.incertidumbre ?? relation.uncertainty,
    fase: raw.fase ?? relation.phase,
    racional_comentario: raw.racional_comentario ?? relation.rationale,
    raw_json: raw,
  };
}

function serializeNode(node, activationScore = 0) {
  return {
    id: node.id,
    code: node.code,
    label: node.label,
    family: node.family,
    subfamily: node.subfamily,
    phase: node.phase,
    role: node.role,
    hedonicPolarity: node.hedonicPolarity,
    volatility: node.volatility,
    intensity: node.intensity,
    activationScore,
    degree: node.degree || 0,
    materials: node.materials || [],
    synonyms: node.synonyms || [],
    crystal: node.crystal || null,
  };
}

function serializeEdge(edge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    predicate: edge.predicate,
    distance: Number(edge.distance.toFixed(5)),
    weight: Number(edge.weight.toFixed(5)),
    quality: Number(edge.quality.toFixed(5)),
    confidence: Number(edge.confidence.toFixed(5)),
    uncertainty: Number(edge.uncertainty.toFixed(5)),
    polarityScore: Number(edge.polarityScore.toFixed(5)),
    edgeLength: Number(edge.distance.toFixed(5)),
    relationClass: edge.relationClass,
    rationale: edge.rationale || '',
  };
}

function exportJsonLd() {
  downloadText(`olfaria_resonance_${Date.now()}.jsonld`, JSON.stringify(buildJsonLd(), null, 2), 'application/ld+json');
  setStatus('JSON-LD exportado desde el atlas.', 'online');
}

async function copyExtraction() {
  const text = JSON.stringify(buildExtraction(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Extraccion copiada al portapapeles.', 'online');
  } catch {
    downloadText(`olfaria_extract_${Date.now()}.json`, text, 'application/json');
    setStatus('No se pudo copiar; extraccion descargada.', 'online');
  }
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getSnapshot() {
  const activeNodes = [...state.activeIds.entries()].map(([id, score]) => {
    const node = state.dataset.nodes.find((item) => item.id === id);
    return node ? { id, label: node.label, family: node.family, score } : null;
  }).filter(Boolean);
  return {
    sessionText: state.sessionText,
    graph: state.atlas.summary(),
    params: paramsFromUi(),
    activeNodes,
    selected: state.atlas.selected ? {
      id: state.atlas.selected.id,
      label: state.atlas.selected.label,
      neighbors: state.atlas.neighbors(state.atlas.selected).slice(0, 12).map(({ edge, node }) => ({
        id: node.id,
        label: node.label,
        family: node.family,
        distance: edge.distance,
        predicate: edge.predicate,
      })),
    } : null,
  };
}

function setStatus(text, status) {
  $('#status-text').textContent = text;
  $('#api-status').className = `status-dot ${status || ''}`;
}

function countBy(items, getter) {
  const map = new Map();
  for (const item of items) {
    const key = getter(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function relationCounts(neighbors) {
  const counts = { positive: 0, creative: 0, negative: 0, risk: 0 };
  for (const { edge } of neighbors) {
    if (edge.relationClass === 'positive') counts.positive += 1;
    if (edge.relationClass === 'creative') counts.creative += 1;
    if (edge.relationClass === 'negative') counts.negative += 1;
    if (edge.relationClass === 'risk') counts.risk += 1;
  }
  return counts;
}

function pathSection(title, items) {
  return `
    <div class="path-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="neighbor-list">
        ${items.map((item) => `
          <div class="neighbor-pill">
            <b>${escapeHtml(item.node.label)}</b>
            <span>${item.distance.toFixed(2)}</span>
            <small>${item.hops} pasos · polaridad ${item.accumulatedPolarity.toFixed(2)} · confianza ${item.accumulatedConfidence.toFixed(2)}</small>
          </div>
        `).join('') || '<span class="empty">Sin rutas con este filtro.</span>'}
      </div>
    </div>
  `;
}

function modeLabel(mode) {
  const labels = {
    raw: 'JSON relationships',
    distance: 'olfematic distance',
    resonance: 'resonance',
    creative: 'creative difference',
    risk: 'risk/negative',
  };
  return labels[mode] || mode;
}

function polarityLabel(value) {
  const labels = {
    all: 'all',
    positive: 'positive',
    neutral: 'neutral',
    creative: 'creative',
    negative: 'negative',
    risk: 'risk',
  };
  return labels[value] || value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

