# pgapi - Rules & Decisions

## Language & Runtime
- TypeScript, bun runtime and package manager
- fp-ts for functional patterns (TaskEither, Reader, pipe)
- io-ts for runtime type validation
- vitest for unit testing

## Architecture
- Reader pattern for dependency injection (no direct client passing)
- All external actions return TaskEither<E, A>
- Single executable target for production

## Functional Style
- Never use non-null assertions (`!`) — use `O.fromNullable` + `O.getOrElse` instead
- Never use `try...catch` — use `TE.tryCatch` with const-tagged error unions (`{ _tag: "X" as const }`)
- Exception: `try/finally` inside `TE.tryCatch` is fine for deterministic resource cleanup

## Conventions
- Tests alongside source or in tests/ directory
- Keep PROGRESS.md updated after each session
- Commit messages: concise, imperative mood
- No comments unless explicitly asked
