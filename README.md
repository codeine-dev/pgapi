# pgapi

Automatic GraphQL API from your PostgreSQL schema — no code generation required.

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/codeine-dev/pgapi/refs/heads/master/install.sh | bash
```

Or pin a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/codeine-dev/pgapi/refs/heads/master/install.sh | bash -s -- --version v0.0.0-alpha9
```

## Docker

```bash
docker pull ghcr.io/codeine-dev/pgapi:latest
docker run -e PGAPI_CONNECTION_STRING=postgres://... ghcr.io/codeine-dev/pgapi
```

## Usage

```
pgapi --connection-string postgres://user:pass@host:5432/db
```

Visit http://localhost:3000/console for the GraphiQL console.

Run `pgapi --help` to see all available options and endpoints.

## Realtime subscriptions

pgapi exposes Postgres changes as GraphQL subscriptions over WebSockets at
`/graphql` (the `graphql-transport-ws` protocol). Triggers are installed
automatically at startup.

```graphql
subscription {
  usersChanged(event: INSERT) {
    id
    name
  }
}
```

Subscriptions work in the GraphiQL console out of the box.

## Development

```bash
bun install
bun run dev
```
