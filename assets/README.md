# Fracto assets

The existing `img*.png` files are application image assets.
`environments/` is the reusable environment library. Its catalog and README
describe source preservation, attribution, runtime models, and variants.
The root `.gitattributes` disables text conversion and text diffs for imported
`environments/**/source/**` files, preserving original bytes and source checksums
across checkouts on Windows and Linux.
