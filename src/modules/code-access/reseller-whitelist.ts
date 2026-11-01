import { pool } from "@infra/database/pool";

export const CODE_ADMIN_ID = "852584177382981643";

export async function isResellerAllowed(userId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM code_reseller_whitelist WHERE user_id=$1", [userId]);
  return result.rows.length > 0;
}

export async function setResellerAllowed(userId: string, allowed: boolean): Promise<void> {
  if (allowed) {
    await pool.query("INSERT INTO code_reseller_whitelist(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
  } else {
    await pool.query("DELETE FROM code_reseller_whitelist WHERE user_id=$1", [userId]);
  }
}
