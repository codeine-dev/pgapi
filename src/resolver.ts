import { Client } from "pg";
import type { SchemaModel } from "./schema";

export interface ResolverContext {
  client: Client;
  model: SchemaModel;
}
