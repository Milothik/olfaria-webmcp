export async function loadDataset() {
  const rootSegment = window.location.pathname.split('/').filter(Boolean)[0];
  const url = rootSegment?.startsWith('olfaria')
    ? `/${rootSegment}/api/data`
    : '/api/data';
  return normalizeDataset(await requestJson(url));
}

const CRYSTAL_AXES = ['matter', 'sensation', 'hedonic', 'phase', 'context', 'associations'];

function requestJson(url) {
  if (typeof fetch === 'function') {
    return fetch(url, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`HTTP ${xhr.status}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error('No se pudo cargar JSON'));
    xhr.send();
  });
}

function coerceNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined).map(String) : [];
}

function cloneJson(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeIntensity(raw) {
  if (Array.isArray(raw)) return raw.map((n) => coerceNumber(n, 0)).slice(0, 2);
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.range)) return raw.range.map((n) => coerceNumber(n, 0)).slice(0, 2);
    return [coerceNumber(raw.min, 1), coerceNumber(raw.max, 3)];
  }
  return [1, 3];
}

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function normalizeDataset(raw) {
  const rawOlfemas = Array.isArray(raw?.olfemas) ? raw.olfemas : [];
  const rawRelations = Array.isArray(raw?.relations) ? raw.relations : Array.isArray(raw?.relaciones) ? raw.relaciones : [];
  const nodes = [];
  const byId = new Map();
  const byCode = new Map();
  const byIdKey = new Map();

  for (const item of rawOlfemas) {
    const code = item.codigo || item.olfaria_code || '';
    const idKey = item.id_key || '';
    const id = item.id || idKey || code;
    if (!id || byId.has(id)) continue;
    const intensity = normalizeIntensity(item.intensidad || item.intensity_range);
    const node = {
      id,
      code: code || id,
      idKey: idKey || id,
      label: item.etiqueta || item.label || id,
      family: item.familia || item.family || 'unknown',
      subfamily: item.faceta || item.facet || '',
      phase: item.fase || item.typical_phase || 'ambient',
      intensityRange: intensity,
      intensity: Math.max(0, Math.min(1, ((intensity[0] || 1) + (intensity[1] || 3)) / 10)),
      hedonicPolarity: Math.max(-1, Math.min(1, coerceNumber(item.polaridad ?? item.polarity, 0))),
      synonyms: normalizeList(item.sinonimos || item.synonyms),
      materials: normalizeList(item.ingredientes_materiales || item.related_ingredients_or_materials),
      riskFlags: normalizeList(item.risk_flags),
      role: inferRole(item),
      raw: cloneJson(item),
      searchText: '',
    };
    node.volatility = phaseVolatility(node.phase);
    node.searchText = normalizeText([
      node.id, node.code, node.idKey, node.label, node.family, node.subfamily,
      node.phase, node.role, ...node.synonyms, ...node.materials,
    ].join(' '));
    node.semanticVector = semanticVector(node.searchText, node.family, node.subfamily);
    node.crystal = buildOlfemaCrystal(node, item);
    nodes.push(node);
    byId.set(id, node);
    if (code) byCode.set(code, node);
    if (idKey) byIdKey.set(idKey, node);
  }

  const resolve = (key) => byId.get(key) || byCode.get(key) || byIdKey.get(key) || null;
  const relations = [];
  for (const rel of rawRelations) {
    const source = resolve(rel.source || rel.origen);
    const target = resolve(rel.target || rel.destino);
    if (!source || !target) continue;
    relations.push({
      id: rel.id || rel.relacion || `${source.id}--${target.id}`,
      source: source.id,
      target: target.id,
      predicate: rel.predicate || rel.predicado || 'related_to',
      confidence: coerceNumber(rel.confidence ?? rel.confianza, 0.5),
      uncertainty: coerceNumber(rel.uncertainty ?? rel.incertidumbre, 0.25),
      weight: coerceNumber(rel.weight ?? rel.peso, 1),
      polarity: rel.polarity ?? rel.polaridad,
      phase: rel.phase || rel.fase || '',
      rationale: rel.rationale || rel.racional_comentario || '',
      raw: cloneJson(rel),
    });
  }

  return {
    nodes,
    relations,
    rawOlfemas: rawOlfemas.map(cloneJson),
    rawRelations: rawRelations.map(cloneJson),
    meta: {
      dataset: raw?.dataset || raw?.schema || 'Olfaria',
      version: raw?.version || raw?.source_version || '',
      families: [...new Set(nodes.map((node) => node.family))].sort(),
      phases: [...new Set(nodes.map((node) => node.phase))].sort(),
      predicates: [...new Set(relations.map((relation) => relation.predicate))].sort(),
    },
  };
}

function buildOlfemaCrystal(node, raw) {
  const rawCrystal = raw?.crystal || raw?.cristal_olfema;
  if (rawCrystal?.axes && rawCrystal?.core) return rawCrystal;
  const axisSeed = {
    matter: [...node.materials, node.subfamily, node.family],
    sensation: descriptorsForSensation(node),
    hedonic: descriptorsForHedonic(node),
    phase: [node.phase, raw?.fase || raw?.typical_phase, volatilityLabel(node.volatility)],
    context: [...node.synonyms.slice(0, 3), contextLabel(node)],
    associations: [node.label, node.role, node.code, node.idKey],
  };
  const axes = {};
  CRYSTAL_AXES.forEach((axis, axisIndex) => {
    const values = uniqueStrings(axisSeed[axis]).slice(0, 4);
    axes[axis] = values.map((label, itemIndex) => {
      const base = seededUnit(`${node.id}:${axis}:${label}:${itemIndex}`);
      return {
        label,
        weight: clamp(0.32 + base * 0.58 + node.intensity * 0.12, 0.18, 1),
        polarity: clamp(node.hedonicPolarity * 0.72 + seededSigned(`${label}:polarity`) * 0.28, -1, 1),
        volatility: clamp(node.volatility * 0.78 + seededUnit(`${axis}:vol:${node.id}`) * 0.22, 0, 1),
      };
    });
    if (!axes[axis].length) {
      axes[axis].push({
        label: fallbackAxisLabel(axis, node),
        weight: clamp(0.38 + node.intensity * 0.4 + axisIndex * 0.015, 0.2, 0.92),
        polarity: node.hedonicPolarity,
        volatility: node.volatility,
      });
    }
  });
  const branchCount = Object.values(axes).reduce((sum, items) => sum + items.length, 0);
  const variance = Math.abs(seededSigned(`${node.id}:variance`));
  const tension = clamp(Math.abs(node.hedonicPolarity) * 0.34 + (1 - node.volatility) * 0.22 + variance * 0.32, 0, 1);
  return {
    id: node.id,
    label: node.label,
    family: node.family,
    core: {
      polarity_mean: node.hedonicPolarity,
      volatility_score: node.volatility,
      intensity: node.intensity,
      phase_main: node.phase,
    },
    axes,
    relations: [],
    crystal_metrics: {
      symmetry: clamp(1 - variance * 0.42 - Math.abs(node.hedonicPolarity) * 0.08, 0.32, 0.96),
      branch_density: clamp(branchCount / 22, 0.12, 1),
      context_variance: variance,
      semantic_tension: tension,
      purity: clamp(1 - tension * 0.62 + node.intensity * 0.18, 0.18, 0.98),
    },
  };
}

function descriptorsForSensation(node) {
  const values = [];
  if (node.volatility > 0.72) values.push('brillante', 'aereo');
  if (node.volatility < 0.32) values.push('denso', 'persistente');
  if (node.intensity > 0.55) values.push('saturado');
  if (node.hedonicPolarity < -0.22) values.push('disonante');
  if (node.hedonicPolarity > 0.22) values.push('luminoso');
  values.push(node.subfamily || node.family);
  return values;
}

function descriptorsForHedonic(node) {
  if (node.hedonicPolarity < -0.25) return ['aspero', 'tenso', 'oscuro'];
  if (node.hedonicPolarity > 0.25) return ['limpio', 'atractivo', 'claro'];
  return ['ambiguo', 'tecnico', 'neutro'];
}

function contextLabel(node) {
  if (node.role === 'riesgo') return 'alerta formulativa';
  if (node.role === 'criterio') return 'criterio tecnico';
  if (node.role === 'contexto') return 'marco narrativo';
  return 'acorde olfativo';
}

function volatilityLabel(value) {
  if (value > 0.7) return 'salida volatil';
  if (value < 0.32) return 'fondo persistente';
  return 'corazon estable';
}

function fallbackAxisLabel(axis, node) {
  const labels = {
    matter: node.family,
    sensation: node.subfamily || 'sensacion base',
    hedonic: descriptorsForHedonic(node)[0],
    phase: node.phase,
    context: contextLabel(node),
    associations: node.label,
  };
  return labels[axis] || node.label;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
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

function inferRole(item) {
  const family = item.familia || item.family || '';
  const id = item.id_key || item.id || '';
  if (family === 'defect' || String(id).includes('risk')) return 'riesgo';
  if (['regulatory', 'stability', 'performance'].includes(family)) return 'criterio';
  if (['intention', 'emotional', 'cultural', 'season', 'time'].includes(family)) return 'contexto';
  return 'olfema';
}

function phaseVolatility(phase) {
  const map = {
    head: 0.92,
    heart: 0.58,
    base: 0.22,
    transition: 0.48,
    ambient: 0.42,
    defect: 0.62,
    global: 0.5,
  };
  return map[String(phase || '').toLowerCase()] ?? 0.45;
}

function semanticVector(text, family, subfamily) {
  const dims = new Array(8).fill(0);
  const tokens = normalizeText(`${text} ${family} ${subfamily}`).split(/[^a-z0-9_]+/).filter(Boolean);
  for (const token of tokens) {
    let h = 2166136261;
    for (const ch of token) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    for (let i = 0; i < dims.length; i += 1) {
      const bit = ((h >>> (i * 3)) & 7) / 3.5 - 1;
      dims[i] += bit;
    }
  }
  const len = Math.hypot(...dims) || 1;
  return dims.map((value) => value / len);
}
