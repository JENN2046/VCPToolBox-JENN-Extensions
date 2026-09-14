# Optional no-RAG stdio compatibility entrypoint

`stdio-entrypoint.cjs` is an explicitly invoked adapter for synthetic/offline
use. It does not replace `AIGentPrompt.js`, register a tool, or change
`plugin-manifest.json`, its RAG-enabled default, or the existing README.
The legacy entrypoint and its RAG integration remain separate contracts.

The adapter accepts one UTF-8 JSON request on stdin and writes one JSON line
to stdout. A valid request is processed at EOF. Input larger than 16 KiB is
rejected with `INPUT_TOO_LARGE`; it is never truncated into an accepted
prefix. Empty, malformed, and rejected requests retain their error responses.

Supported adapter actions:

- `HealthCheck` reports this adapter's no-RAG capabilities; it does not check
  service health or change the plugin's advertised actions.
- `GenerateImagePrompt` uses the existing prompt-composition module without
  injected retrieval managers. Similar prompts remain empty. The requested
  quality is reported, but quality parity remains `KNOWN_GAP`.
- `SearchPromptTemplates` returns `RAG_DISABLED`.

A truthy `AIGENT_RAG_ENABLED` value returns `RAG_GATE_REQUIRED`; this adapter
cannot opt into RAG. Do not treat its output as evidence of retrieval,
provider, plugin activation, or legacy-default compatibility.

Run the regression from the repository root with Node.js 22:

```sh
node --test tests/aigent-prompt-compat.test.cjs
```

The tests retain the original 18 tests and add nine real-stdio
cases with synthetic input. The child-process read allowance is derived
from the test's repository location, without a fixed sandbox root.
