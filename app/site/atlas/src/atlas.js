import { creativeValue } from './metrics.js?v=20260527-2';
import {
  buildOlfematicAdjacency,
  computeShortestOlfematicPaths,
  creativeDifferenceScore,
  normalizeRelationForDistance,
} from './olfematicDistance.js?v=20260527-2';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ARC_STEPS = 8;
const FAST_ARC_STEPS = 2;
const FAST_EDGE_LIMIT = 520;
const RELAX_ITERATIONS = 26;
const DETAILED_NODE_LIMIT = 180;

const vec = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm(a) {
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / len, a[1] / len, a[2] / len];
  },
};

export class OlfariaAtlas {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.tooltip = tooltip;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.nodes = [];
    this.edges = [];
    this.projected = [];
    this.selected = null;
    this.hovered = null;
    this.activeIds = new Map();
    this.relatedIds = new Set();
    this.mode = 'resonance';
    this.params = {};
    this.rotX = -0.23;
    this.rotY = 0.68;
    this.zoom = 1;
    this.dragging = false;
    this.fast = false;
    this.frame = false;
    this.onSelect = null;
    this.sessionStartedAt = 0;
    this.sessionDuration = 6800;
    this.animation = {
      state: 'idle',
      activeKey: '',
      activationStartedAt: 0,
      activationDuration: 1800,
      signalSpeed: 0.00018,
      focus: null,
    };
    this.bind();
    this.resize();
  }

  setData(nodes, relations) {
    this.allNodes = nodes;
    this.allRelations = relations;
    this.normalizedRelations = relations.map((relation) => normalizeRelationForDistance(relation));
    this.olfematicGraph = buildOlfematicAdjacency(nodes, this.normalizedRelations);
  }

  rebuild(params) {
    this.params = params;
    this.mode = params.mode;
    const filtered = this.allNodes.filter((node) => {
      if (params.family !== 'all' && node.family !== params.family) return false;
      if (params.phase !== 'all' && node.phase !== params.phase) return false;
      return true;
    });
    const scopeIds = this.scopeIds(params.scope);
    const scoped = scopeIds ? filtered.filter((node) => scopeIds.has(node.id)) : filtered;
    this.reachableIds = this.reachableFromActive(params.maxDepth || 3);
    const scored = scoped.map((node) => ({
      node,
      score: (this.activeIds.get(node.id) || 0) * 1000 + creativeValue(node) * 100 + relationCount(node.id, this.allRelations),
    }))
      .filter((item) => params.disconnectedMode !== 'hidden' || !this.activeIds.size || this.reachableIds.has(item.node.id))
      .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
    this.nodes = scored.slice(0, params.visibleCount).map((item) => item.node);
    assignPositions(this.nodes);
    if (params.disconnectedMode === 'opposite' && this.activeIds.size) pushDisconnectedOpposite(this.nodes, this.reachableIds);
    this.edges = buildEdges(this.nodes, this.normalizedRelations, params);
    if (params.sessionGraph && this.activeIds.size) {
      this.edges = buildSessionEdges(this.nodes, this.edges, params.activeIds);
    }
    relaxSphericalLayout(this.nodes, this.edges, params);
    if (params.sessionGraph && this.activeIds.size) {
      assignSessionPhasePositions(this.nodes, this.edges, params.activeIds);
    }
    finalizeEdgeGeometry(this.edges, this.nodes);
    this.selected = null;
    this.hovered = null;
    this.requestRender();
    return this.summary();
  }

  scopeIds(scope) {
    if (!scope || scope === 'all' || !this.activeIds.size) return null;
    const ids = new Set(this.activeIds.keys());
    if (scope === 'active') return ids;
    for (const relation of this.allRelations) {
      if (ids.has(relation.source)) ids.add(relation.target);
      if (ids.has(relation.target)) ids.add(relation.source);
    }
    return ids;
  }

  setActive(activeIds) {
    this.activeIds = activeIds || new Map();
    this.relatedIds = this.relatedToActive();
    const activeKey = [...this.activeIds.keys()].sort().join('|');
    if (!activeKey) {
      this.animation.state = 'idle';
      this.animation.activeKey = '';
      this.animation.activationStartedAt = 0;
    } else if (activeKey !== this.animation.activeKey) {
      this.animation.state = 'activating';
      this.animation.activeKey = activeKey;
      this.animation.activationStartedAt = Date.now();
    }
    this.requestRender();
  }

  startSessionFormation() {
    this.sessionStartedAt = Date.now();
    this.animation.state = 'activating';
    this.animation.activationStartedAt = this.sessionStartedAt;
    this.requestRender();
  }

  clearSessionFormation() {
    this.sessionStartedAt = 0;
    this.animation.state = 'idle';
    this.animation.focus = null;
    this.requestRender();
  }

  sessionProgress() {
    if (!this.sessionStartedAt) return 1;
    return Math.max(0, Math.min(1, (Date.now() - this.sessionStartedAt) / this.sessionDuration));
  }

  focusActiveCluster(duration = 900) {
    const active = this.nodes.filter((node) => this.activeIds.has(node.id) && node.position);
    if (!active.length) return false;
    const avg = active.reduce((acc, node) => {
      acc.x += node.position[0];
      acc.y += node.position[1];
      acc.z += node.position[2];
      return acc;
    }, { x: 0, y: 0, z: 0 });
    avg.x /= active.length;
    avg.y /= active.length;
    avg.z /= active.length;
    this.animation.focus = {
      startedAt: Date.now(),
      duration,
      fromRotX: this.rotX,
      fromRotY: this.rotY,
      fromZoom: this.zoom,
      toRotY: -Math.atan2(avg.x, avg.z),
      toRotX: Math.atan2(avg.y, Math.sqrt(avg.x * avg.x + avg.z * avg.z)),
      toZoom: Math.max(1.12, Math.min(2.15, this.zoom < 1.12 ? 1.25 : this.zoom)),
    };
    this.requestRender();
    return true;
  }

  applyCameraFocus(now) {
    const focus = this.animation.focus;
    if (!focus || this.dragging) return false;
    const t = smoothstep(Math.max(0, Math.min(1, (now - focus.startedAt) / focus.duration)));
    this.rotX = lerp(focus.fromRotX, focus.toRotX, t);
    this.rotY = lerpAngle(focus.fromRotY, focus.toRotY, t);
    this.zoom = lerp(focus.fromZoom, focus.toZoom, t);
    if (t >= 1) this.animation.focus = null;
    return t < 1;
  }

  animationSnapshot(now) {
    // Animation states are intentionally visual-only: data selection is already done
    // by prompt activation, while this state machine controls reveal, pulse, and
    // signal timing so Phase 1 can be reverted without touching loading/matching.
    const elapsed = this.animation.activationStartedAt ? now - this.animation.activationStartedAt : 0;
    const progress = this.animation.state === 'activating'
      ? smoothstep(Math.max(0, Math.min(1, elapsed / this.animation.activationDuration)))
      : this.animation.state === 'formed'
        ? 1
        : 0;
    if (this.animation.state === 'activating' && progress >= 1) this.animation.state = 'formed';
    const pulse = this.activeIds.size ? (Math.sin(now * 0.006) * 0.5 + 0.5) : 0;
    return {
      state: this.animation.state,
      activationProgress: progress,
      pulse,
      signalT: (now * this.animation.signalSpeed) % 1,
      hasActive: this.activeIds.size > 0,
    };
  }

  relatedToActive() {
    const related = new Set();
    if (!this.activeIds?.size) return related;
    for (const relation of this.allRelations || []) {
      if (this.activeIds.has(relation.source) && !this.activeIds.has(relation.target)) related.add(relation.target);
      if (this.activeIds.has(relation.target) && !this.activeIds.has(relation.source)) related.add(relation.source);
    }
    return related;
  }

  reachableFromActive(maxDepth) {
    if (!this.activeIds?.size || !this.olfematicGraph) return new Set(this.allNodes?.map((node) => node.id) || []);
    const reachable = new Set(this.activeIds.keys());
    for (const id of this.activeIds.keys()) {
      const paths = computeShortestOlfematicPaths(this.olfematicGraph, id, { maxDepth });
      for (const nodeId of paths.distances.keys()) reachable.add(nodeId);
    }
    return reachable;
  }

  summary() {
    const degree = this.nodes.reduce((sum, node) => sum + (node.degree || 0), 0) / Math.max(1, this.nodes.length);
    return {
      nodes: this.nodes.length,
      edges: this.edges.length,
      averageDegree: degree,
      active: this.activeIds.size,
      mode: this.mode,
    };
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect?.width || window.innerWidth));
    this.height = Math.max(1, Math.round(rect?.height || window.innerHeight));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.requestRender();
  }

  bind() {
    window.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.fast = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.canvas.classList.add('dragging');
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (this.dragging) {
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.rotY += dx * 0.0065;
        this.rotX = Math.max(-1.45, Math.min(1.45, this.rotX - dy * 0.0065));
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.requestRender();
      } else {
        const previousHovered = this.hovered?.id || null;
        this.hovered = this.hitTest(event.clientX, event.clientY);
        this.showTooltip(event.clientX, event.clientY);
        if ((this.hovered?.id || null) !== previousHovered) this.requestRender();
      }
    });
    this.canvas.addEventListener('pointerup', () => {
      this.dragging = false;
      this.canvas.classList.remove('dragging');
      window.setTimeout(() => {
        this.fast = false;
        this.requestRender();
      }, 90);
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.hovered = null;
      this.tooltip.classList.remove('visible');
      this.requestRender();
    });
    this.canvas.addEventListener('click', (event) => {
      const node = this.hitTest(event.clientX, event.clientY);
      if (!node) return;
      this.selected = node;
      this.onSelect?.(node, this.neighbors(node));
      this.requestRender();
    });
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.fast = true;
      this.zoom = Math.max(0.55, Math.min(3.4, this.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
      this.requestRender();
      window.setTimeout(() => {
        this.fast = false;
        this.requestRender();
      }, 110);
    }, { passive: false });
  }

  requestRender() {
    if (this.frame) return;
    this.frame = true;
    requestAnimationFrame(() => {
      this.frame = false;
      this.render();
    });
  }

  project(point) {
    const sinX = Math.sin(this.rotX);
    const cosX = Math.cos(this.rotX);
    const sinY = Math.sin(this.rotY);
    const cosY = Math.cos(this.rotY);
    let x = point[0] * cosY - point[2] * sinY;
    let z = point[0] * sinY + point[2] * cosY;
    const y = point[1] * cosX - z * sinX;
    z = point[1] * sinX + z * cosX;
    const mobileView = this.width <= 760;
    const base = Math.min(this.width, this.height) * (mobileView ? 0.42 : 0.34) * this.zoom;
    const persp = 1 / (1.82 - z * 0.52);
    return {
      x: this.width / 2 + x * base * persp,
      y: this.height / 2 + y * base * persp,
      z,
      scale: Math.max(0.35, persp),
    };
  }

  render() {
    const ctx = this.ctx;
    const now = Date.now();
    const cameraAnimating = this.applyCameraFocus(now);
    const anim = this.animationSnapshot(now);
    ctx.clearRect(0, 0, this.width, this.height);
    this.projected = this.nodes.map((node) => ({ node, ...this.project(node.position) }));
    const byId = new Map(this.projected.map((item) => [item.node.id, item]));
    const selectedId = this.selected?.id;
    const hoveredId = this.hovered?.id;
    const selectedNeighbors = selectedId ? new Set(this.neighbors(this.selected).map((item) => item.node.id)) : new Set();
    const sessionMode = Boolean(this.params.sessionGraph && this.activeIds.size);
    const sessionProgress = this.sessionProgress();
    const sessionPulse = this.sessionStartedAt ? Math.sin((now - this.sessionStartedAt) * 0.012) * 0.5 + 0.5 : 0;

    const denseEdgeGraph = this.edges.length > 3600;
    const sourceEdges = this.fast ? this.edges.slice(0, FAST_EDGE_LIMIT) : this.edges;
    const edges = sourceEdges.map((edge) => ({
      edge,
      z: Math.min(byId.get(edge.source)?.z || 0, byId.get(edge.target)?.z || 0),
    }));
    if (!this.fast) edges.sort((a, b) => a.z - b.z);

    for (const item of edges) {
      const edge = item.edge;
      if (sessionMode && edge.revealAt > sessionProgress) continue;
      const hot = edge.source === selectedId || edge.target === selectedId || edge.source === hoveredId || edge.target === hoveredId;
      const activeEdge = this.activeIds.has(edge.source) || this.activeIds.has(edge.target);
      const relatedEdge = this.relatedIds.has(edge.source) || this.relatedIds.has(edge.target);
      const combining = sessionMode && Math.abs((edge.revealAt || 0) - sessionProgress) < 0.08;
      const inactiveEdge = anim.hasActive && !activeEdge && !relatedEdge;
      const points3d = this.fast || (denseEdgeGraph && !hot) ? edge.fastPoints : edge.points;
      const points = points3d.map((point) => this.project(point));
      const avgZ = points.reduce((sum, point) => sum + point.z, 0) / points.length;
      const depth = Math.max(0.08, Math.min(1, (avgZ + 1.15) / 2.3));
      const focusAlpha = sessionMode ? (combining ? 1 : 0.82) : this.activeIds.size ? (activeEdge ? 1 : relatedEdge ? 0.42 : 0.08) : 1;
      const decay = inactiveEdge ? 0.18 : activeEdge ? lerp(0.72, 1, anim.activationProgress) : 1;
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = edgeColor(edge, hot || activeEdge || combining, this.params.edgeOpacity * depth * focusAlpha * decay);
      ctx.lineWidth = combining ? 2.9 + sessionPulse * 1.4 : hot ? 2.25 : activeEdge ? 1.55 + anim.pulse * 0.42 : Math.max(0.32, edge.quality * 1.25 * focusAlpha * decay);
      ctx.setLineDash(edge.uncertainty > 0.55 ? [4, 5] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const nodes = this.fast ? this.projected : this.projected.slice().sort((a, b) => a.z - b.z);
    const detailedBudget = this.fast ? 0 : DETAILED_NODE_LIMIT;
    let detailedCount = 0;
    for (const item of nodes) {
      const node = item.node;
      const active = this.activeIds.has(node.id);
      if (sessionMode && active && node.revealAt > sessionProgress + 0.16) continue;
      const related = this.relatedIds.has(node.id);
      const disconnected = this.activeIds.size && this.params.disconnectedMode === 'faded' && !this.reachableIds?.has(node.id);
      const selected = node.id === selectedId;
      const hovered = node.id === hoveredId;
      const neighbor = selectedNeighbors.has(node.id);
      const depth = Math.max(0.14, Math.min(1, (item.z + 1.18) / 2.36));
      const radius = (2.3 + Math.min(4.8, (node.degree || 0) * 0.22) + creativeValue(node) * 2.6) * item.scale;
      const hot = selected || hovered || active || neighbor;
      const relatedOnly = related && !active;
      const hiddenBySession = this.activeIds.size && !active && !related;
      if (hiddenBySession) continue;
      const detailed = hot || relatedOnly || (!this.fast && item.z > 0.42 && detailedCount < detailedBudget);
      if (detailed && !hot) detailedCount += 1;
      const inactiveNode = anim.hasActive && !active && !related && !neighbor && !selected && !hovered;
      const nodeDepth = inactiveNode ? depth * 0.24 : depth;
      drawOlfemaCrystal(ctx, node, item, {
        radius: relatedOnly ? radius * 0.72 : radius,
        depth: disconnected ? depth * 0.28 : relatedOnly ? nodeDepth * 0.34 : sessionMode ? nodeDepth * Math.max(0.24, Math.min(1, (sessionProgress - (node.revealAt || 0) + 0.18) / 0.28)) : nodeDepth,
        active,
        related,
        selected,
        hovered,
        neighbor,
        detailed,
        pulse: active ? anim.pulse : 0,
        activationProgress: active ? anim.activationProgress : 0,
      });
    }
    if (cameraAnimating || this.animation.state === 'activating' || (this.sessionStartedAt && sessionProgress < 1) || anim.hasActive) {
      this.requestRender();
    }
  }

  hitTest(x, y) {
    let best = null;
    let bestDist = 13;
    for (const item of this.projected) {
      const distance = Math.hypot(item.x - x, item.y - y);
      if (distance < bestDist) {
        bestDist = distance;
        best = item.node;
      }
    }
    return best;
  }

  neighbors(node) {
    return this.edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) => {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        return { edge, node: this.nodes.find((item) => item.id === otherId) };
      })
      .filter((item) => item.node)
      .sort((a, b) => b.edge.weight - a.edge.weight);
  }

  distanceProfile(node, maxDepth = 3) {
    if (!this.olfematicGraph || !node) return [];
    const result = computeShortestOlfematicPaths(this.olfematicGraph, node.id, { maxDepth });
    return [...result.distances.entries()]
      .filter(([id]) => id !== node.id)
      .map(([id, distance]) => {
        const target = this.allNodes.find((item) => item.id === id);
        const stats = result.stats.get(id) || {};
        return target ? {
          node: target,
          distance,
          hops: stats.hops || 0,
          path: stats.path || [],
          accumulatedPolarity: stats.accumulatedPolarity || 0,
          accumulatedConfidence: stats.accumulatedConfidence || 0,
          creativeScore: creativeDifferenceScore(distance, stats),
        } : null;
      })
      .filter(Boolean);
  }

  showTooltip(x, y) {
    const node = this.hovered;
    if (!node) {
      this.tooltip.classList.remove('visible');
      return;
    }
    const activation = this.activeIds.get(node.id);
    const roleHint = node.role === 'riesgo' || node.family === 'defect' ? ' · riesgo/disonancia' : '';
    this.tooltip.innerHTML = `
      <h3>${escapeHtml(node.label)}</h3>
      <p>${escapeHtml(node.code)} · ${escapeHtml(node.family)} · ${escapeHtml(node.role)}${roleHint}</p>
      <p>polaridad ${node.hedonicPolarity.toFixed(2)} · volatilidad ${node.volatility.toFixed(2)} · intensidad ${node.intensity.toFixed(2)}</p>
      <p>fase ${escapeHtml(node.phase)} · activacion ${activation !== undefined ? activation.toFixed(2) : 'inactiva'}</p>
      <p>cristal densidad ${node.crystal?.crystal_metrics?.branch_density?.toFixed(2) || '0.00'} · tension ${node.crystal?.crystal_metrics?.semantic_tension?.toFixed(2) || '0.00'}</p>
      <p>grado ${node.degree || 0} · valor creativo ${creativeValue(node).toFixed(2)}</p>
    `;
    this.tooltip.style.left = `${Math.min(this.width - 300, x + 14)}px`;
    this.tooltip.style.top = `${Math.min(this.height - 150, y + 14)}px`;
    this.tooltip.classList.add('visible');
  }
}

