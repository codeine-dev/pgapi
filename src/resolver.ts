import { Client } from "pg";
import type { SchemaModel } from "./schema";
import type { AuthContext } from "./auth";
import type { SubscriptionManager } from "./realtime";

export interface ResolverContext {
  client: Client;
  model: SchemaModel;
  auth: AuthContext;
  subscriptions?: SubscriptionManager;
}
