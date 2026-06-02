# Composio Tool Dependency Graph

A static-analysis pipeline that builds and visualizes the dependency graph of an agentic tool catalog. Given a set of tools exposed through [Composio](https://composio.dev), the system determines which tools must be executed before others to obtain required parameters (e.g. `GMAIL_REPLY_TO_THREAD` requires a `thread_id` that `GMAIL_LIST_THREADS` produces) and renders the result as an interactive directed acyclic graph.

The current build analyzes **658 tools** across the `googlesuper` (Gmail, Calendar, Drive, Sheets, Docs, Slides, Contacts, Tasks, Meet, Forms, YouTube) and `github` (Repos, Issues, Pull Requests, Releases, Actions, Security, …) toolkits and produces **1,874 ranked dependency edges** spanning 15 categories.

---

## Why this exists

When an LLM agent plans a multi-step action it needs to know:

1. whether the user has already supplied enough information to execute a tool, or
2. which other tool must be called first to obtain a missing parameter.

Hand-curating this dependency map across hundreds of tools does not scale. This project produces it programmatically and exposes it as machine-readable JSON (`data/graph.json`) and a human-readable visualization (`output/dependency-graph.html`).

---

## Pipeline

```
        ┌───────────────────┐
        │ 1. fetch-tools.ts │  Composio SDK → raw tool schemas (cached)
        └─────────┬─────────┘
                  ▼
        ┌───────────────────┐
        │ 2. analyze.ts     │  Heuristic + LLM dependency inference
        └─────────┬─────────┘
                  ▼
        ┌───────────────────┐
        │ 3. build-graph.ts │  Edge merging, cycle breaking → DAG
        └─────────┬─────────┘
                  ▼
        ┌───────────────────┐
        │ 4. visualize.ts   │  Self-contained interactive D3 HTML
        └───────────────────┘
```

### 1. Tool ingestion (`src/fetch-tools.ts`)

Fetches all `googlesuper` and `github` raw tool schemas (slug, description, input/output JSON Schema, required params) from the Composio platform. Responses are cached to `data/<toolkit>_tools.json` so re-runs don't re-hit the API.

### 2. Dependency analysis (`src/analyze.ts`)

Two-pass hybrid:

- **Phase A — Heuristic matching.** Parses parameter descriptions for explicit tool references (e.g. *"obtained from `GMAIL_LIST_THREADS`"*) and matches resource-typed parameter names (`thread_id`, `issue_number`, …) to known producer-action patterns. Cheap, high-precision.
- **Phase B — LLM semantic analysis.** Tools are bucketed into sub-services (Gmail, Calendar, Issues, Pull Requests, …) and sent to `google/gemini-2.5-flash` via OpenRouter with a strict JSON-only schema. Cross-category passes are also run (Contacts → Gmail, Drive → Sheets, Issues → PRs, etc.) to catch interactions the per-bucket pass would miss.
- **Phase C — Merge & rank.** Edges are deduplicated by `(source → target : parameter)`. Confidence is boosted when both signals agree. For each `(target, parameter)` group, providers are ranked so the consumer knows the best tool to call first.
- **Phase D — Cycle breaking.** DFS-based cycle detection removes the lowest-confidence edge in every cycle so the final graph is a valid DAG.

Final edges are persisted to `data/dependency_edges.json` and the assembled graph to `data/graph.json`.

### 3. Visualization (`src/visualize.ts`)

A single self-contained HTML file (`output/dependency-graph.html`) that bundles the graph and renders it with D3 force-directed layout. Features:

- Search, toolkit filter, category filter, legend filter.
- Node color encodes sub-service; node size encodes connection degree.
- Click a node to highlight its first-degree neighborhood; double-click to recenter.
- Edge tooltips show parameter, confidence, provider rank, and inferred reason.
- Zoom, pan, drag-to-rearrange. Auto-fit on load.

---

## Quick start

Requires [Bun](https://bun.sh) ≥ 1.0.

```bash
# 1. Get keys
COMPOSIO_API_KEY=<your_key> sh scaffold.sh   # writes .env with COMPOSIO_API_KEY + OPENROUTER_API_KEY

# 2. Install + run
bun install
bun run src/index.ts

# 3. View
open output/dependency-graph.html
```

The first run takes a few minutes (tool fetch + LLM passes). Subsequent runs use the JSON caches in `data/` and complete in seconds. Delete the relevant cache file to force a refresh.

---

## Project layout

```
dep-graph/
├── src/
│   ├── index.ts          orchestrator
│   ├── fetch-tools.ts    Composio ingestion + cache
│   ├── analyze.ts        heuristic + LLM dependency analysis
│   ├── build-graph.ts    edge merge, cycle-break, graph assembly
│   └── visualize.ts      D3 visualization generator
├── data/                 cached tool catalogs + computed graph
├── output/               generated HTML visualization
└── scaffold.sh           one-shot key bootstrap
```

---

## Configuration

| Variable             | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `COMPOSIO_API_KEY`   | Authenticates to the Composio platform tool catalog.   |
| `OPENROUTER_API_KEY` | LLM access for Phase B semantic dependency inference.  |

Both are written to `.env` by `scaffold.sh`. `.env` is gitignored.

---

## Extending

- **Additional toolkits.** Add another `fetchToolkit(composio, "<slug>")` call in `src/fetch-tools.ts`. Add the toolkit's sub-service keyword map to `analyze.ts` for clean categorization.
- **Different LLM.** Swap the model identifier in `callOpenRouter()` (`src/analyze.ts`). Any OpenRouter-routed model that returns clean JSON works.
- **Alternative visualization.** `data/graph.json` is plain JSON (`nodes`, `edges`, `categories`) — import it into Cytoscape, Gephi, or a custom renderer.

---

## Known limitations

- Heuristic patterns target Composio's naming conventions; toolkits with very different slug grammars may need new resource maps in `analyze.ts`.
- LLM dependency inference is bounded by category-batch context windows; very large categories are chunked, which can miss cross-chunk edges within the same category.
- Cycle breaking is greedy (lowest-confidence-first), not optimal — it minimizes per-step damage, not total edge weight removed.

---

## License

MIT
