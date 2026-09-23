# SDK release workflow

The SDK uses semantic versions. Increment the version according to the public
API change:

- patch: bug fixes without an API change
- minor: backward-compatible exports or behavior
- major: removed or incompatible APIs

Run the checks without changing the version:

```powershell
npm run sdk:release -- check
```

Create a new version after deciding the release number:

```powershell
npm run sdk:release -- version 1.1.0
```

The release command validates all four service consumers and runs the SDK
tests before changing `sdk/package.json`. It does not commit, tag, push, or
rewrite service history.

After a successful version update:

1. Review and commit the root SDK package change.
2. Run `npm install --package-lock-only --ignore-scripts --prefix` for each
   SDK consumer if the lockfiles need refreshing.
3. Commit the import, dependency, and lockfile changes in each service.
4. Run `npm run sdk:release -- check` again.
5. Tag the coordinated repository commits with the project's normal milestone
   tagging workflow and push only after every repository is clean and tested.

Production builds should use the committed package version and lockfiles. Do
not replace the local dependency with an unconstrained `latest` version.
