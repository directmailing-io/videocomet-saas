import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _client: ReturnType<typeof postgres> | null = null;
let _db: DrizzleDb | null = null;

function getDb(): DrizzleDb {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  _client = postgres(connectionString, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  _db = drizzle(_client, { schema });
  return _db;
}

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    return Reflect.get(getDb() as object, prop);
  },
}) as DrizzleDb;

export type DB = typeof db;
