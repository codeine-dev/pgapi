import { Client } from "pg";
import type { SchemaModel } from "./schema";
import type { AuthContext } from "./auth";

export interface ResolverContext {
  client: Client;
  model: SchemaModel;
  auth: AuthContext;
}
