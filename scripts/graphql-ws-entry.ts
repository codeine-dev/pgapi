import { createClient } from "graphql-ws";
declare const window: { GraphQLWS?: { createClient: typeof createClient } };
window.GraphQLWS = { createClient };