function drawOlfemaCrystal(ctx, node, item, stateFlags) {
  const { radius, depth, active, related, selected, hovered, neighbor, detailed, pulse = 0, activationProgress = 0 } = stateFlags;
  const crystal = node.crystal || {};
  const metrics = crystal.crystal_metrics || {};
  const axes = crystal.axes || {};
  const density = clamp01(metrics.branch_density ?? 0.35);
  const tension = clamp01(metrics.semantic_tension ?? 0.2);
  const symmetry = clamp01(metrics.symmetry ?? 0.72);
  const purity = clamp01(metrics.purity ?? 0.55);
  const relatedOnly = related && !active;
  const boost = selected ? 2.95 : hovered ? 2.35 : active ? 1.92 + pulse * 0.04 : neighbor ? 1.52 : relatedOnly ? 0.9 : 1;
  const coreRadius = Math.max(1.4, radius * (0.42 + density * 0.18) * boost);
  const outerRadius = Math.max(coreRadius + 6, radius * (2.25 + density * 1.4 + purity * 0.5) * boost);
  const alpha = clamp01(depth * (selected || hovered || active ? 1 : relatedOnly ? 0.58 : 0.76));
  const axisNames = ['matter', 'sensation', 'hedonic', 'phase', 'context', 'associations'];
  const phase = (Date.now() * 0.00022 + seededUnit(node.id) * Math.PI * 2) % (Math.PI * 2);
  const hot = selected || hovered || active;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(item.x, item.y);
  ctx.rotate(phase * (selected || hovered ? 0.24 : 0.08));

  if (!detailed) {
    drawCompactSnowflake(ctx, node, outerRadius, coreRadius, density, tension, hot);
    ctx.restore();
    return;
  }

  if (active || selected || hovered || neighbor || relatedOnly) {
    ctx.beginPath();
    ctx.arc(0, 0, outerRadius + (selected ? 9 : active ? 5 + pulse * 2 : 5), 0, Math.PI * 2);
    ctx.fillStyle = selected
      ? 'rgba(245,247,249,0.12)'
      : active
        ? `rgba(102,227,196,${0.08 + pulse * 0.035 + activationProgress * 0.025})`
        : relatedOnly
          ? 'rgba(125,178,255,0.055)'
          : 'rgba(125,178,255,0.09)';
    ctx.fill();
  }

  axisNames.forEach((axis, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    const irregular = 0.92 + symmetry * 0.08 + seededSigned(`${node.id}:${axis}:snow`) * (0.06 + tension * 0.08);
    const length = outerRadius * irregular;
    drawSnowflakeArm(ctx, axes[axis] || [], angle, length, coreRadius, node, index, hot, density, tension);
  });

  const ringSteps = hot ? [0.42, 0.68] : [0.54];
  ringSteps.forEach((step, ringIndex) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = -Math.PI / 2 + i * Math.PI / 3;
      const wobble = 1 + seededSigned(`${node.id}:ring:${i}:${ringIndex}`) * (0.025 + tension * 0.025);
      const x = Math.cos(angle) * outerRadius * step * wobble;
      const y = Math.sin(angle) * outerRadius * step * wobble;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = crystalStroke(node.hedonicPolarity, hot ? 0.18 : 0.1);
    ctx.lineWidth = hot ? 0.72 : 0.42;
    ctx.stroke();
  });

  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 6 + i * Math.PI / 3;
    const x = Math.cos(angle) * coreRadius * 1.2;
    const y = Math.sin(angle) * coreRadius * 1.2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = nodeColor(node, relatedOnly ? 0.42 : 0.92, active, selected, hovered);
  ctx.strokeStyle = selected || hovered || active ? 'rgba(245,247,249,0.78)' : relatedOnly ? 'rgba(125,178,255,0.38)' : crystalStroke(node.hedonicPolarity, 0.38);
  ctx.lineWidth = selected ? 1.2 : active ? 0.95 + pulse * 0.12 : relatedOnly ? 0.5 : 0.72;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawCompactSnowflake(ctx, node, outerRadius, coreRadius, density, tension, hot) {
  const branchAlpha = hot ? 0.62 : 0.26;
  const armLength = Math.max(4.5, outerRadius * (0.72 + density * 0.18));
  ctx.strokeStyle = crystalStroke(node.hedonicPolarity, branchAlpha);
  ctx.lineWidth = hot ? 0.9 : 0.48;
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + i * Math.PI / 3;
    const wobble = 1 + seededSigned(`${node.id}:compact:${i}`) * (0.025 + tension * 0.035);
    const end = armLength * wobble;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(ca * coreRadius * 0.8, sa * coreRadius * 0.8);
    ctx.lineTo(ca * end, sa * end);
    ctx.stroke();
    const branchAt = end * (0.48 + density * 0.16);
    const branchLen = end * (0.16 + density * 0.08);
    const branchTilt = Math.PI / 3.5;
    [-1, 1].forEach((side) => {
      const ba = angle + side * branchTilt;
      ctx.beginPath();
      ctx.moveTo(ca * branchAt, sa * branchAt);
      ctx.lineTo(ca * branchAt + Math.cos(ba) * branchLen, sa * branchAt + Math.sin(ba) * branchLen);
      ctx.stroke();
    });
  }
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1.2, coreRadius), 0, Math.PI * 2);
  ctx.fillStyle = crystalStroke(node.hedonicPolarity, hot ? 0.68 : 0.34);
  ctx.fill();
}

