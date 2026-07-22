# pgapi - Exposing your Postgres database as a GraphQL API, without writing code

## Overview

pgapi is a command-line tool, not unlike Hasura 2.0, whereby you provide your entity model in
Postgres schema, and have it exposed via a GraphQL endpoint.

pgapi has the following arguments:

--connection-string <string>

The postgres connection string to connect to the database with ALL permissions.

--port <number>

The bind port to use. Default: 3000

--host <IP address>

The bind address to use. Default: 127.0.0.1

--console

This boolean flag gates the serving of a Graphiql frontend at the root "/console" path.

## Operation

On startup, the tool should connect to the database and read the entire schema, plus any related schemas. After this is should build a memory model of the schema and create GraphQL schema from this model. When it is complete, it should serve this GrapgQL schema as an endpoint at "http://<host>:<port>/graphql". If the "--console" flag is present then also serve an instance of Graphiql at "http://<host>:<port>/console".

## Agent Guide

- Language: Typescript, using "fp-ts" functional styles, "io-ts" codecs for wire types, bun package manager/runtime. The Reader-pattern will be our dependency injection. Programs should have Reader types which handle all their external actions, never pass an environment-specific client/property directly. Eg. no AWS clients, only "doAction() => TaskEither<E,A>".
- Development: AI agents are a developer, but so is a human. Keep "bun run dev" to run a watched build, "bun test" to run unit testing. Consider what you write tests for, preferably any module.
- Production: Aim for a single executable, which could be added to a basic Docker image.
- Progress: Keep a build plan/log; PROGRESS.md, so that work can be staged. Make this plan if it's missing and ALWAYS keep it updated.
- Git: Assume there's a Git repo and make use of it. Keep work in commits with sensible messages. We want this repo to make sense.
- Workflow: Question eveything, assume little. Ask the developer what they want, let them tell you. If you need to track choices then keep them in a RULES.md and make sure that doesn't go stale.
