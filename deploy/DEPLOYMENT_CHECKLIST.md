# Deployment checklist

Everything that must be settled before a production deployment, collected in one
place as it is discovered. Add an item as soon as it is known; tick it when it is
done and verified (and remove a matching `deployment_todo` from its asset record).

Asset items are also recorded in the asset's `asset.json` as
`deployment_todo: [{ id, added, item }]`. List each one here as
`` `asset-id` · todo-id ``. `npm run deploy:checklist` reports open items and fails
when an asset record's item is missing here or ticked while still open.

## Assets

- [ ] `stone-pillar` · authentic-texture — generated placeholder stone texture; replace with an authentic, attributed texture.
- [ ] `stone-lintel` · authentic-texture — as above.
- [ ] `stone-wall-block-large` · authentic-texture — as above.
- [ ] `stone-wall-block-medium` · authentic-texture — as above.
- [ ] `stone-wall-block-small` · authentic-texture — as above.
- [ ] `stone-pillar` · license-decision — decide and record the license for the original generated stone set.
- [ ] `stone-lintel` · license-decision — as above.
- [ ] `stone-wall-block-large` · license-decision — as above.
- [ ] `stone-wall-block-medium` · license-decision — as above.
- [ ] `stone-wall-block-small` · license-decision — as above.
- [ ] `fire-torch` · attribution — creator, source and license of the imported pack are unresolved.
- [ ] `fire-torch` · scale-metadata — confirm the recorded scale (centimetres, 0.01 m/unit) against the original product.

## Code and compliance

- [ ] Authentication personal-information gap recorded in `AUTHENTICATION.md` is not fixed yet.
- [ ] Remote coverage-classification fallback in `sdk/FractoCoverageUtils.js` was due for review on 2026-10-04 (see its README).
