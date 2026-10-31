-- Review and run once BEFORE 002. These labels preserve older data and add the
-- labels already used by the current frontend. No rows are deleted or rewritten.
alter type public.job_status add value if not exists 'Install Complete';
alter type public.job_status add value if not exists 'Fitter Paid';
alter type public.job_status add value if not exists 'Payment Received';
alter type public.job_status add value if not exists 'Complete';
alter type public.job_status add value if not exists 'Paid';