function drawSnowflakeArm(ctx, descriptors, angle, length, coreRadius, node, axisIndex, hot, density, tension) {
  const items = descriptors.slice(0, hot ? 5 : 3);
  const branchCount = Math.max(2, Math.min(hot ? 5 : 3, items.length + Math.round(density * 2)));
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(coreRadius * 0.95, 0);
  ctx.lineTo(length, 0);
  ctx.strokeStyle = crystalStroke(node.hedonicPolarity, hot ? 0.62 : 0.34);
  ctx.lineWidth = hot ? 1.15 : 0.68;
  ctx.stroke();

  for (let index = 0; index < branchCount; index += 1) {
    const descriptor = items[index] || {};
    const t = (index + 1) / (branchCount + 1);
    const x = coreRadius + (length - coreRadius) * t;
    const weight = descriptor.weight || (0.38 + density * 0.36);
    const branch = (length * (0.14 + weight * 0.14)) * (1 - t * 0.28);
    const tilt = Math.PI / (3.35 + density * 0.8) + seededSigned(`${node.id}:tilt:${axisIndex}:${index}`) * tension * 0.12;
    [-1, 1].forEach((side) => {
      const bx = x + Math.cos(side * tilt) * branch;
      const by = Math.sin(side * tilt) * branch;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = crystalStroke(descriptor.polarity ?? node.hedonicPolarity, 0.2 + (descriptor.volatility || 0.4) * (hot ? 0.42 : 0.28));
      ctx.lineWidth = (hot ? 0.72 : 0.48) + weight * 0.42;
      if ((descriptor.polarity ?? 0) < -0.25) ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (hot && index < 3) {
        const twig = branch * 0.34;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - Math.cos(side * tilt * 1.65) * twig, by + Math.sin(side * tilt * 1.65) * twig);
        ctx.strokeStyle = crystalStroke(descriptor.polarity ?? node.hedonicPolarity, 0.2);
        ctx.lineWidth = 0.42;
        ctx.stroke();
      }
    });
  }
  ctx.restore();
}

