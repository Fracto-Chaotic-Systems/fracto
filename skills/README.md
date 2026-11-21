# Reusable modeling skills

`mechanical-3d-modeling/` is the versioned source of the personal Codex skill
developed alongside the animated Game Play CRT. Its `SKILL.md` routes to focused
mechanism, material and browser-integration guidance. Portable assets include
two-link inverse kinematics, reusable cable buffers and procedural aged materials.

The personal installed copy lives under the user's Codex skills directory;
changes to this source do not automatically update that copy. Install or update
the complete skill folder there when requested, preserving any existing local
changes. Invoke the installed skill with `$mechanical-3d-modeling`.

Run the portable checks against the UI's existing Three.js installation:

```text
node skills/mechanical-3d-modeling/scripts/verify-mechanics.mjs --project-root servers/fracto-ui
```

The skill creator's `quick_validate.py` validates skill metadata and structure.
It needs PyYAML in its Python environment; that validation dependency is not part
of this repository or the installed modeling skill.
