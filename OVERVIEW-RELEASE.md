# Admin overview and fitter price privacy

Prepared from main commit 23a727b. Not deployed.

The admin dashboard retains its metrics and seven-day schedule, and adds a searchable spreadsheet overview of active jobs: PO received, materials ordered, installation complete, snagging outstanding, invoiced/received amounts, payment status, and private issues/notes. Existing job screens, archive, notes/photos, signatures, assignments, AI and Xero remain present.

Overview flags are independent so payment updates cannot erase an installation or snag flag. Existing installed/payment-stage jobs show installation complete; Snag jobs show outstanding snagging. Notes and manually recorded flags are stored in an admin-only table. Payment totals come from existing job payment values, including Xero reconciliation.

Customer contract/extras/invoice/payment values and variation charges are removed from fitter API responses. Direct table reads of these values are revoked by 006. Fitters still see assigned jobs and report work/extra work, and see their individual fitting cost. Admins set that amount through the existing Assigned fitters section (select a fitter, enter a cost, choose Assign / update cost). Historical job-level fitter totals are preserved; no individual costs are guessed or backfilled. Unset costs show Not set.

Release in order:

1. Apply supabase/migrations/005_admin_overview_price_privacy.sql to the existing Supabase project. This prepares the new endpoints, per-assignment costs and admin tracking table without blocking the currently deployed frontend.
2. Build/deploy this source through the existing Vercel project, preserving all environment variables, domains and authentication settings.
3. Verify the new frontend is active, then apply supabase/migrations/006_enforce_price_privacy.sql. This revokes legacy broad table reads and completes database enforcement.
4. Check one admin and one fitter session on the live app: overview save/reload, own fitting cost, no customer charges, assigned-job updates, manual/AI job creation, and existing signoff/archive workflows.

Validation: npm run build includes all existing tests plus a real PostgreSQL-compatible PGlite permission test. It tests admin pricing access, fitter redaction, blocked direct monetary SELECT, admin-only tracking, unrelated fitter exclusion, inactive profile exclusion and anonymous denial. Live database/UI verification remains pending account access.

Do not roll back only the frontend after 006: old frontend SELECT * requests are intentionally blocked. Restore a compatible frontend, or deliberately restore previous grants before reverting the frontend if required.
