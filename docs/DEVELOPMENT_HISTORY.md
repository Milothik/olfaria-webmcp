# Hackathon development history

The Crystal Neural Atlas and Olfaria corpus pre-date the OpenAI WebMCP Challenge. They provide the existing visual and scientific foundation.

The following work was added during the challenge period beginning August 25, 2026:

- A narrow `window.OlfariaAtlasApi` controller that lets an agent focus existing Atlas nodes without replacing the renderer.
- Five typed tools registered through `document.modelContext.registerTool`.
- Bounded deterministic API operations for search, relationship lookup, comparison and path finding.
- Clear separation between stored corpus evidence, deterministic technical inference and visual-only state.
- Graceful degradation when WebMCP is unavailable.
- Authenticated production access with signed browser sessions.
- Subpath-safe deployment for `/webmcpolfaria/`.
- An English human-agent demonstration and contest documentation.

The project commit history supplies dated evidence for these additions. Pre-existing Atlas code is retained because the challenge explicitly allows meaningful WebMCP extensions to an existing application; judging should focus on the human-agent workflow and WebMCP layer described above.
