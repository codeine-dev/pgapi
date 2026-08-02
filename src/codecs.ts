import * as t from "io-ts";

export const CliArgsCodec = t.type({
  connectionString: t.string,
  port: t.number,
  host: t.string,
  console: t.boolean,
  help: t.boolean,
  schemas: t.array(t.string),
  jwtSecret: t.union([t.string, t.undefined]),
  apiKeyHeader: t.union([t.string, t.undefined]),
  oauthIssuer: t.union([t.string, t.undefined]),
  oauthAudience: t.union([t.string, t.undefined]),
  oauthClockSkew: t.union([t.number, t.undefined]),
  authMode: t.union([t.literal("none"), t.literal("optional"), t.literal("required")]),
});

export type CliArgs = t.TypeOf<typeof CliArgsCodec>;

export const WhereOperatorCodec = t.keyof({
  eq: null,
  neq: null,
  gt: null,
  gte: null,
  lt: null,
  lte: null,
  like: null,
  in: null,
});

export type WhereOperator = t.TypeOf<typeof WhereOperatorCodec>;

export const WhereConditionCodec = t.type({
  _operator: WhereOperatorCodec,
  value: t.unknown,
});

export type WhereCondition = t.TypeOf<typeof WhereConditionCodec>;

export const WhereInputCodec = t.record(t.string, t.unknown);

export type WhereInput = t.TypeOf<typeof WhereInputCodec>;

export const OrderByDirectionCodec = t.keyof({
  ASC: null,
  DESC: null,
});

export type OrderByDirection = t.TypeOf<typeof OrderByDirectionCodec>;

export const OrderByInputCodec = t.record(t.string, OrderByDirectionCodec);

export type OrderByInput = t.TypeOf<typeof OrderByInputCodec>;

export const InsertInputCodec = t.record(t.string, t.unknown);

export type InsertInput = t.TypeOf<typeof InsertInputCodec>;

export const UpdateInputCodec = t.record(t.string, t.unknown);

export type UpdateInput = t.TypeOf<typeof UpdateInputCodec>;

export const isRight = <A>(validation: t.Validation<A>): validation is { _tag: "Right"; right: A } =>
  validation._tag === "Right";

export const isLeft = (validation: t.Validation<unknown>): validation is { _tag: "Left"; left: t.Errors } =>
  validation._tag === "Left";
