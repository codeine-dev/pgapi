import { describe, it, expect } from "vitest";
import {
  CliArgsCodec,
  ServiceAccountCodec,
  ServiceAccountsCodec,
  WhereInputCodec,
  OrderByInputCodec,
  isRight,
  isLeft,
} from "./codecs";

describe("CliArgsCodec", () => {
  it("validates valid CLI args", () => {
    const valid = {
      connectionString: "postgres://localhost/test",
      port: 3000,
      host: "127.0.0.1",
      console: true,
      help: false,
      keygen: false,
      schemas: ["public"],
      jwtSecret: undefined,
      apiKeyHeader: undefined,
      oauthIssuer: undefined,
      oauthAudience: undefined,
      oauthClockSkew: undefined,
      authMode: "none",
      serviceAccounts: [],
    };
    const result = CliArgsCodec.validate(valid, []);
    expect(isRight(result)).toBe(true);
  });

  it("validates CLI args with service accounts", () => {
    const valid = {
      connectionString: "postgres://localhost/test",
      port: 3000,
      host: "127.0.0.1",
      console: false,
      help: false,
      keygen: false,
      schemas: [],
      jwtSecret: undefined,
      apiKeyHeader: undefined,
      oauthIssuer: undefined,
      oauthAudience: undefined,
      oauthClockSkew: undefined,
      authMode: "required",
      serviceAccounts: [{ name: "svc-a", key: "key-a" }],
    };
    const result = CliArgsCodec.validate(valid, []);
    expect(isRight(result)).toBe(true);
  });

  it("rejects missing connectionString", () => {
    const invalid = {
      port: 3000,
      host: "127.0.0.1",
      console: false,
      keygen: false,
      schemas: [],
      serviceAccounts: [],
    };
    const result = CliArgsCodec.validate(invalid, []);
    expect(isLeft(result)).toBe(true);
  });

  it("rejects non-numeric port", () => {
    const invalid = {
      connectionString: "postgres://localhost/test",
      port: "not-a-number",
      host: "127.0.0.1",
      console: false,
      keygen: false,
      schemas: [],
      serviceAccounts: [],
    };
    const result = CliArgsCodec.validate(invalid, []);
    expect(isLeft(result)).toBe(true);
  });
});

describe("ServiceAccountCodec", () => {
  it("validates a valid service account", () => {
    const result = ServiceAccountCodec.validate({ name: "svc-a", key: "key-a" }, []);
    expect(isRight(result)).toBe(true);
  });

  it("rejects a service account missing a key", () => {
    const result = ServiceAccountCodec.validate({ name: "svc-a" }, []);
    expect(isLeft(result)).toBe(true);
  });

  it("validates a service accounts array", () => {
    const result = ServiceAccountsCodec.validate(
      [{ name: "svc-a", key: "key-a" }, { name: "svc-b", key: "key-b" }],
      []
    );
    expect(isRight(result)).toBe(true);
  });
});

describe("WhereInputCodec", () => {
  it("validates empty where", () => {
    const result = WhereInputCodec.validate({}, []);
    expect(isRight(result)).toBe(true);
  });

  it("validates simple equality", () => {
    const result = WhereInputCodec.validate({ name: "test" }, []);
    expect(isRight(result)).toBe(true);
  });

  it("validates operator suffix format", () => {
    const result = WhereInputCodec.validate({ age_gt: 18 }, []);
    expect(isRight(result)).toBe(true);
  });

  it("validates complex values", () => {
    const result = WhereInputCodec.validate(
      { name: "test", age_gt: 18, status_in: ["active", "pending"] },
      []
    );
    expect(isRight(result)).toBe(true);
  });
});

describe("OrderByInputCodec", () => {
  it("validates valid order by", () => {
    const result = OrderByInputCodec.validate({ name: "ASC" }, []);
    expect(isRight(result)).toBe(true);
  });

  it("validates multiple columns", () => {
    const result = OrderByInputCodec.validate(
      { name: "ASC", age: "DESC" },
      []
    );
    expect(isRight(result)).toBe(true);
  });

  it("rejects invalid direction", () => {
    const result = OrderByInputCodec.validate({ name: "INVALID" }, []);
    expect(isLeft(result)).toBe(true);
  });
});
