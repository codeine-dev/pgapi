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

## Development

```bash
bun install
bun run dev
```
