# Backups & recovery

## What is stateful

Everything of value lives in PostgreSQL:

- `ledger_accounts` / `ledger_entries` / `ledger_transactions` — the money. This
  is an append-only double-entry ledger; balances are derived from balances
  stored on `ledger_accounts` and cross-checked against entries (tests assert
  both stay in sync).
- `messages`, `delivery_events`, `message_reservations` — customer-visible
  messaging history.
- `accounts`, `users`, `sessions`, `projects`, `api_keys` — auth data.
- `payment_attempts`, `payment_events` — Paystack reconciliation history.
- `jobs` — the durable queue; losing recent rows can re-send in-flight
  messages, so frequent backups matter.

The **only** external state is: money already collected in Paystack and
provider-side message history. DevRelay itself has no files/uploads.

## Backup strategy (Neon)

Neon keeps **point-in-time recovery** per plan. Recommended configuration:

1. Enable PITR with ≥ 7 days history (Neon default per project).
2. Take a logical dump every day and retain weekly copies outside Neon:
   ```powershell
   $env:PGPASSWORD='…'
   pg_dump --no-owner --no-privileges --format=custom --file=devrelay-YYYYMMDD.dump $DATABASE_URL
   ```
   Store the dumps in an object store (S3/R2) with server-side encryption and
   object-lock.
3. Alert on backup failures; a missed backup is a launch blocker.

For self-hosted Postgres, add `wal-g`/`pgBackRest` continuous archiving plus
the same daily dump schedule (RPO achieved with WAL archiving is minutes).

## Encryption keys

`ENCRYPTION_KEY` (AES-256-GCM) protects message bodies, WhatsApp tokens,
MFA seeds, webhook endpoint secrets. Losing it makes those columns
indecipherable — back it up in a **separate** secret store (e.g. cloud KMS or a
vault), never in the same backup as the database.

## Recovery drill (documented procedure)

1. Spin up a scratch Postgres (or Neon branch) and `pg_restore` the latest dump.
2. Run against it with `DATABASE_URL` pointing at the scratch DB (APP keeps en
   static config; no code changes).
3. Verify the ledger invariant directly:
   ```sql
   -- Every ledger account's stored balance must equal the sum of its entries.
   -- (An empty result means the books are consistent.)
   SELECT l.id
   FROM ledger_accounts l
   LEFT JOIN ledger_entries e ON e.ledger_account_id = l.id
   GROUP BY l.id, l.balance_minor
   HAVING l.balance_minor <> COALESCE(SUM(e.amount_minor), 0);
   -- And the books as a whole must net to zero (expected output: 0):
   SELECT COALESCE(SUM(amount_minor), 0) AS net FROM ledger_entries;
   ```
4. Confirm a known recent message appears with its delivery events and that
   `jobs` contains no `running` rows (mark any `running` rows `pending` after a
   restore — leases were export-dependent).
5. Time the drill; aim for RTO < 30 min, RPO ≤ 5 min (PITR) / ≤ 24h (dumps).

## Deletion and retention

- `scripts/retention.ts` (`npm run retention:run`) enforces data-retention
  windows for message content; run it on a schedule (worker or cron) once the
  retention policy is confirmed with counsel.
- After a `closeDb()`/maintenance window, always re-run `npm run db:check`.