function crystalFill(polarity, alpha) {
  if (polarity < -0.25) return `rgba(255,111,145,${alpha})`;
  if (polarity > 0.25) return `rgba(102,227,196,${alpha})`;
  return `rgba(174,182,193,${alpha})`;
}

function crystalStroke(polarity, alpha) {
  if (polarity < -0.25) return `rgba(255,111,145,${alpha})`;
  if (polarity > 0.25) return `rgba(102,227,196,${alpha})`;
  return `rgba(174,182,193,${alpha})`;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
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

function assignPositions(nodes) {
  const total = Math.max(1, nodes.length);
  nodes.forEach((node, index) => {
    const y = 1 - (index / Math.max(1, total - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * index + familyAngle(node.family) * 0.18;
    const fib = [Math.cos(theta) * r, y, Math.sin(theta) * r];
    const semantic = vec.norm([
      (node.semanticVector?.[0] || 0) + (node.semanticVector?.[3] || 0) * 0.4,
      node.hedonicPolarity * 0.85 + (node.volatility - 0.5) * 0.32,
      (node.semanticVector?.[1] || 0) - (node.semanticVector?.[4] || 0) * 0.4,
    ]);
    const mixed = vec.norm(vec.add(vec.scale(fib, 0.54), vec.scale(semantic, 0.46)));
    node.position = mixed;
  });
}

function assignSessionPhasePositions(nodes, edges, activeIds) {
  const phaseOrder = ['head', 'heart', 'transition', 'ambient', 'global', 'base', 'defect'];
  const phaseIndex = (phase) => {
    const index = phaseOrder.indexOf(String(phase || '').toLowerCase());
    return index === -1 ? phaseOrder.length : index;
  };
  const grouped = new Map();
  nodes
    .slice()
    .sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase)
      || String(a.family).localeCompare(String(b.family))
      || String(a.label).localeCompare(String(b.label)))
    .forEach((node) => {
      const phase = String(node.phase || 'ambient').toLowerCase();
      if (!grouped.has(phase)) grouped.set(phase, []);
      grouped.get(phase).push(node);
    });
  const groups = [...grouped.entries()].sort((a, b) => phaseIndex(a[0]) - phaseIndex(b[0]));
  groups.forEach(([phase, phaseNodes], groupIndex) => {
    const latitude = groups.length === 1 ? 0 : 0.76 - (groupIndex / Math.max(1, groups.length - 1)) * 1.52;
    const ringRadius = Math.sqrt(Math.max(0.05, 1 - latitude * latitude));
    phaseNodes.forEach((node, index) => {
      const score = activeIds?.get(node.id) || 0.5;
      const angle = (index / Math.max(1, phaseNodes.length)) * Math.PI * 2
        + familyAngle(node.family) * 0.22
        + seededSigned(`${phase}:${node.id}:session`) * 0.18;
      const radial = ringRadius * (0.76 + score * 0.18);
      const semanticLift = (node.semanticVector?.[2] || 0) * 0.08;
      node.position = vec.norm([
        Math.cos(angle) * radial,
        latitude + semanticLift,
        Math.sin(angle) * radial,
      ]);
      node.revealAt = Math.max(0, Math.min(0.86, groupIndex * 0.13 + index / Math.max(12, phaseNodes.length * 7)));
    });
  });
  edges.forEach((edge, index) => {
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    const phaseReveal = Math.min(source?.revealAt || 0, target?.revealAt || 0);
    edge.sourceLabel = source?.label || edge.source;
    edge.targetLabel = target?.label || edge.target;
    edge.revealAt = Math.max(0.08, Math.min(0.94, phaseReveal + 0.1 + index / Math.max(18, edges.length * 5)));
  });
}

function buildSessionEdges(nodes, rawEdges, activeIds) {
  if (nodes.length < 2) return rawEdges.map((edge, index) => decorateSessionEdge(edge, nodes, index, rawEdges.length));
  const byPair = new Map();
  const edges = rawEdges.map((edge, index) => decorateSessionEdge(edge, nodes, index, rawEdges.length));
  edges.forEach((edge) => byPair.set(pairKey(edge.source, edge.target), edge));

  const phaseOrder = ['head', 'heart', 'transition', 'ambient', 'global', 'base', 'defect'];
  const sorted = nodes.slice().sort((a, b) => {
    const phaseDelta = phaseRank(a.phase, phaseOrder) - phaseRank(b.phase, phaseOrder);
    if (phaseDelta) return phaseDelta;
    return (activeIds.get(b.id) || 0) - (activeIds.get(a.id) || 0)
      || String(a.family).localeCompare(String(b.family))
      || String(a.label).localeCompare(String(b.label));
  });
  const grouped = new Map();
  sorted.forEach((node) => {
    const phase = String(node.phase || 'ambient').toLowerCase();
    if (!grouped.has(phase)) grouped.set(phase, []);
    grouped.get(phase).push(node);
  });

  for (const phaseNodes of grouped.values()) {
    for (let index = 1; index < phaseNodes.length; index += 1) {
      addSessionEdge(phaseNodes[index - 1], phaseNodes[index], edges, byPair);
    }
  }
  const phaseAnchors = [...grouped.values()].map((phaseNodes) => phaseNodes[0]).filter(Boolean);
  for (let index = 1; index < phaseAnchors.length; index += 1) {
    addSessionEdge(phaseAnchors[index - 1], phaseAnchors[index], edges, byPair);
  }
  if (!edges.length) {
    for (let index = 1; index < sorted.length; index += 1) {
      addSessionEdge(sorted[index - 1], sorted[index], edges, byPair);
    }
  }
  return edges
    .sort((a, b) => relationRevealSeed(a) - relationRevealSeed(b))
    .map((edge, index, list) => ({ ...edge, revealAt: Math.max(0.08, Math.min(0.94, index / Math.max(1, list.length))) }));
}

function decorateSessionEdge(edge, nodes, index, total) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  const relation = source && target ? sessionRelationFromNodes(source, target, edge) : {};
  return {
    ...edge,
    sourceLabel: source?.label || edge.source,
    targetLabel: target?.label || edge.target,
    rationale: relation.rationale || edge.rationale || '',
    sourceRationale: edge.rationale || '',
    revealAt: Math.max(0.08, Math.min(0.94, index / Math.max(1, total))),
  };
}

