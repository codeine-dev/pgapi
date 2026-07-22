# pgapi - Progress Log

## Phase 1: Project Setup (complete)

- [x] Initialize git repo
- [x] Set up bun project
- [x] Install dependencies: fp-ts, io-ts, graphql, pg, vitest
- [x] Create project structure (src/, tests/)
- [x] CLI argument parsing (--connection-string, --port, --host, --console)
- [x] Database connection module (fp-ts Reader pattern)
- [x] Schema reading from Postgres (information_schema)
- [x] In-memory schema model (Table, Column, ForeignKey)
- [x] GraphQL schema generation from model
- [x] GraphQL HTTP server with /graphql endpoint
- [x] GraphiQL console endpoint at /console
- [x] Entry point wiring everything together
- [x] Unit tests for CLI (5 tests, all passing)
- [x] Typecheck passing

## Phase 2: Schema Reading

- [ ] Read tables, columns, types, constraints
- [ ] Read foreign key relationships
- [ ] Handle schemas beyond public
- [ ] Build internal model from Postgres catalog

## Phase 3: GraphQL Generation

- [ ] Map Postgres types to GraphQL scalar types
- [ ] Generate query types for each table
- [ ] Generate mutation types (insert, update, delete)
- [ ] Resolve relationships as nested types
- [ ] Implement resolvers

## Phase 4: Server & Console

- [ ] HTTP server with graphql endpoint
- [ ] GraphiQL console at /console
- [ ] Error handling & logging
