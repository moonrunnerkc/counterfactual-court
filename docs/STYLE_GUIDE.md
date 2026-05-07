# Style Guide

The Jury reads this file at deliberation time. Keep it terse, structured, and current. When a rule changes, update the file and the rationale in the same commit.

## Language and runtime

- TypeScript, strict mode, ES2022 target, ESM (`"type": "module"`). Node 20 or newer.
- Module resolution `NodeNext`. Imports of local files use the `.js` extension even though the source is `.ts` (NodeNext resolution requirement).

## Naming

- Filenames: kebab-case. Always. Enforced by `unicorn/filename-case` (see `eslint.config.js`).
- Exports: named only. **No** `export default`. Enforced by an ESLint rule.
- Types and interfaces: PascalCase. Functions and variables: camelCase. Constants exported from a module: SCREAMING_SNAKE_CASE only when the value is a literal that callers should treat as constant; otherwise camelCase.

## Types

- No `any`. Use `unknown` and narrow with type guards or zod parsing.
- Catch blocks must use `unknown` (`useUnknownInCatchVariables` is on); narrow before reading `.message`.
- Prefer readonly arrays and properties at API boundaries. `ReadonlyArray<T>` over `T[]` for inputs.

## File size

- 300 lines maximum per source file. When you reach the cap, decompose. **Never** append for convenience; long files mask determinism violations.

## JSDoc

- Every exported function, class, and interface gets a JSDoc block.
- Required tags: `@param` for each parameter, `@returns` for non-void returns, `@throws` when the function can throw.
- The first sentence states the purpose; further sentences explain non-obvious behavior or invariants. Omit narration of internals.

## Errors

Error messages state both what failed and what to do about it. Two-part structure: `<what failed>; <how to fix or what to check>`.

Good: `throw new Error('jury context exceeds 128k tokens (got 142k); reduce repo snapshot or split patch')`.

Bad: `throw new Error('context too large')`.

## Punctuation

- **No em dashes** anywhere: code, comments, docs, error messages, log lines. Use commas, colons, semicolons, parentheses, or two sentences.
- This rule exists because em dashes are a stylistic tell of unedited model output, and this repo's outputs are designed to look like deliberate human work.

## Formatting

- Prettier with `semi: true`, `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`. Configured in `.prettierrc.json`. Run `pnpm format` to apply.
- Semicolons-on chosen over semicolons-off because the codebase will eventually mix in shell-script generation and terminal-control bytes; explicit terminators reduce ASI surprises.

## Comments

- Default to none. A comment is justified when the _why_ is non-obvious: hidden constraint, subtle invariant, workaround for a specific bug, surprising behavior.
- Don't narrate _what_ the code does; well-named identifiers do that.
- Don't reference the current task, fix, or specific callers. That belongs in the PR description.

## Tests

- Vitest. File names: `<subject>.test.ts`, colocated with the subject.
- Test names describe **behavior**, not implementation: `'prints the version on --version'` not `'calls main with --version'`.
- No mocks for things that can be tested directly. Integration tests hit a real Ollama unless explicitly testing failure modes.

## Console output

- No `console.log`. Use the logger (added in Phase 1A). `console.error` is allowed only inside the CLI's top-level error handler.

## Imports

- Type-only imports use `import type` (or inline `import { type X }`). Enforced by `@typescript-eslint/consistent-type-imports`.
- Group order: Node built-ins, then third-party, then local. Prettier handles spacing; do not impose extra blank lines.

## Determinism

The single overriding rule, repeated here because it bites first:

> Any code path that runs during agent execution must be reproducible given the same inputs, seeds, model hashes, and runtime version.

Practically: no `Math.random`, no `Date.now`, no `crypto.randomUUID`, no `process.env` reads, no filesystem writes outside the bundle writer. See `docs/DECISIONS.md` ADR-002.
