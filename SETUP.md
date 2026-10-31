# Setup and release steps

## 1. Review in a separate folder and staging project

Keep the working live app available. Extract this source into a new folder. Use Node.js 22 or newer and run:

```sh
npm ci
npm test
npm run build
```

For the frontend alone, use `npm run dev`. For the frontend and API together, install/use the official Vercel CLI and run `vercel dev` (or `npm run dev:full` when that CLI is on your PATH). A plain Vite server does not serve the new backend endpoints.

Create `.env.local` locally using the two `VITE_SUPABASE_...` variables in `.env.example`. Use your staging database first. Set the server variables from `.env.server.example` in the hosting project or local development environment. Keep real environment files out of Git.

## 2. Review the database migrations

Do not rerun the old root `schema.sql` against your existing live database.

First back up the existing database and review its actual schema, policies and triggers. Run `supabase/migrations/001_job_status_compatibility.sql` and let it commit. Then run `002_ai_xero.sql` separately, followed by `003_xero_job_numbers.sql` and `004_server_read_access.sql`. If 001 and 002 were already applied for 0.4.0, review and apply only the new 003 migration. Test both against staging before production.

The migrations preserve existing rows, add optional product/quantity fields and the archive field if missing, and create isolated tables for reviewed-job requests, rate limits, OAuth state, encrypted Xero tokens, invoice summaries and locks. New token/state tables have no browser read policies. Only invoice-summary columns are available to authenticated admins.

Migration 002 also replaces the original `protect_admin_job_fields` function so trusted server reconciliation can update accounting values while protecting the new fields from fitter edits. Compare it with any live customisations before applying it. It assumes the existing job tables and role helper from this application's original schema.

The AI save function creates a job and its fitter assignment in one transaction. Reusing the same request ID returns the original job if the reviewed content is unchanged. Jobs using Xero numbering get a private temporary reference while awaiting the real invoice number; it is displayed as Awaiting Xero number. Duplicate final job numbers are still rejected by the existing database constraint.

## 3. Configure the AI connection

Set `OPENAI_API_KEY` on the server and choose an available model supporting Responses API file/image inputs and structured outputs in `OPENAI_MODEL`. The example uses `gpt-5.4-mini`; confirm availability in your account. No API keys go into the browser bundle. API usage can incur charges.

Only active admins may use AI creation. Requests are limited to 20 per admin per hour. Uploads allow up to four supported files totalling 2.5 MB to remain within the server request-size limit. Larger source material should be split or reduced before upload.

No job is created when preparing a draft. A human must review and explicitly save each job. Missing prices are stored with the existing zero-value default, not an invented quote. Original upload files are processed for drafting and are not automatically filed under job photos; use the existing job Files/Photos tab to retain a source document if required.

`store:false` disables storage of the generated Responses object; it is not a promise of zero retention under the AI provider's broader data policies. The UI explains that chosen inputs go to the AI service. Browser dictation uses the browser's speech service and may not be available in every browser; typing and keyboard dictation remain alternatives.

## 4. Register and connect a Xero app

Create a standard OAuth 2.0 web app in your Xero developer account. Register this exact HTTPS callback for the staging or production origin you are using:

```
https://YOUR-APP-ORIGIN/api/xero/callback
```

Set `APP_URL` to that same origin, with no path. For additional controlled app domains, set a comma-separated `APP_ALLOWED_ORIGINS` allowlist and register each corresponding callback in Xero. OAuth uses a browser-bound state cookie and returns to its initiating trusted origin. Set `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` on the server. The requested granular scopes are:

```
offline_access accounting.invoices accounting.contacts.read accounting.settings.read
```

They allow invoice creation/readback and read-only contact/account/tax selection. The code never calls Xero's invoice-email, approval or payment-creation endpoints.

Generate a unique 32-byte encryption key locally and put its base64 value in `TOKEN_ENCRYPTION_KEY`. One way is:

```sh
node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('base64'))"
```

Keep that key stable and backed up securely. If it changes, stored Xero credentials cannot be decrypted and Xero must be reconnected. Tokens are encrypted with AES-256-GCM and refreshed under a database lock.

In the app, open **Accounts & AI**, choose **Connect Xero**, complete Xero's own consent screen, and explicitly select the organisation. This release supports one shared business organisation. Existing invoice links prevent switching to a different organisation accidentally. All access remains subject to the connected administrator's profile staying active.

Use a Xero demo company for acceptance tests. Configure tax treatment, sales account and correct contact explicitly when previewing an invoice. The amount entered is exclusive of tax. Confirm reverse-charge/other treatment with your accounting settings as applicable; it is not inferred by AI.

The app creates the draft at booking, before installation, with one invoice per job, with one line for the agreed job price and a stable job reference. Part-invoicing and multiple invoices per job are not included. Existing manually created Xero invoices are not automatically guessed or imported into jobs.

## 5. Payment reconciliation

