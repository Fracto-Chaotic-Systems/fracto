# Workflows

`validate.yml` checks out the root and six service repositories, installs the
dependencies for all seven consumers, and runs the strict dependency gate,
root validation, UI/data survey and numerical contract regressions, and AI
standalone checks on Node 22. Service checkouts follow their default branches, matching Fracto's
coordinated-repository development model. Publish compatible service changes
before publishing root integration changes.

Public service repositories use the normal checkout token. If service repositories
are private, configure `FRACTO_SERVICES_READ_TOKEN` with read access to those
repositories; the workflow uses it only for service checkouts and does not persist
their credentials. No database or model secrets are required for these checks.
