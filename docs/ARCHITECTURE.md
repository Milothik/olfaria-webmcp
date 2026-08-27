# Architecture

```text
Crystal Neural Atlas
  ├─ existing Three.js renderer and session state
  ├─ narrow visual bridge: window.OlfariaAtlasApi
  └─ WebMCP adapter: five site tools
       ├─ four bounded read operations → FastAPI graph service
       └─ focus_nodes → existing Atlas session controller

External corpus file → immutable loader → deterministic indexes
```

The WebMCP adapter owns no sensory or graph logic. Read operations delegate to
the deterministic service. `focus_nodes` delegates to the existing Atlas
controller and has no persistent side effect.

## Trust boundaries

- The corpus is loaded from a file outside the public repository in private
  deployments.
- Tool inputs are bounded and reject additional properties.
- The public sample contains only synthetic `DEMO` records.
- The four graph tools are read-only.
- The visual tool never modifies corpus data.
- No local language model or external AI service is required by the runtime.
