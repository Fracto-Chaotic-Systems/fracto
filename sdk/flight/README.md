# flight

Pure bounded flight tile-cache behavior. Import `@fracto/sdk/flight/TileCache.js`. The UI owns scheduling/presentation and the tiles service owns tile endpoints.

Level-3 root tiles load on demand, then stay resident until `clear()`,
`destroy()` or a source change. They are never LRU victims, so any plane point
keeps a coarse fallback while deeper tiles load or are evicted. The 32 roots sit
outside `max_tiles`/`max_bytes`; those budgets (default 96 tiles/96 MiB) bound
the deeper tiles, for at most 128 decoded tiles in total. `get_stats().resident`
counts the roots held; `tiles` and `bytes` include them.
