# Endpoint-based service test support

`ServiceFixture.js` launches a service-owned test executable using an explicit
`--serve-fixture` flag and a random private token. Readiness returns one loopback
URL. All test operations then use bounded JSON HTTP requests; fixture processes
never expose arbitrary module loading or function execution. Synchronous requests
support existing state assertions while the target runs in its own process.
`InstrumentClientFixture.js` implements the instrument fixture's explicit state,
restart, lookup and ownership-check contract. `InstrumentFixtures.js` generates
synthetic library files and catalogs in owned temporary directories.

Fixture controls are not production endpoints. Each owner declares its operation
allowlist in a CLI-only fixture; normal service entrypoints do not import these
executables. Cleanup closes only the child launched by the test. These tools
must never point at a production library, database or service token.

The control protocol uses `POST /__fixture/:operation`, `X-Fixture-Token` and
JSON limited to 8 MiB. Unknown operations return 404; bad tokens return 403;
operation errors return their bounded error code and status. Each owner defines
its explicit operation allowlist. Operations include instrument state/restart,
mesh state/lock conflicts, correction preview/approval/apply/rollback and auth
configuration. Chat and Newton fixtures expose their normal endpoint contracts.
Readiness is a single `@@fixture {"url":...}` stdout line; startup and requests
have 15-second bounds. Children close after the test and on parent exit.
