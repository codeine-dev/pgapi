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

## Phase 2: Schema Reading (complete)

- [x] Read tables, columns, types, constraints
- [x] Read foreign key relationships (with schema qualifiers)
- [x] Handle schemas beyond public (--schema flag, repeatable)
- [x] Build internal model from Postgres catalog
- [x] Read enum types from pg_type/pg_enum
- [x] Column defaults and unique constraints
- [x] Array column detection
- [x] 12 tests passing, typecheck clean

## Phase 3: GraphQL Generation (complete)

- [x] Map Postgres types to GraphQL scalar types
- [x] Generate query types for each table (list + byPk)
- [x] Generate mutation types (insert, update, delete)
- [x] Resolve relationships as nested types (FK fields)
- [x] Implement resolvers (list, byPk, insert, update, delete, FK)
- [x] SQL query builder with parameterized queries
- [x] Where input types per table (eq, neq, gt, gte, lt, lte, like, in)
- [x] OrderBy input types per table
- [x] InsertInput / UpdateInput per table (skips PK columns)
- [x] ResolverContext with persistent DB client + model
- [x] 34 tests passing, typecheck clean

## Phase 4: Server & Console (complete)

- [x] HTTP server with graphql endpoint
- [x] GraphiQL console at /console
- [x] Error handling & logging
- [x] Structured logging with levels (debug, info, warn, error)
- [x] Request logging (method, path, status, duration)
- [x] Graceful shutdown (SIGTERM/SIGINT, DB client cleanup)
- [x] GET /graphql support for queries
- [x] Single executable build (bun build --compile)
- [x] Dockerfile (multi-stage: build with bun, runtime on debian-slim)
- [x] 34 tests passing, typecheck clean
