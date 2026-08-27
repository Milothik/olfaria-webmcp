/* Olfaria WebMCP adapter.
 *
 * The adapter owns no scientific logic. Read tools call deterministic API
 * services and focus_nodes delegates to the Atlas' narrow visual API.
 */
(function registerOlfariaWebMcp() {
  'use strict';

  const TOOL_NAMES = [
    'search_olfemas',
    'get_relations',
    'compare_olfemas',
    'find_path',
    'focus_nodes',
  ];

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({
      detail: { code: 'invalid_response', message: 'The API returned a non-JSON response.' }
    }));
    if (!response.ok) {
      const detail = payload && payload.detail ? payload.detail : payload;
      const error = new Error(detail.message || `HTTP ${response.status}`);
      error.code = detail.code || 'api_error';
      error.status = response.status;
      error.details = detail;
      throw error;
    }
    return payload;
  }

  function postJson(url, body) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function waitForAtlas(timeoutMs = 10000) {
    const atlas = window.OlfariaAtlasApi;
    if (atlas && atlas.isReady()) return Promise.resolve(atlas);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('olfaria:ready', onReady);
        reject(new Error('atlas_not_ready'));
      }, timeoutMs);
      function onReady() {
        clearTimeout(timer);
        const current = window.OlfariaAtlasApi;
        if (current && current.isReady()) resolve(current);
        else reject(new Error('atlas_not_ready'));
      }
      window.addEventListener('olfaria:ready', onReady, { once: true });
    });
  }

  const definitions = [
    {
      name: 'search_olfemas',
      description: 'Search the immutable Olfaria corpus by label, synonyms, family, facet, code, or ingredients_materials. Does not modify data or the interface.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 120, description: 'Olfactory concept or identifier to search for.' },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: ({ query, limit = 8 }) => requestJson(
        `/api/webmcp/search?q=${encodeURIComponent(query)}&limit=${limit}`
      ),
    },
    {
      name: 'get_relations',
      description: 'Read existing relationships for an olfeme. Accepts codigo, id_key, or an exact unambiguous label. Does not create relationships.',
      inputSchema: {
        type: 'object',
        properties: {
          olfema: { type: 'string', minLength: 1, maxLength: 200, description: 'codigo, id_key, or exact olfeme label.' },
          depth: { type: 'integer', minimum: 1, maximum: 2, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 30 },
        },
        required: ['olfema'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: ({ olfema, depth = 1, limit = 30 }) => requestJson(
        `/api/webmcp/relations?olfema=${encodeURIComponent(olfema)}&depth=${depth}&limit=${limit}`
      ),
    },
    {
      name: 'compare_olfemas',
      description: 'Deterministically compare two existing olfemes and separate shared attributes, differences, and direct relationships. Does not claim sensory validation.',
      inputSchema: {
        type: 'object',
        properties: {
          first: { type: 'string', minLength: 1, maxLength: 200, description: 'codigo, id_key, or exact label of the first olfeme.' },
          second: { type: 'string', minLength: 1, maxLength: 200, description: 'codigo, id_key, or exact label of the second olfeme.' },
        },
        required: ['first', 'second'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: ({ first, second }) => postJson('/api/webmcp/compare', { first, second }),
    },
    {
      name: 'find_path',
      description: 'Reproducibly find an undirected path between two olfemes using only existing relationships and a bounded depth.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', minLength: 1, maxLength: 200, description: 'Source codigo, id_key, or exact label.' },
          target: { type: 'string', minLength: 1, maxLength: 200, description: 'Target codigo, id_key, or exact label.' },
          max_depth: { type: 'integer', minimum: 1, maximum: 6, default: 5 },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: ({ source, target, max_depth = 5 }) => postJson(
        '/api/webmcp/path', { source, target, max_depth }
      ),
    },
    {
      name: 'focus_nodes',
      description: 'Highlight existing olfemes in the visible Olfaria Atlas. Changes only the page visual state; never changes the corpus or persistent data.',
      inputSchema: {
        type: 'object',
        properties: {
          identifiers: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 200 },
            description: 'List of codigo or id_key values returned by the read tools.',
          },
          clear_existing: { type: 'boolean', default: true, description: 'When true, replace the previous visual focus.' },
        },
        required: ['identifiers'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      execute: async ({ identifiers, clear_existing = true }) => {
        const atlas = await waitForAtlas();
        const result = atlas.focusNodes(identifiers, { clearExisting: clear_existing });
        if (result.selected_count === 0) {
          return {
            ok: false,
            error: {
              code: 'olfema_not_found',
              message: 'None of the identifiers match a node in the Atlas.',
              identifiers: result.missing,
            },
            side_effect: 'none',
            corpus_modified: false,
          };
        }
        return {
          ok: true,
          ...result,
          side_effect: 'visual_only',
          corpus_modified: false,
        };
      },
    },
  ];

  async function register() {
    if (window.__olfariaWebMcpRegistered) return;
    if (typeof document.modelContext?.registerTool !== 'function') {
      console.info('[Olfaria WebMCP] Site tools are unavailable; the Atlas remains fully usable.');
      return;
    }
    const registeredNames = window.__olfariaWebMcpNames || new Set();
    window.__olfariaWebMcpNames = registeredNames;
    for (const definition of definitions) {
      if (registeredNames.has(definition.name)) continue;
      await document.modelContext.registerTool(definition);
      registeredNames.add(definition.name);
    }
    window.__olfariaWebMcpRegistered = true;
    console.info(`[Olfaria WebMCP] ${TOOL_NAMES.length} tools registered: ${TOOL_NAMES.join(', ')}`);
  }

  window.OlfariaWebMcp = Object.freeze({
    toolNames: TOOL_NAMES.slice(),
    definitions: definitions.slice(),
    register,
  });

  register().catch(error => {
    console.error('[Olfaria WebMCP] Tools could not be registered:', error);
  });
})();
