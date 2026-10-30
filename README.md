# Branded Flooring Job Manager 0.4.1

Read START-HERE.md and SETUP.md for the AI jobs and Xero update. For an existing database, use the reviewed migrations; do not rerun the historical setup SQL.

## Original project notes

# Branded Flooring & Interiors Ltd — Job Manager

A cloud-ready multi-user job management web application built specifically for flooring installation operations.

## Start

See `DEPLOYMENT.md`.

## Main areas

**Admin**
- Dashboard
- Jobs
- Sites/developments and plot references
- Fitter assignment
- Customer/fitter payments
- Variations approvals
- All job notes/files/checklists

**Fitter**
- Assigned jobs only
- Job/address/instructions
- Team notes
- Site photos and PDFs
- Report extra works
- Completion checklist
- Signature capture

## Security model

The browser uses a Supabase anon/publishable key. Actual access control is enforced inside PostgreSQL and Supabase Storage using Row Level Security policies from `supabase/schema.sql`.

Do not add service-role credentials to this project.