function addSessionEdge(source, target, edges, byPair) {
  const key = pairKey(source.id, target.id);
  if (byPair.has(key)) return;
  const relation = sessionRelationFromNodes(source, target);
  const edge = {
    id: `SESSION_${source.id}__${target.id}`,
    source: source.id,
    target: target.id,
    sourceLabel: source.label,
    targetLabel: target.label,
    predicate: 'session_blend',
    rationale: relation.rationale,
    distance: relation.distance,
    desiredLength: chordLengthForRelation(relation.distance),
    weight: relation.weight,
    quality: relation.quality,
    confidence: relation.confidence,
    uncertainty: relation.uncertainty,
    polarityScore: relation.polarityScore,
    relationClass: relation.relationClass,
    synthetic: true,
  };
  byPair.set(key, edge);
  edges.push(edge);
}

function sessionRelationFromNodes(source, target, rawEdge = null) {
  const crystalA = source.crystal?.crystal_metrics || {};
  const crystalB = target.crystal?.crystal_metrics || {};
  const phaseBonus = source.phase === target.phase ? 0.18 : 0;
  const familyBonus = source.family === target.family ? 0.12 : 0;
  const polarityGap = Math.abs(source.hedonicPolarity - target.hedonicPolarity);
  const densityGap = Math.abs((crystalA.branch_density || 0.4) - (crystalB.branch_density || 0.4));
  const tensionBlend = ((crystalA.semantic_tension || 0.25) + (crystalB.semantic_tension || 0.25)) / 2;
  const semantic = semanticSimilarity(source.semanticVector, target.semanticVector);
  const proximity = Math.max(0.08, Math.min(1, 0.48 + semantic * 0.28 + phaseBonus + familyBonus - polarityGap * 0.16 - densityGap * 0.12));
  const distance = rawEdge?.distance || Math.max(0.24, Math.min(1.35, 1.18 - proximity * 0.74 + tensionBlend * 0.12));
  const relationClass = rawEdge?.relationClass || (polarityGap > 0.65 ? 'creative' : proximity > 0.68 ? 'positive' : 'neutral');
  return {
    distance,
    weight: rawEdge?.weight || proximity,
    quality: rawEdge?.quality || Math.max(0.28, proximity),
    confidence: rawEdge?.confidence || Math.max(0.42, Math.min(0.86, proximity + 0.08)),
    uncertainty: rawEdge?.uncertainty || Math.max(0.12, Math.min(0.54, 0.58 - proximity * 0.42)),
    polarityScore: rawEdge?.polarityScore || 1 - polarityGap,
    relationClass,
    rationale: `${source.phase}/${target.phase}: ${source.family} ${source.label} se combina con ${target.family} ${target.label}; proximidad ${proximity.toFixed(2)}, tension ${tensionBlend.toFixed(2)}, copos ${formatCrystalDelta(crystalA, crystalB)}.`,
  };
}

