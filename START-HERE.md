# Branded Flooring Job Manager 0.4.1 — AI jobs and Xero

This is the complete updated source code, built on GitHub main commit `b238924787eed0eb5d73d878c7b7e49fb6189191`. It implements the requirements in the pasted Custom Job Management System conversation. The update was deployed to the existing live app on 31 October 2026. The live Xero company connection and manual sync were verified. AI settings are deployed, but the real extraction check returned OpenAI 429 while API billing showed $0 credit; fund API usage before testing AI.

## Included

- All existing admin and fitter screens and workflows.
- Correct admin seven-day dashboard: today plus the following six local calendar dates, all eligible jobs, sorted by installation date.
- **Create job with AI** on the Jobs page: typed instructions, browser dictation, pasted emails, PDF, Word (.doc/.docx), text/email files and photos.
- Up to ten draft jobs from a document, each separately editable and reviewed before saving.
- Explicit missing-information warnings; quantities, prices and dates remain empty when not supplied. AI output still needs human checking.
- Matching to existing sites and active fitters, without automatically creating new accounts or sites. Ambiguous names require selection.
- Product specification, quantity and unit on jobs, plus a printable installation job sheet without financial values.
- Xero connection under **Accounts & AI**, with explicit organisation selection.
- A reviewed **Create Xero draft & assign job number** action at booking, under the Xero draft tab and Payments tab. Existing Xero contacts, sales accounts and tax rates are selected by the admin.
- Job numbers assigned from the invoice number returned by Xero. Uploaded PO numbers go in Xero's Reference field, with plot numbers kept separately.
- Draft-only invoices. Approval, emailing and changes to an invoice after creation happen in Xero.
- Invoice status, payments, credits and outstanding balance syncing back into the Job Manager.
- Outstanding/overdue invoice overview and completed jobs waiting to be invoiced.
- Automatic daily payment reconciliation at 06:00 UTC, plus manual Sync Xero. Signed webhook notifications are queued for reconciliation; updates are not promised to be instant.
- Retry protection, stable references, database locks and a recovery flow for pending invoice requests.

Automatic importing from Outlook was described as a later possibility in the pasted chat, so this release uses copied email text, .eml files and uploaded attachments. It does not connect to or send email from Outlook.

## Where to start

Read **SETUP.md** for the staged setup steps. Read **TESTING.md** for what was checked and what remains to be verified with real accounts.

The active frontend is `src/App.tsx`; the entry is `src/main.tsx`. GitHub's original root-level duplicate source files are retained unchanged as historical files and are not imported by the app. Do not edit the root `App.tsx` expecting it to change the app.

Backend requests are routed explicitly to `api/router.js` and the `server/` modules. Secrets are server-only. The four SQL migrations are in `supabase/migrations/`; they require review and a staging run before applying to the live database.

## Existing features retained

Admin/fitter login, dashboard, manual job creation/search/editing/deletion, sites/developments/plots, PO numbers, fitter assignment/removal, fitter job cards and directions, Start job/Report snag/Install complete, notes/internal notes, secure files/photos/PDFs and their categories, variations and approval, customer/fitter payments, flooring-specific completion checklists, signature capture, completion printing, archived jobs grouped by builder/site, responsive layout and PWA configuration.

The new backend is additional to those features. AI and Xero operations are restricted to active administrators, and fitters continue using their existing assigned-job workflow.
## Revised booking workflow

Review the uploaded PO / AI job sheet, then save the reviewed job and prepare its Xero draft. Until Xero returns a number, the job is clearly marked Awaiting Xero number. Review the invoice customer, price, dates, sales account and tax, then create its draft. Xero chooses the invoice number and that exact value becomes the job number on the installation sheet. The PO number is the invoice Reference, not the invoice/job number.

When installation finishes, the app prompts you to review the same linked invoice. It does not create a second invoice or automatically send one. The manual-job entry route offers the same numbering workflow, while retaining the option to use a manual job number.

Migration 003 is required in addition to 001 and 002. Existing invoice links are not automatically renumbered. New linked job numbers follow Xero on later syncs. Number collisions are flagged; neither job is silently overwritten.

Migration 004 supplies the minimal server read permissions needed by older databases. Existing manually entered Xero invoice numbers are not automatically imported or linked; use the new draft workflow for a genuine new job to avoid duplicating an existing invoice.
