# Repository milestone tags

Fracto is maintained as a root repository plus independent service
repositories. A coordinated milestone is represented by an annotated Git tag
with the same name in every repository:

```text
milestone/<feature>-v<major>
```

For example, `milestone/video-pipeline-v1` identifies the first supported
video-rendering pipeline snapshot. The tag name is intentionally feature-based
rather than date-based; the annotated tag message records the date and the
purpose of the snapshot.

## Rules

- Create milestone tags only from clean working trees on the intended branch.
- Apply the same tag name to the root repository and every service repository,
  even when a service has no feature-specific code change. This records the
  compatible repository state used by the milestone.
- Tags are immutable. If a milestone must be corrected, increment the major
  tag version (for example, `v2`) instead of moving or deleting an existing
  tag.
- Use annotated tags, not lightweight tags, so the tag carries an auditable
  message.
- Push tags explicitly when publishing a milestone; normal branch pushes do
  not necessarily publish tags.

The guarded helper `scripts/tag_milestone.ps1` checks that all repositories are
clean, creates the annotated tag in each repository, and stops before making
any tag if one repository is dirty or already contains that tag.

To publish a local milestone tag to each configured remote:

```powershell
./scripts/tag_milestone.ps1 -Name "milestone/video-pipeline-v1" -Message "Video rendering pipeline v1"
git push origin milestone/video-pipeline-v1
git -C servers/fracto-ui push origin milestone/video-pipeline-v1
```
