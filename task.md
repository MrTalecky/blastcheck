---
goal: Maintain the blastcheck CLI — the installer-first audit tool for AI coding-agent changes
allow:
  - "src/**"
  - "tests/**"
  - "README.md"
  - "action.yml"
  - "package.json"
  - "tsconfig.json"
  - "tsconfig.test.json"
  - "tsup.config.ts"
  - "vitest.config.ts"
  - "biome.json"
  - ".github/**"
  - "docs/**"
  - "task.md"
---

# Task

Project-level contract for blastcheck's own dogfooded audits. The `allow`
frontmatter declares the in-scope paths for routine maintenance work so that
`scope-adhesion` has a real pre-commitment to measure against (rather than an
empty `allow`, which reports every change as out-of-scope).

This file is read from the **baseline commit** at audit time — see the
[Contract](README.md#contract) section of the README for how the three trust
sources (`task.md`, `.blastcheck.yml`, repo manifests) combine.

Narrow this `allow` list per-change when a task has a tighter scope.
