import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "@infra/database/pool";

export const db = drizzle(pool);
