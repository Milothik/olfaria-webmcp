const FAMILY_GROUPS = {
  citrus: 'fresh', green: 'fresh', herbal: 'fresh', aromatic: 'fresh', marine: 'fresh', ozonic: 'fresh',
  floral: 'floral', powdery: 'floral', cosmetic: 'floral',
  woody: 'base', amber: 'base', resinous: 'base', balsamic: 'base', musk: 'base', leather: 'base', smoke: 'base', smoky: 'base',
  gourmand: 'sweet', fruity: 'sweet', food: 'sweet', dairy: 'sweet', honey: 'sweet', drink: 'sweet',
  spicy: 'warm', tobacco: 'warm', animalic: 'warm',
  defect: 'risk', regulatory: 'risk', stability: 'risk', performance: 'risk',
  cultural: 'context', emotional: 'context', intention: 'context', season: 'context', time: 'context', temporal: 'context', texture: 'context',
};

export function semanticDistance(a, b) {
  const av = a.semanticVector || [];
  const bv = b.semanticVector || [];
  let dot = 0;
  for (let i = 0; i < Math.min(av.length, bv.length); i += 1) dot += av[i] * bv[i];
  return Math.max(0, Math.min(1, (1 - dot) / 2));
}

export function familyDistance(a, b) {
  if (a.family === b.family) return 0;
  const ag = FAMILY_GROUPS[a.family] || a.family;
  const bg = FAMILY_GROUPS[b.family] || b.family;
  if (ag === bg) return 0.28;
  if ((ag === 'risk' && bg !== 'risk') || (bg === 'risk' && ag !== 'risk')) return 0.72;
  return 0.52;
}

export function olfactoryDistance(a, b) {
  const semantic = semanticDistance(a, b);
  const volatility = Math.abs(a.volatility - b.volatility);
  const intensity = Math.abs(a.intensity - b.intensity);
  const hedonic = Math.abs(a.hedonicPolarity - b.hedonicPolarity) / 2;
  const family = familyDistance(a, b);
  return (
    0.38 * semantic
    + 0.16 * volatility
    + 0.12 * intensity
    + 0.17 * hedonic
    + 0.17 * family
  );
}

export function relationBoost(relation) {
  if (!relation) return 0;
  const confidence = Number(relation.confidence || 0.5);
  if (relation.predicate === 'blends_with' || relation.predicate === 'enhances') return -0.08 * confidence;
  if (relation.predicate === 'contrasts_with') return 0.02 * confidence;
  if (relation.predicate === 'risk_of' || relation.predicate === 'can_trigger') return 0.04 * confidence;
  return -0.03 * confidence;
}

export function creativeValue(node) {
  const role = node.role === 'riesgo' ? 0.15 : node.role === 'criterio' ? 0.22 : 0.38;
  const polarityBalance = 1 - Math.min(1, Math.abs(node.hedonicPolarity));
  return Math.max(0.05, Math.min(1, role + node.intensity * 0.24 + node.volatility * 0.16 + polarityBalance * 0.22));
}

export function modeAcceptsEdge(mode, source, target, distance, targetDistance, tolerance, relation) {
  if (mode === 'resonance') return Math.abs(distance - targetDistance) <= tolerance;
  if (mode === 'similarity') return distance <= Math.max(0.16, targetDistance * 0.62);
  if (mode === 'contrast') {
    const hedonicGap = Math.abs(source.hedonicPolarity - target.hedonicPolarity);
    const familyGap = familyDistance(source, target);
    return distance >= targetDistance * 0.86 && distance <= targetDistance + tolerance * 2.4 && (hedonicGap > 0.38 || familyGap > 0.48);
  }
  if (mode === 'bridge') {
    if (source.family === target.family) return false;
    const usefulRelation = relation && ['blends_with', 'enhances', 'related_to', 'contrasts_with'].includes(relation.predicate);
    return usefulRelation || Math.abs(distance - targetDistance) <= tolerance * 1.4;
  }
  return false;
}
