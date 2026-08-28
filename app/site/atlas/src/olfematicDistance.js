const POSITIVE_PREDICATES = new Map([
  ['similar_to', 0.9],
  ['synonym_of', 1.0],
  ['reinforces', 0.8],
  ['harmonizes_with', 0.8],
  ['belongs_to_family', 0.7],
  ['shares_facet', 0.7],
  ['material_association', 0.6],
  ['contains_note', 0.6],
  ['evokes', 0.5],
  ['transition_to', 0.4],
  ['blends_with', 0.72],
  ['enhances', 0.68],
  ['related_to', 0.18],
]);

const CREATIVE_PREDICATES = new Map([
  ['contrasts_with', 0.15],
  ['balances', 0.25],
  ['bridges_to', 0.35],
  ['transforms_into', 0.25],
  ['modulates', 0.3],
]);

const NEGATIVE_PREDICATES = new Map([
  ['opposes', -0.7],
  ['masks', -0.5],
  ['clashes_with', -0.8],
  ['risk_of', -0.9],
  ['defect_associated', -0.9],
  ['instability_with', -0.8],
  ['regulatory_warning', -0.9],
  ['can_trigger', -0.72],
]);

const RELATION_CLASS_LABELS = {
  positive: 'resonancia',
  neutral: 'relacion neutral',
  creative: 'diferencia creativa',
  negative: 'tension negativa',
  risk: 'riesgo/defecto',
  unknown: 'relacion desconocida',
};

export function normalizeRelationForDistance(relation) {
  const source = relation.source ?? relation.origen;
  const target = relation.target ?? relation.destino;
  const predicate = normalizePredicate(relation.predicate ?? relation.predicado ?? 'related_to');
  const normalized = {
    id: relation.id ?? relation.relacion ?? `${source}--${target}`,
    source,
    target,
    predicate,
    confidence: toNumber(relation.confidence ?? relation.confianza, 0.5),
    uncertainty: toNumber(relation.uncertainty ?? relation.incertidumbre, 0.25),
    weight: toNumber(relation.weight ?? relation.peso, 1.0),
    rationale: relation.rationale ?? relation.racional_comentario ?? '',
    phase: relation.phase ?? relation.fase ?? '',
  };
  normalized.polarityScore = relationPolarityScore({ ...relation, predicate });
  normalized.quality = relationQuality(normalized);
  normalized.edgeLength = edgeLength(normalized);
  normalized.relationClass = computeRelationClass(normalized);
  return normalized;
}

export function relationPolarityScore(relation) {
  const explicit = relation.polarity ?? relation.polaridad;
  if (isFiniteNumber(explicit)) return clamp(Number(explicit), -1, 1);
  const predicate = normalizePredicate(relation.predicate ?? relation.predicado);
  if (POSITIVE_PREDICATES.has(predicate)) return POSITIVE_PREDICATES.get(predicate);
  if (CREATIVE_PREDICATES.has(predicate)) return CREATIVE_PREDICATES.get(predicate);
  if (NEGATIVE_PREDICATES.has(predicate)) return NEGATIVE_PREDICATES.get(predicate);
  return 0;
}

export function relationQuality(relation) {
  const confidence = clamp(toNumber(relation.confidence ?? relation.confianza, 0.5), 0, 1);
  const uncertainty = clamp(toNumber(relation.uncertainty ?? relation.incertidumbre, 0.25), 0, 1);
  const weight = clamp(toNumber(relation.weight ?? relation.peso, 1.0), 0.1, 2.0);
  return confidence * (1 - uncertainty) * weight;
}

export function edgeLength(relation) {
  const polarity = relation.polarityScore ?? relationPolarityScore(relation);
  const quality = relation.quality ?? relationQuality(relation);
  let length = 1.0;
  length *= (1 - 0.35 * Math.max(polarity, 0) * quality);
  length *= (1 + 0.55 * Math.max(-polarity, 0) * quality);
  return clamp(length, 0.45, 2.25);
}

export function buildOlfematicAdjacency(nodes, relations) {
  const graph = new Map();
  const validIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) graph.set(node.id, []);
  for (const relation of relations) {
    const normalized = normalizeRelationForDistance(relation);
    if (!validIds.has(normalized.source) || !validIds.has(normalized.target)) continue;
    const forward = adjacencyEdge(normalized, normalized.target);
    const backward = adjacencyEdge(normalized, normalized.source);
    graph.get(normalized.source).push(forward);
    graph.get(normalized.target).push(backward);
  }
  return { nodes, relations, adjacency: graph };
}

