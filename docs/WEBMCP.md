# WebMCP contract

| Tool | Purpose | Side effect |
|---|---|---|
| `search_olfemas` | Find matching olfemes through bounded deterministic search | None |
| `get_relations` | Read recorded relationships for one olfeme | None |
| `compare_olfemas` | Compare two corpus records | None |
| `find_path` | Traverse existing graph relationships with bounded depth | None |
| `focus_nodes` | Highlight returned identifiers in the live Atlas | Visual only |

The page checks for `document.modelContext.registerTool`. When WebMCP is not
available, registration is skipped and the Atlas remains fully usable.

The public repository demonstrates the software contract with synthetic data.
Private deployments inject their corpus at runtime through
`OLFARIA_DATA_FILE`; the data file is never required in Git history.
