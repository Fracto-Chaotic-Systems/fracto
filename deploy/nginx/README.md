# nginx examples

`fracto.conf.example` is the public TLS proxy; `fracto-lab.conf.example` is the
private lab HTTP profile. Install header snippets as instructed in ../README.md.
The AI proxy exposes health/status only. Inference and peer-operation namespaces
are blocked, including case variants. Local inference stays on its machine-only
HTTP API; enrolled peers connect directly to the separate mutual-TLS listener
(3447 production, 3547 development). Do not route peer TLS through these examples
or inherit browser bypass. See the AI repository peers/README.md for enrollment.
