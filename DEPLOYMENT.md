# Branded Flooring Job Manager — deployment

This package is the cloud-ready application. The source code is complete enough to run as a real multi-user starter, but **you must own the Supabase and Vercel accounts** and keep their credentials under your control.

## 1. Create the database

1. Create a new Supabase project.
2. Open **SQL Editor**.
3. Paste the full contents of `supabase/schema.sql`.
4. Run it once.
5. In **Project Settings → API**, copy:
   - Project URL
   - anon / publishable key

The SQL creates the database tables, private file bucket and Row Level Security rules.

## 2. Configure the app locally

Copy:

`.env.example` → `.env.local`

Then enter:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The anon/publishable key is designed for client-side use. Security is enforced by the included Row Level Security rules. Never put a Supabase service-role key in this frontend.

Install and run:

```bash
npm install
npm run dev
```

## 3. Create Steve's administrator account

In the Supabase dashboard:

1. Authentication → Users → Add user.
2. Create your email/password account.
3. Copy the user's UUID.
4. SQL Editor, run:

```sql
insert into public.profiles(id,full_name,role)
values ('PASTE-AUTH-USER-UUID','Steve','admin');
```

You can now sign into the app as administrator.

## 4. Create fitter accounts

For each fitter:

1. Authentication → Users → Add user.
2. Copy their UUID.
3. Run:

```sql
insert into public.profiles(id,full_name,role)
values ('PASTE-FITTER-UUID','Fitter Name','fitter');
```

Fitters only see jobs assigned to their own account. The admin view assigns fitters from inside each job.

## 5. Deploy to Vercel

1. Put this project in a GitHub repository, or import the folder using your normal Vercel workflow.
2. Create a Vercel project.
3. Framework preset: **Vite**.
4. Add the two environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy.

The app can then be opened from any desktop/phone browser. Install-to-home-screen/PWA packaging can be added later.

## Current production-starter features

- Email/password authentication
- Admin and fitter permission roles
- Admin operational dashboard
- Jobs with site, plot, PO, flooring type and programme date
- Site/development records
- Fitter assignment
- Fitter-only access to assigned jobs
- Job notes with internal/admin-only notes
- Secure private photo/PDF storage
- Before / preparation / installation / completion / snag photo categories
- Variations / extra works and admin approval
- Customer and fitter payment tracking
- Installation completion checklist
- Digital completion signature
- Printer-friendly completion view
- Responsive mobile fitter interface
- Database RLS security

## Before using it as the sole business record

This is a serious production starter, but I recommend these steps before relying on it as your only operational system:

- Use a staging project first and test permissions with one admin and one fitter account.
- Confirm a fitter cannot open another fitter's assigned job.
- Set an appropriate Supabase backup / PITR plan for your business needs.
- Add audit logging for sensitive accounting edits.
- Add explicit GDPR retention/deletion policies for customer/site photographs.
- Add automated database backups/export.
- Add error monitoring.
- Add Xero only after the job/payment workflow is stable.

## Xero integration

The database has been designed so Xero can be added without redesigning jobs. The next integration should add:
- `xero_contact_id`
- `xero_invoice_id`
- OAuth token storage on a server-side function only
- Create/update invoice action
- Payment reconciliation sync

**Do not put Xero client secrets or refresh tokens in the Vite frontend.** That integration must run in a server-side function (for example a Supabase Edge Function or another backend service).