function semanticSimilarity(a = [], b = []) {
  const len = Math.max(a.length, b.length);
  if (!len) return 0;
  let dot = 0;
  for (let index = 0; index < len; index += 1) dot += (a[index] || 0) * (b[index] || 0);
  return Math.max(-1, Math.min(1, dot));
}

function formatCrystalDelta(a, b) {
  const symmetry = 1 - Math.abs((a.symmetry || 0.6) - (b.symmetry || 0.6));
  const purity = 1 - Math.abs((a.purity || 0.5) - (b.purity || 0.5));
  return `simetria ${Math.max(0, symmetry).toFixed(2)} / pureza ${Math.max(0, purity).toFixed(2)}`;
}

function phaseRank(phase, phaseOrder) {
  const index = phaseOrder.indexOf(String(phase || '').toLowerCase());
  return index === -1 ? phaseOrder.length : index;
}

function pairKey(a, b) {
  return [a, b].sort().join('::');
}

function relationRevealSeed(edge) {
  return phaseHeight(edge.phase) + seededSigned(edge.id) * 0.01;
}

function buildEdges(nodes, relations, params) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  const densityLimit = edgeDensityLimit(params.edgeDensity, relations.length);
  const preserveJsonRelations = params.mode === 'raw' && params.respectRawRelations;
  const candidates = [];
  for (const relation of relations) {
    const source = byId.get(relation.source);
    const target = byId.get(relation.target);
    if (!source || !target) continue;
    if (!relationPassesFilters(relation, params)) continue;
    const activeBonus = params.scope === 'active' && (params.activeIds?.has(source.id) || params.activeIds?.has(target.id)) ? -0.25 : 0;
    const classBonus = relation.relationClass === 'creative' ? -0.06 : relation.relationClass === 'risk' ? -0.03 : 0;
    candidates.push({ source, target, relation, score: relation.edgeLength - relation.quality + activeBonus + classBonus });
  }
  candidates.sort((a, b) => a.score - b.score || b.relation.quality - a.relation.quality);
  const edges = [];
  for (const candidate of candidates) {
    if (edges.length >= densityLimit) break;
    const sd = degree.get(candidate.source.id) || 0;
    const td = degree.get(candidate.target.id) || 0;
    if (!preserveJsonRelations && (sd >= params.maxDegree || td >= params.maxDegree)) continue;
    degree.set(candidate.source.id, sd + 1);
    degree.set(candidate.target.id, td + 1);
    edges.push({
      id: candidate.relation.id || `R${edges.length}`,
      source: candidate.source.id,
      target: candidate.target.id,
      predicate: candidate.relation.predicate,
      rationale: candidate.relation.rationale || '',
      distance: candidate.relation.edgeLength,
      desiredLength: chordLengthForRelation(candidate.relation.edgeLength),
      weight: candidate.relation.weight,
      quality: candidate.relation.quality,
      confidence: candidate.relation.confidence,
      uncertainty: candidate.relation.uncertainty,
      polarityScore: candidate.relation.polarityScore,
      relationClass: candidate.relation.relationClass,
    });
  }
  nodes.forEach((node) => { node.degree = degree.get(node.id) || 0; });
  return edges;
}