Set a long, independent `CRON_SECRET` in Vercel. `vercel.json` schedules an authenticated daily reconciliation at 06:00 UTC. Ensure the deployed project's scheduler is enabled. **Sync Xero** and the per-job sync button allow an admin to refresh immediately. Admin dashboard/lists and the Accounts & AI overview refresh in the background once a minute while visible; an open job form is left alone while you edit it. You can configure more frequent scheduling if your hosting plan supports it.

If using Xero webhooks, register `/api/xero/webhook` and set its signing key as `XERO_WEBHOOK_KEY`. The handler validates the raw-body HMAC signature before recording events. The scheduled sync is the durable queue consumer and also polls linked invoices to recover missed notifications. Webhook receipt itself does not immediately change job payments.

Draft invoices are shown as drafts and do not become issued revenue in the Job Manager. Authorised/paid invoices update the linked job's invoiced and paid values. Credit notes reduce the net invoiced value, so outstanding amounts stay consistent with Xero; the invoice panel shows original total, cash paid, credits and amount due separately. Full settlement updates the job to Payment Received. Existing fitter-payment fields and archived flags are not modified by reconciliation.

An invoice edited, voided or deleted in Xero is reflected on a later sync. Voiding/deleting an issued linked invoice clears its linked job's invoiced/paid figures, retaining other job details. This assumes one invoice is the accounting source for that job. When Xero is linked, avoid conflicting manual edits to the same customer payment figures.

Each sync works on up to 100 oldest-checked links and has a time budget. The UI tells you when to run it again. A persistent failed/pending link may need attention. Review sync results; do not treat a partial or failed run as complete.

## 6. Pending invoice recovery

Stable job links (and historical references for older links), per-operation locks and Xero's idempotency key protect against duplicate requests. If a response is interrupted, use **Sync invoice & payments** first. This recovers a new-format invoice by its source URL, including when several jobs share one PO. Historical links use their original unique reference.

If no invoice was created, retrying the same reviewed details within five minutes reuses the original idempotency key. Older uncertain requests are blocked because Xero's idempotency cache expires. Check Xero manually, then use **Discard unsent pending request** if appropriate; the server waits at least five minutes and independently checks that no matching invoice exists before clearing it.

The app does not delete a Xero invoice when a job is deleted locally. Any accounting corrections should be reviewed in Xero.

## 7. Release only after acceptance tests

Follow TESTING.md with staging admin and fitter accounts. Confirm the full production build, database migration, OAuth callback, AI extraction and Xero draft/payment sync with your own configured services. Review an actual test job sheet on desktop and mobile. Only then publish to the live project, preserving its existing environment settings.

Deployment status: the live database migrations and production release were completed on 31 October 2026, preserving all existing record values. Live Xero authorisation and sync were verified. API billing was subsequently funded. Typed AI extraction, reviewed saving in the test database, and a live-backend fictional PDF PO extraction passed. Invoice creation against the real company has not been exercised during acceptance checks.

## Official implementation references

- [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs): Responses file data and image inputs.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): strict JSON-schema draft output.
- [Xero authorisation code flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow/): server-side OAuth connection.
- [Xero token management](https://developer.xero.com/documentation/best-practices/data-integrity/managing-tokens/): encrypted token storage and serialised refresh.
- [Xero idempotent requests](https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/): keys expire after six minutes; this app stops automatic re-creation earlier.
- [Xero granular scopes](https://developer.xero.com/faq/granular-scopes): invoice and read-only contact/settings scopes.
- [Xero webhooks](https://developer.xero.com/documentation/guides/webhooks/overview/): raw-body HMAC verification.
## Matching the invoice and job number (0.4.1)

Use the default Xero-number option when reviewing an AI-created job or booking a manual job. The AI does not invent an invoice number and the server does not guess the next number from Xero's sequence. The invoice request deliberately omits InvoiceNumber so Xero assigns it from the organisation settings. Its returned number is copied into the linked job by a server-only transaction.

The PO remains in `po_number` and goes into Xero Reference exactly (apart from surrounding whitespace). The plot remains a separate job field and is included in the invoice description. A source URL points to `APP_URL/?job=JOB_ID` for unambiguous linking and recovery; the app opens that job only if the signed-in account can read it.

If the invoice number is missing or already belongs to another job, the invoice link is retained and a number-sync error is shown. The job remains Awaiting Xero number, and the installation/completion print buttons stay disabled. Resolve the conflict and Sync again; do not create another invoice. Financial reconciliation can continue independently. Original job numbers are recorded on the link for traceability.

Once linked, the job number is read-only in the app. If a number is deliberately changed in Xero, a subsequent sync updates the job. Avoid changing numbers after issuing a printed job sheet; reprint after a deliberate change.

On completion, the job shows a review prompt and the Accounts & AI overview lists completed jobs whose existing Xero drafts are ready for final review. Check extras and final quantities in that existing draft, then approve/send in Xero. This app still does not authorise or email invoices automatically.