export function computeShortestOlfematicPaths(graph, sourceId, options = {}) {
  const adjacency = graph.adjacency || graph;
  const maxDepth = options.maxDepth ?? Infinity;
  const maxDistance = options.maxDistance ?? Infinity;
  const distances = new Map();
  const previous = new Map();
  const stats = new Map();
  const queue = [{ id: sourceId, distance: 0, hops: 0, polarity: 0, confidence: 1 }];
  distances.set(sourceId, 0);
  stats.set(sourceId, { hops: 0, accumulatedPolarity: 0, accumulatedConfidence: 1, path: [sourceId] });

  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance);
    const current = queue.shift();
    if (current.distance > (distances.get(current.id) ?? Infinity)) continue;
    if (current.hops >= maxDepth) continue;
    for (const edge of adjacency.get(current.id) || []) {
      const nextDistance = current.distance + edge.length;
      const nextHops = current.hops + 1;
      if (nextDistance > maxDistance || nextHops > maxDepth) continue;
      if (nextDistance >= (distances.get(edge.target) ?? Infinity)) continue;
      distances.set(edge.target, nextDistance);
      previous.set(edge.target, { id: current.id, edge });
      const previousStats = stats.get(current.id) || { path: [current.id], accumulatedPolarity: 0, accumulatedConfidence: 1 };
      stats.set(edge.target, {
        hops: nextHops,
        accumulatedPolarity: previousStats.accumulatedPolarity + edge.polarity,
        accumulatedConfidence: previousStats.accumulatedConfidence * edge.quality,
        path: [...previousStats.path, edge.target],
        lastRelationClass: edge.relationClass,
      });
      queue.push({
        id: edge.target,
        distance: nextDistance,
        hops: nextHops,
        polarity: edge.polarity,
        confidence: edge.quality,
      });
    }
  }
  return { sourceId, distances, previous, stats };
}

export function computeOlfematicDistance(sourceId, targetId, graph) {
  const result = computeShortestOlfematicPaths(graph, sourceId);
  return result.distances.get(targetId) ?? Infinity;
}

export function classifyOlfematicDistance(distance, pathStats = {}) {
  if (!Number.isFinite(distance)) return 'unknown';
  const polarity = pathStats.accumulatedPolarity ?? 0;
  const lastClass = pathStats.lastRelationClass;
  if (lastClass === 'risk') return 'opposed';
  if (distance <= 0.85) return 'close';
  if (distance <= 1.35) return polarity > 0.35 ? 'resonant' : 'close';
  if (distance <= 2.25) return polarity < -0.35 ? 'opposed' : 'creative_difference';
  if (distance <= 3.5) return 'remote';
  return 'remote';
}

export function computeRelationClass(relation) {
  const predicate = normalizePredicate(relation.predicate ?? relation.predicado);
  const polarity = relation.polarityScore ?? relationPolarityScore(relation);
  if (['risk_of', 'defect_associated', 'instability_with', 'regulatory_warning', 'can_trigger'].includes(predicate)) return 'risk';
  if (CREATIVE_PREDICATES.has(predicate)) return 'creative';
  if (polarity >= 0.45) return 'positive';
  if (polarity <= -0.45) return 'negative';
  if (predicate === 'unknown' || !predicate) return 'unknown';
  return Math.abs(polarity) < 0.08 ? 'neutral' : 'creative';
}

export function creativeDifferenceScore(distance, pathStats = {}) {
  if (!Number.isFinite(distance)) return 0;
  const averageConfidence = clamp(pathStats.accumulatedConfidence ?? pathStats.averageConfidence ?? 0.5, 0, 1);
  const polarity = pathStats.accumulatedPolarity ?? 0;
  return bellCurve(distance, 1.8, 0.75) * averageConfidence * (1 - Math.max(0, -polarity) * 0.4);
}

export function getDistanceLegend() {
  return [
    { className: 'positive', label: RELATION_CLASS_LABELS.positive, meaning: 'relacion coherente que acorta distancia visual' },
    { className: 'neutral', label: RELATION_CLASS_LABELS.neutral, meaning: 'vinculo medio sin polaridad dominante' },
    { className: 'creative', label: RELATION_CLASS_LABELS.creative, meaning: 'contraste fertil, puente o transicion compositiva' },
    { className: 'negative', label: RELATION_CLASS_LABELS.negative, meaning: 'oposicion o choque que aumenta distancia' },
    { className: 'risk', label: RELATION_CLASS_LABELS.risk, meaning: 'riesgo, defecto o inestabilidad visible' },
  ];
}

function adjacencyEdge(relation, target) {
  return {
    target,
    relationId: relation.id,
    length: relation.edgeLength,
    polarity: relation.polarityScore,
    quality: relation.quality,
    predicate: relation.predicate,
    relationClass: relation.relationClass,
    confidence: relation.confidence,
    uncertainty: relation.uncertainty,
    weight: relation.weight,
  };
}

function normalizePredicate(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function toNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function isFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim()) return Number.isFinite(Number.parseFloat(value.replace(',', '.')));
  return false;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bellCurve(value, center, width) {
  const x = (value - center) / Math.max(0.001, width);
  return Math.exp(-0.5 * x * x);
}
