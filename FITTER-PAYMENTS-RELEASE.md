Fitter payment tracking

Apply supabase/migrations/011_fitter_payment_ledger.sql to the existing Supabase project after migrations 001–010, before deploying this branch. It adds independent tables and a protected entry function; existing records are preserved. The migration is safe to rerun.

Money → Fitter payments now tracks each fitter/job independently, with per-fitter summaries, payments recorded this week, approved cost, extras, agreed deductions, part-payments, outstanding balances and immutable history. Job → Payments also opens the ledger for that job. Assignment prices can populate the initial cost for review. Each payment requires its date and reference. The database serialises writes per account, rejects excess payments and probable duplicates, and handles repeated requests idempotently. Corrections reverse payments without deleting history. Only active admins can read or write the ledger.

Before using a balance to decide what to pay, enter the approved cost and all historical payments for that fitter/job. Existing manual job flags are retained and labelled Legacy; they are not automatically converted to payments because they do not identify who was paid, the payment amount, date or reference. Fitter screens retain their existing own-wage view. No transfers are initiated and no CIS/VAT treatment is inferred; use approved payable figures from your accounts.

Validation: npm run build (tests, TypeScript and production bundle), plus the PostgreSQL ledger test verifies partial payments, exact settlement, overpayment rejection, duplicate handling, repeated-request safety, extras/deductions, reversals, immutable history and role restrictions.

Activation checks: as admin, approve a real reviewed fitter/job cost, enter verified historical payments and compare the balance with accounts. Verify the Payments page and job view agree. Check fitter login cannot see this admin ledger. Do not create fictitious payments in production. Rollback: revert UI commit; retain ledger tables/history.