function relationPassesFilters(relation, params) {
  if (relation.confidence < (params.minConfidence ?? 0)) return false;
  if (!params.showUncertain && relation.uncertainty > 0.55) return false;
  if (params.polarityFilter && params.polarityFilter !== 'all' && relation.relationClass !== params.polarityFilter) return false;
  if (params.predicate !== 'all' && relation.predicate !== params.predicate) return false;
  if (params.mode === 'raw') return true;
  if (params.mode === 'resonance') return relation.relationClass === 'positive' || (relation.polarityScore > 0.35 && relation.edgeLength <= 0.9);
  if (params.mode === 'creative') return relation.relationClass === 'creative' || (relation.edgeLength > 1.05 && relation.edgeLength <= 1.45 && relation.polarityScore > -0.25);
  if (params.mode === 'risk') return relation.relationClass === 'risk' || relation.relationClass === 'negative';
  return true;
}

function edgeDensityLimit(density, relationCount) {
  if (density === 'json') return relationCount;
  if (density === 'low') return Math.min(900, relationCount);
  if (density === 'high') return Math.min(5200, relationCount);
  return Math.min(2600, relationCount);
}

function chordLengthForRelation(length) {
  return Math.max(0.28, Math.min(1.78, 0.18 + length * 0.7));
}

