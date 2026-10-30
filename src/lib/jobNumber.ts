import type { Job } from '../types'
export const jobNumber=(job:Job)=>job.xero_number_pending?'Awaiting Xero number':job.job_number
