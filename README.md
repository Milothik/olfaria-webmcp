# Olfaria Crystal Neural Atlas — WebMCP

Public technical demonstration of WebMCP integration in the existing Olfaria
Crystal Neural Atlas.

## Public contents

- Atlas interface and narrow visual controller.
- Five WebMCP tool definitions.
- Deterministic graph operations and FastAPI runtime.
- A five-node synthetic dataset for local testing.

## Private contents

The proprietary Olfaria corpus is not included in this repository or its Git
history. The sample uses `DEMO` identifiers and is not validated sensory data.

## WebMCP tools

`search_olfemas`, `get_relations`, `compare_olfemas`, `find_path`, and
`focus_nodes`. The first four are read-only. The last one changes only the
current visual state.

## Run the public sample

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python app\olfaria_api.py
```

Open `http://127.0.0.1:8000` in a browser with WebMCP support.

## Private corpus injection

Set `OLFARIA_DATA_FILE` to an external JSON file at runtime. Optionally set
`OLFARIA_EXPECTED_SHA256` to its expected hash. Keep the file outside Git.

The public sample proves the software contract only. It is not sensory
validation, regulatory advice, or canonical corpus promotion.

