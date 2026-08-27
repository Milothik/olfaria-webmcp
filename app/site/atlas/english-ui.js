(function applyOlfariaEnglishUi() {
  'use strict';

  document.documentElement.lang = 'en';

  const exact = new Map(Object.entries({
    'Del aroma al conocimiento': 'From aroma to knowledge',
    'Describe una escena, acorde o memoria olfativa': 'Describe a scene, accord, or scent memory',
    'Activar campo': 'Activate field',
    'Corpus olfativo v4': 'Olfactory corpus v4',
    'Relaciones JSON': 'JSON relationships',
    'El aroma como materia viva': 'Aroma as living matter',
    'Un atlas de resonancia donde cada olfema revela su forma, sus afinidades y su distancia.': 'A resonance atlas where every olfeme reveals its shape, affinities, and distance.',
    'Lectura de sesion': 'Session reading',
    'Lectura de sesión': 'Session reading',
    'cargando corpus': 'loading corpus',
    'nodos': 'nodes',
    'aristas': 'edges',
    'grado medio': 'average degree',
    'activos': 'active',
    'Sin sesion activa.': 'No active session.',
    'Sin sesión activa.': 'No active session.',
    'Proceso': 'Process',
    'Activa una sesion para observar la cristalizacion del campo.': 'Activate a session to watch the field crystallize.',
    'Activa una sesión para observar la cristalización del campo.': 'Activate a session to watch the field crystallize.',
    'Cristal seleccionado': 'Selected crystal',
    'Selecciona una morula para revelar su cristal volumetrico.': 'Select a morula to reveal its volumetric crystal.',
    'Selecciona una mórula para revelar su cristal volumétrico.': 'Select a morula to reveal its volumetric crystal.',
    'Campo en reposo': 'Field at rest',
    'Morulas en standby': 'Morulas on standby',
    'Mórulas en standby': 'Morulas on standby',
    'Activa una descripcion para observar la cristalizacion.': 'Activate a description to watch crystallization.',
    'Activa una descripción para observar la cristalización.': 'Activate a description to watch crystallization.',
    'reposo': 'rest',
    'activo': 'active',
    'resonancia': 'resonance',
    'Exploracion': 'Exploration',
    'Exploración': 'Exploration',
    'crystal JSON': 'JSON crystal',
    'Cristales visibles': 'Visible crystals',
    'todos': 'all',
    'Modo': 'Mode',
    'relaciones JSON': 'JSON relationships',
    'Profundidad': 'Depth',
    'Confianza minima': 'Minimum confidence',
    'Confianza mínima': 'Minimum confidence',
    'Grado maximo': 'Maximum degree',
    'Grado máximo': 'Maximum degree',
    'sin limite': 'unlimited',
    'sin límite': 'unlimited',
    'Polaridad': 'Polarity',
    'todas': 'all',
    'Familias activas': 'Active families',
    'Relaciones visibles': 'Visible relationships',
    'Campo visible': 'Visible field',
    'Fluido': 'Fluid',
    'Corpus completo': 'Full corpus',
    'Nodos sin ruta': 'Nodes without a path',
    'Todas': 'All',
    'Positivas': 'Positive',
    'Neutrales': 'Neutral',
    'Creativas': 'Creative',
    'Negativas': 'Negative',
    'Riesgo': 'Risk',
    'Visibles': 'Visible',
    'Atenuados': 'Faded',
    'Ocultos': 'Hidden',
    'Lado opuesto': 'Opposite side',
    'Reiniciar': 'Reset',
    'Centrar': 'Center',
    'Copiar datos': 'Copy data',
    'Contrato del corpus': 'Corpus contract',
    'Comprobando integridad...': 'Checking integrity...',
    'La publicacion no sintetiza relaciones ausentes.': 'The publication does not synthesize missing relationships.',
    'La publicación no sintetiza relaciones ausentes.': 'The publication does not synthesize missing relationships.',
    'SHA-256 pendiente': 'SHA-256 pending',
    'Selecciona un nodo': 'Select a node',
    'Vecindario compositivo': 'Compositional neighborhood',
    'Selecciona un olfema para fijar su vecindario.': 'Select an olfeme to pin its neighborhood.',
    'Preparando atlas...': 'Preparing Atlas...',
    'Lectura sin coincidencias': 'No matches found',
    'El campo sigue en reposo': 'The field remains at rest',
    'Prueba con descriptores mas concretos del corpus.': 'Try more specific corpus descriptors.',
    'Polaridad general': 'Overall polarity',
    'Luminosa y positiva': 'Bright and positive',
    'Oscura y contrastada': 'Dark and contrasting',
    'Equilibrada y ambivalente': 'Balanced and ambivalent',
    'Fases del grafo': 'Graph phases',
    'Sin fase dominante': 'No dominant phase',
    'Las fases ordenan la evolucion temporal del acorde.': 'Phases organize the accord over time.',
    'Resonancia': 'Resonance',
    'sin enlace directo': 'no direct link',
    'Proceso de combinacion': 'Combination process',
    'Sin union directa': 'No direct connection',
    'Los activos quedan aislados porque no hay relacion de sesion suficiente.': 'Active olfemes remain isolated because there is no sufficient session relationship.',
  }));

  const attributes = new Map(Object.entries({
    'Bergamota helada, jazmin cremoso y cedro lapiz...': 'Iced bergamot, creamy jasmine, and pencil cedar...',
    'Limpiar sesion': 'Clear session',
    'Limpiar sesión': 'Clear session',
    'Estado del atlas': 'Atlas status',
    'Lectura olfativa': 'Olfactory reading',
    'Campo esferico de olfemas y relaciones': 'Spherical field of olfemes and relationships',
    'Campo esférico de olfemas y relaciones': 'Spherical field of olfemes and relationships',
    'Densidad del atlas': 'Atlas density',
    'Inspector de olfema': 'Olfeme inspector',
    'Cerrar inspector': 'Close inspector',
    'Cerrar': 'Close',
  }));

  function translateDynamic(value) {
    return value
      .replace(/\b(\d[\d.,]*) olfemas\b/gi, '$1 olfemes')
      .replace(/\b(\d[\d.,]*) relaciones activas\b/gi, '$1 active relationships')
      .replace(/\b(\d[\d.,]*) relaciones cargadas\b/gi, '$1 relationships loaded')
      .replace(/\b(\d[\d.,]*) relaciones\b/gi, '$1 relationships')
      .replace(/\b(\d[\d.,]*) cristales en resonancia\b/gi, '$1 crystals in resonance')
      .replace(/\b(\d[\d.,]*) morulas en standby\b/gi, '$1 morulas on standby')
      .replace(/\b(\d[\d.,]*) uniones de sesion\b/gi, '$1 session links')
      .replace(/\b(\d[\d.,]*) aristas\b/gi, '$1 edges')
      .replace(/\b(\d[\d.,]*) olfemas activos en la sesion\./gi, '$1 active olfemes in the session.')
      .replace(/\b(\d[\d.,]*) olfemas y (\d[\d.,]*) relaciones visibles\./gi, '$1 olfemes and $2 visible relationships.')
      .replace(/\b(\d[\d.,]*) olfemas visibles para mantener fluidez\./gi, '$1 visible olfemes for smooth performance.')
      .replace(/\b(\d[\d.,]*) olfemas activados\b/gi, '$1 activated olfemes')
      .replace(/\b(\d[\d.,]*) uniones internas\b/gi, '$1 internal links')
      .replace(/\b(\d[\d.,]*) olfemas no activos ocultos\b/gi, '$1 hidden inactive olfemes')
      .replace(/\bFamilias dominantes:/gi, 'Dominant families:')
      .replace(/\bsin coincidencias directas\b/gi, 'no direct matches')
      .replace(/\bFases:/gi, 'Phases:')
      .replace(/\bsin fase dominante\b/gi, 'no dominant phase')
      .replace(/\bRelacion:/gi, 'Relationship:')
      .replace(/\bMuestra principal:/gi, 'Main sample:')
      .replace(/\bsin olfemas detectados\b/gi, 'no olfemes detected')
      .replace(/\bIndice medio ([\d.-]+) en (\d+) olfemas activos\./gi, 'Average index $1 across $2 active olfemes.')
      .replace(/\b(\d+) conexiones\b/gi, '$1 connections')
      .replace(/\bconfianza ([\d.-]+)\b/gi, 'confidence $1')
      .replace(/\bActiva una sesion para ver como se combinan los copos activos\./gi, 'Activate a session to see how active flakes combine.')
      .replace(/\b(\d+) activos · (\d+) uniones entre olfemas activados\b/gi, '$1 active · $2 links between activated olfemes')
      .replace(/\bCorpus completo:/gi, 'Full corpus:')
      .replace(/\bVista fluida restaurada\./gi, 'Fluid view restored.')
      .replace(/\bCrystal Neural Erdos listo para explorar\./gi, 'Crystal Neural Erdos ready to explore.')
      .replace(/\bPreparando cristales\.\.\./gi, 'Preparing crystals...')
      .replace(/\bNo se pudo cargar el atlas:/gi, 'The Atlas could not be loaded:')
      .replace(/\bLa fuente contiene\b/gi, 'The source contains')
      .replace(/\brelaciones menos que las\b/gi, 'fewer relationships than the')
      .replace(/\bsolicitadas; no se sintetizan\./gi, 'requested; none are synthesized.');
  }

  function translateTextNode(node) {
    const raw = node.nodeValue || '';
    const trimmed = raw.trim();
    if (!trimmed) return;
    const translated = exact.get(trimmed) || translateDynamic(trimmed);
    if (translated !== trimmed) node.nodeValue = raw.replace(trimmed, translated);
  }

  function translateElement(element) {
    ['placeholder', 'aria-label', 'title'].forEach((name) => {
      const value = element.getAttribute?.(name);
      if (!value) return;
      const translated = attributes.get(value) || exact.get(value) || translateDynamic(value);
      if (translated !== value) element.setAttribute(name, translated);
    });
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) translateTextNode(current);
  }

  const start = () => {
    translateElement(document.body);
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
          if (node.nodeType === Node.ELEMENT_NODE) translateElement(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
