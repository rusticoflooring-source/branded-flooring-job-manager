type ScheduledJob = { install_date: string | null; install_end_date?: string | null; archived: boolean }

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
}

// Calendar dates avoid UTC shifts and keep the window correct across clock changes.
export function getSevenDaySchedule<T extends ScheduledJob>(jobs: T[], now = new Date()) {
  const startDate = localDateKey(now)
  const end = new Date(Date.parse(startDate+'T12:00:00Z')+6*86400000)
  const endDate = localDateKey(end)
  const scheduled = jobs
    .filter(job => !job.archived && job.install_date != null && (job.install_end_date || job.install_date) >= startDate && job.install_date <= endDate)
    .sort((a, b) => a.install_date!.localeCompare(b.install_date!))

  return { startDate, endDate, jobs: scheduled }
}