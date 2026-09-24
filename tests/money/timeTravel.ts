/**
 * Moves the whole database back in time by whole days, so a dataset built
 * through the API "today" becomes a history of trading days.
 *
 *   npx tsx tests/money/timeTravel.ts --days 1
 *
 * Every timestamp and date column in every table moves by the same amount in
 * one transaction, which keeps every relationship between rows exactly as the
 * app wrote it: an order settled ten minutes after it was created still is,
 * and a trading-day date still matches its instants (the range this is used
 * over has no clock change, and whole days keep local time-of-day). It is a
 * test-only tool for a private database — it refuses to run unless the
 * database name ends in `_money` or `_test`.
 */
import pg from "pg";

async function main() {
  const idx = process.argv.indexOf("--days");
  const days = idx > 0 ? Number(process.argv[idx + 1]) : 1;
  if (!Number.isInteger(days) || days <= 0 || days > 60) throw new Error("--days must be a whole number 1-60");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/_(money|test)$/.test(dbName)) throw new Error(`refusing to time-travel database "${dbName}"`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string; column_name: string; data_type: string }>(`
      SELECT c.table_name, c.column_name, c.data_type
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         AND c.data_type IN ('timestamp without time zone', 'timestamp with time zone', 'date')
       ORDER BY 1, 2`);
    const byTable = new Map<string, string[]>();
    for (const r of rows) {
      const list = byTable.get(r.table_name) ?? [];
      list.push(`"${r.column_name}" = "${r.column_name}" - interval '${days} days'`);
      byTable.set(r.table_name, list);
    }
    await client.query("BEGIN");
    // Constraint triggers (FKs) are unaffected; plain triggers that stamp
    // updated_at would undo the move, so user triggers are off for this
    // transaction only.
    await client.query("SET LOCAL session_replication_role = replica");
    for (const [table, sets] of byTable) {
      await client.query(`UPDATE "${table}" SET ${sets.join(", ")}`);
    }
    // The one date kept as text.
    await client.query(
      `UPDATE invoices SET due_date = to_char(due_date::date - ${days}, 'YYYY-MM-DD') WHERE due_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    );
    await client.query("COMMIT");
    console.log(`moved ${rows.length} columns in ${byTable.size} tables back ${days} day(s)`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
