export type Role = 'admin' | 'fitter'
export type JobStatus = 'Booked' | 'Prep' | 'In Progress' | 'Snag' | 'Install Complete' | 'Invoiced' | 'Fitter Paid' | 'Payment Received'
export interface Profile {
  id: string
  full_name: string
  role: Role
  active: boolean
}

export interface Site {
  id: string
  name: string
  developer: string | null
  address: string | null
}

export interface Job {
  id: string
archived: boolean
  job_number: string
  customer: string
  site_id: string | null
  site_name?: string
  plot: string | null
  po_number: string | null
  flooring_type: string
  status: JobStatus
  install_date: string | null
  due_date: string | null
  address: string | null
  access_notes: string | null
  instructions: string | null
  contract_value: number
  extras_value: number
  invoiced_value: number
  paid_value: number
  fitter_payment_due: number
  fitter_payment_status: 'Due' | 'Approved' | 'Paid'
  created_at: string
}

export interface Note {
  id: string
  job_id: string
  body: string
  visibility: 'team' | 'internal'
  created_at: string
  created_by: string
}

export interface Variation {
  id: string
  job_id: string
  description: string
  quantity: number | null
  unit: string | null
  amount: number
  status: 'Pending' | 'Approved' | 'Rejected'
  created_at: string
}

export interface JobFile {
  id: string
  job_id: string
  category: string
  file_name: string
  storage_path: string
  note: string | null
  created_at: string
}

export interface Assignment {
  job_id: string
  fitter_id: string
  fitter_name?: string
}
