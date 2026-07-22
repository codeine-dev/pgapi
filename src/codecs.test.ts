import { describe, it, expect } from "vitest";
import {
  CliArgsCodec,
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
      schemas: ["public"],
      jwtSecret: undefined,
      apiKeyHeader: undefined,
      authMode: "none",
    };
    const result = CliArgsCodec.validate(valid, []);
    expect(isRight(result)).toBe(true);
  });

  it("rejects missing connectionString", () => {
    const invalid = {
      port: 3000,
      host: "127.0.0.1",
      console: false,
      schemas: [],
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
      schemas: [],
    };
    const result = CliArgsCodec.validate(invalid, []);
    expect(isLeft(result)).toBe(true);
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
