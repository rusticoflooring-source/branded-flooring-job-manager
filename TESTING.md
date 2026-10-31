# Verification and release checklist

## Completed locally

- Updated frontend source passed TypeScript checking using the laptop's existing React, Supabase and TypeScript dependency versions.
- The full frontend, including the new components and actual Supabase integration module, bundled successfully with esbuild. This is a frontend compilation check, not the full Vite/PWA production build.
- 44 automated tests passed. Seven cover schedule filtering/calendar boundaries; thirty-seven cover AI inputs/review, validation, authentication/roles, origin checks, atomic-save RPC requests, encrypted tokens, invoice payloads, duplicate/ambiguous request recovery, organisation isolation, webhook verification and cron authorisation.
- Backend modules passed Node.js syntax checks.
- Existing non-modified frontend functions/assets are retained from the latest GitHub baseline. Added routes/screens wrap the existing workflows rather than replacing them.

The provider tests use synthetic fixtures and mocked HTTP responses. They do not demonstrate a real AI model's extraction accuracy, real Xero consent, live database policy execution or successful payment reconciliation against your accounts.

The machine blocked local loopback access, so the browser preview could not be inspected. Responsive/mobile layout, print layout and dictation require visual acceptance testing.

The full `npm ci` / `npm run build` with the PWA plugin remains to be run in a configured development/staging environment. Database migrations were prepared but not executed: no database server or authenticated staging connection was used here.

## Before release

1. Back up the existing database and apply the migrations to a staging copy. Confirm there are no conflicting custom triggers/policies.
2. Install from the included lockfile, run `npm test` and `npm run build`, then serve with the Vercel API runtime.
3. Sign in as an admin. Check every existing page and manual job creation/editing, sites, assignment/removal, customer/fitter payments, notes, files, variations, checklists, signatures, completion printing, archive and deletion behaviour.
4. Sign in as a fitter. Verify only assigned jobs are visible; another fitter's job, internal notes, new Xero accounting summaries and all new AI/Xero operations must be inaccessible. Start/snag/complete a test job and confirm persistence from an admin session.
5. Test AI with typed text, pasted email, a PDF, a Word file and a photo. Confirm no job exists until explicitly saved. Correct the draft before saving. Test missing and conflicting dates/prices/quantities, ambiguous site/fitter names, multiple plots and duplicate job numbers. Confirm a job and assignment are saved together, and retrying the same save does not create a duplicate.
6. Print the installation sheet and existing completion pack; check mobile and desktop layouts. Use only synthetic/test data during this exercise.
7. Connect a Xero demo company, select it explicitly and create a draft from a booked test job before installation. Confirm the selected contact, PO/site/plot description, sales account, due date, exclusive amount and tax treatment in Xero. Verify its returned Xero invoice number becomes the job number, that the PO (not the job number) is the Xero Reference, and that the plot remains separate. Verify it remains DRAFT and is not emailed or approved by this app.
8. Retry draft creation and simulate an interrupted response: only one invoice should exist. Exercise pending-request recovery.
9. Authorise/pay/part-pay/credit/void a test invoice in Xero. Sync and verify the Job Manager's linked totals, net invoiced value, paid amount, outstanding amount, status and overdue overview. Confirm fitter pay and archives are unchanged.
10. Verify OAuth state expiry/replay rejection, token refresh, webhook signature handshake and cron authentication in the deployed staging environment. Verify a webhook or missed notification is reconciled by the daily schedule. Watch for provider rate limits and partial runs.
11. Confirm no secrets are included in browser assets or committed files. Review server environment variables and enable the intended schedule before production release.
## Additional numbering acceptance tests

- Upload a test PO containing two plots under one PO number. Review both jobs, create separate Xero drafts, and check that each job/installation sheet uses its own returned invoice number while both invoice References equal the shared PO.
- Simulate an interrupted invoice response: recovery must attach the matching job URL, never another invoice merely sharing the PO. Completion and retries must reuse the same invoice.
- Create a deliberate job-number collision in staging. The invoice link should be retained, the conflict should be visible, neither existing number should be overwritten, and the pending job's print buttons should remain disabled. Resolve the collision and sync again.
- Confirm a missing provider invoice number never results in a guessed number. Confirm a linked number cannot be edited directly by an admin/fitter through the app/API, and a changed Xero number follows through on sync.
- Confirm a DRAFT invoice created for a Booked job does not mark that installation complete or increase issued revenue. On completion, verify the prompt opens the existing draft for review/send rather than creating a second invoice.

These database and live-provider tests remain pending; automated provider tests use mocked responses.
