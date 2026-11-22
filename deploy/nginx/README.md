# nginx examples

The explicit `/api/environment-catalog` location preserves the Assets inventory
URL through the UI-owned transport proxy; the asset service owns the application
route and calls the data service for SQL persistence. The former unknown-API
fallback would reject this URL. Folder bodies are bounded at 128 MiB and forwarded
without request buffering, with a 180-second read timeout for Blender conversion.
Install/test the updated example when deploying this feature. These files are
examples; editing them does not reload a live nginx server.

`fracto.conf.example` is the public TLS proxy; `fracto-lab.conf.example` is the
private lab HTTP profile. Install header snippets as instructed in ../README.md.
The AI proxy exposes health/status only. Inference and peer-operation namespaces
are blocked, including case variants. Local inference stays on its machine-only
HTTP API; enrolled peers connect directly to the separate mutual-TLS listener
(3447 production, 3547 development). Do not route peer TLS through these examples
or inherit browser bypass. See the AI repository peers/README.md for enrollment.

Administrator chat uses `/api/admin/chat`; the protected bridge reaches the local
AI service internally. Streaming responses set `X-Accel-Buffering: no`, and the
examples' existing 600-second proxy timeouts exceed the chat's server deadlines.
The direct `/api/ai/inference` namespace remains blocked.

Instrument export uses a narrower `/api/admin/instrument-transfer/` location
with a 512 MiB per-request ceiling and request/response buffering disabled.
It preserves `/instrument-transfer/` when forwarding to admin. Backend controls
retain their smaller JSON limits; file PUTs stream with backpressure and their
own inactivity deadlines. Existing 600-second proxy timeouts allow normal status
and acknowledgement traffic. Install this location on both peers when their
configured endpoints use nginx, and test configuration before reloading it.
