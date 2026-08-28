# Architecture and trust boundaries

## Design goals

- Preserve the existing Crystal Neural Atlas as the single visual implementation.
- Keep graph operations deterministic and reproducible.
- Expose a small, stable WebMCP surface rather than application internals.
- Require authentication before serving corpus APIs or registering tools in production.
- Keep private corpus data and deployment credentials outside the public repository.

## Component boundaries

### Authentication

The login page sends credentials to the authentication endpoint. Successful authentication creates a signed, time-bounded, `HttpOnly`, `SameSite=Strict` browser session. Protected pages and API routes reject unauthenticated requests. Production account hashes and session secrets are injected through deployment configuration.

The public source contains an explicit development-only account path. It requires the operator to choose a password through an environment variable and is rejected when the service binds to a public host.

### Corpus

The corpus loader validates schema-level invariants, constructs immutable indexes and reports the dataset digest. The production deployment loads its corpus from a controlled private file outside the public web root. The repository intentionally ships no local or synthetic dataset; evaluation uses the authenticated deployment and its private, versioned corpus.

### Graph service

Search, relationship lookup, comparison and path finding run through deterministic functions over immutable indexes. Inputs are bounded and reject unknown properties. The service does not call a language model and does not promote derived relations into the canonical corpus.

### Browser and WebMCP

The page registers five tools after the Atlas is available. Four tools are read-only graph queries. `focus_nodes` delegates to the existing Atlas visual controller and changes only current browser state. If WebMCP is unavailable, the Atlas continues to function as an ordinary web application.

## Stability and scalability

- Tool names and JSON schemas are the public integration contract.
- Corpus validation and indexing happen once per process rather than per request.
- Query and traversal limits bound latency and output size.
- Relative browser URLs allow deployment at `/` or a reverse-proxied subpath such as `/webmcpolfaria/`.
- Session-cookie scope is configurable through `OLFARIA_BASE_PATH`.
- Corpus release metadata supports scientific traceability by version, record count and SHA-256 digest.

## Deliberate exclusions

The repository excludes the proprietary corpus, synthetic test data, production account hashes, signing keys, environment files, dependency/bootstrap files, local run instructions, local test harnesses, raw capture material and provider-specific deployment archives.
