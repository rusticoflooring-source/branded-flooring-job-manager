type ScheduledJob = { install_date: string | null; archived: boolean }

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Calendar dates avoid UTC shifts and keep the window correct across clock changes.
export function getSevenDaySchedule<T extends ScheduledJob>(jobs: T[], now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6)
  const startDate = localDateKey(now)
  const endDate = localDateKey(end)
  const scheduled = jobs
    .filter(job => !job.archived && job.install_date != null && job.install_date >= startDate && job.install_date <= endDate)
    .sort((a, b) => a.install_date!.localeCompare(b.install_date!))

  return { startDate, endDate, jobs: scheduled }
}