function relaxSphericalLayout(nodes, edges, params) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const largeRawGraph = params.mode === 'raw' && (nodes.length > 1200 || edges.length > 2800);
  const iterations = largeRawGraph ? 3 : params.mode === 'raw' ? 6 : RELAX_ITERATIONS;
  for (let iter = 0; iter < iterations; iter += 1) {
    const step = 0.018 * (1 - iter / (iterations + 3));
    for (const edge of edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const delta = vec.add(target.position, vec.scale(source.position, -1));
      const current = Math.hypot(delta[0], delta[1], delta[2]) || 0.001;
      const force = (current - edge.desiredLength) * step * edge.quality;
      const dir = vec.scale(delta, 1 / current);
      source.position = tangentMove(source.position, dir, force);
      target.position = tangentMove(target.position, dir, -force);
    }
    applyLocalRepulsion(nodes, step * 0.42);
    applySemanticAnchors(nodes, step * 0.24);
  }
}

function applyLocalRepulsion(nodes, strength) {
  const stride = Math.max(1, Math.floor(nodes.length / 260));
  for (let i = 0; i < nodes.length; i += stride) {
    const a = nodes[i];
    for (let j = i + stride; j < Math.min(nodes.length, i + stride * 12); j += stride) {
      const b = nodes[j];
      const delta = vec.add(b.position, vec.scale(a.position, -1));
      const distance = Math.hypot(delta[0], delta[1], delta[2]) || 0.001;
      if (distance > 0.34) continue;
      const force = (0.34 - distance) * strength;
      const dir = vec.scale(delta, 1 / distance);
      a.position = tangentMove(a.position, dir, -force);
      b.position = tangentMove(b.position, dir, force);
    }
  }
}

function applySemanticAnchors(nodes, strength) {
  for (const node of nodes) {
    const target = vec.norm([
      Math.cos(familyAngle(node.family)) * 0.72 + (node.semanticVector?.[0] || 0) * 0.28,
      phaseHeight(node.phase) + node.hedonicPolarity * 0.22,
      Math.sin(familyAngle(node.family)) * 0.72 + (node.semanticVector?.[1] || 0) * 0.28,
    ]);
    node.position = vec.norm(vec.add(vec.scale(node.position, 1 - strength), vec.scale(target, strength)));
  }
}

function pushDisconnectedOpposite(nodes, reachableIds) {
  if (!reachableIds?.size) return;
  const active = nodes.filter((node) => reachableIds.has(node.id));
  if (!active.length) return;
  const center = vec.norm(active.reduce((acc, node) => vec.add(acc, node.position), [0, 0, 0]));
  const opposite = vec.scale(center, -1);
  for (const node of nodes) {
    if (reachableIds.has(node.id)) continue;
    const jitter = vec.norm([
      opposite[0] + (node.semanticVector?.[0] || 0) * 0.22,
      opposite[1] + (node.semanticVector?.[2] || 0) * 0.18,
      opposite[2] + (node.semanticVector?.[1] || 0) * 0.22,
    ]);
    node.position = vec.norm(vec.add(vec.scale(node.position, 0.28), vec.scale(jitter, 0.72)));
  }
}

function tangentMove(position, direction, amount) {
  const dot = vec.dot(direction, position);
  const tangent = vec.norm(vec.add(direction, vec.scale(position, -dot)));
  return vec.norm(vec.add(position, vec.scale(tangent, amount)));
}

function finalizeEdgeGeometry(edges, nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    edge.points = arcPoints(source.position, target.position, ARC_STEPS);
    edge.fastPoints = arcPoints(source.position, target.position, FAST_ARC_STEPS);
  }
}

function arcPoints(a, b, steps) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push(slerp(a, b, i / steps));
  return points;
}

function slerp(a, b, t) {
  const an = vec.norm(a);
  const bn = vec.norm(b);
  const dot = Math.max(-1, Math.min(1, vec.dot(an, bn)));
  const theta = Math.acos(dot);
  if (theta < 1e-5) return vec.scale(an, 1.006);
  const sinTheta = Math.sin(theta);
  const s1 = Math.sin((1 - t) * theta) / sinTheta;
  const s2 = Math.sin(t * theta) / sinTheta;
  return vec.scale(vec.norm(vec.add(vec.scale(an, s1), vec.scale(bn, s2))), 1.006);
}

function edgeColor(edge, hot, alpha) {
  const a = hot ? 0.92 : Math.max(0.04, Math.min(0.86, alpha));
  if (edge.relationClass === 'risk' || edge.relationClass === 'negative') return `rgba(255,111,145,${a})`;
  if (edge.relationClass === 'creative') return `rgba(190,160,255,${a})`;
  if (edge.relationClass === 'neutral' || edge.relationClass === 'unknown') return `rgba(174,182,193,${a * 0.82})`;
  return `rgba(102,227,196,${a})`;
}

function nodeColor(node, depth, active, selected, hovered) {
  const [r, g, b] = familyRgb(node.family);
  const alpha = selected || hovered || active ? 1 : Math.max(0.24, depth * 0.78);
  return `rgba(${r},${g},${b},${alpha})`;
}

function familyRgb(family) {
  const palette = [
    [102, 227, 196],
    [125, 178, 255],
    [255, 111, 145],
    [242, 200, 107],
    [190, 160, 255],
    [111, 219, 244],
    [255, 151, 108],
    [218, 226, 232],
  ];
  return palette[Math.abs(hash(family)) % palette.length];
}

function familyAngle(family) {
  return (Math.abs(hash(family)) % 360) * Math.PI / 180;
}

function phaseHeight(phase) {
  const map = { head: 0.78, heart: 0.18, base: -0.62, transition: -0.08, ambient: 0, global: 0.1, defect: -0.34 };
  return map[String(phase || '').toLowerCase()] ?? 0;
}

function relationCount(id, relations) {
  return relations.reduce((sum, relation) => sum + (relation.source === id || relation.target === id ? 1 : 0), 0);
}

function hash(value) {
  let h = 0;
  for (const ch of String(value || '')) h = Math.imul(31, h) + ch.charCodeAt(0) | 0;
  return h;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
