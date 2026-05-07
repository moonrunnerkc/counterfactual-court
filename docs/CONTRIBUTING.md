# Contributing

This repo is built under tight contest deadlines. The rules below are not aspirational.

## Branching

Feature branches off `main`. No personal-namespace branches.

| Prefix   | Use for                      |
| -------- | ---------------------------- |
| `feat/`  | new feature or capability    |
| `fix/`   | bug fix                      |
| `chore/` | tooling, deps, repo plumbing |
| `docs/`  | documentation only           |

Examples: `feat/precedent-ledger`, `fix/jury-context-overflow`, `chore/pin-ollama-version`, `docs/prior-art-update`.

## Commits

[Conventional commits](https://www.conventionalcommits.org/). Subject under 72 characters, imperative mood. The body explains _why_, not what.

When fixing a verdict regression, reference the bundle hash in the body so the failing case is reproducible from `git log` alone:

```
fix(jury): respect 128k token budget when repo snapshot is large

Repro: bundle 7a3f...
```

## Pull requests

Every PR must pass `pnpm check` and `pnpm test` locally before opening. CI runs the same plus integration tests. **A flaky integration test is a determinism bug, not a test bug.** Don't retry-loop until green.

PR description should answer:

1. What changed.
2. Why it had to change now (not later).
3. Whether replay was affected. If yes, link to the variance entry in `docs/runtime-variance.md`.

## Code style

See [`STYLE_GUIDE.md`](./STYLE_GUIDE.md). Highlights:

- Named exports only. No `export default`.
- Kebab-case filenames.
- No `any`. Use `unknown` and narrow.
- 300-line cap per file.
- Full JSDoc on every exported function.
- No em dashes.
- Errors include both what failed and what to do about it.

## Review

Bundles in `bundles/` are conceptually append-only. Never modify a signed bundle; if a verdict is wrong, write a successor that links to and supersedes it. The directory is gitignored, but the rule still binds artifacts the team passes around.
