import { db, getAppSettings, logSystemEvent } from './db.js';
import { runDiscoveryPipeline } from './agents.js';

let schedulerTimer: NodeJS.Timeout | null = null;
let isRunningCycle = false;

export function startScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    if (isRunningCycle) return;
    isRunningCycle = true;
    try {
      const due = db
        .prepare(
          `SELECT * FROM search_schedules
           WHERE is_active = 1
           AND (next_run_at IS NULL OR datetime(next_run_at) <= datetime('now'))`
        )
        .all() as any[];

      for (const sched of due) {
        try {
          const services = JSON.parse(sched.services_json || '[]');
          const platforms = JSON.parse(sched.platforms_json || '[]');
          const countries = JSON.parse(sched.countries_json || '[]');

          // Verify at least one selected platform is genuinely tested as READY and enabled
          const enabledConnectors = db
            .prepare("SELECT id, status FROM platforms WHERE status = 'READY' AND is_enabled = 1")
            .all() as Array<{ id: string; status: string }>;
          const connectedIds = new Set(enabledConnectors.map((c) => c.id));
          const runnablePlatforms = platforms.includes('All Platforms')
            ? Array.from(connectedIds)
            : platforms.filter((p: string) => connectedIds.has(p));

          if (runnablePlatforms.length === 0) {
            logSystemEvent(
              'WARN',
              'scheduler',
              'SCHEDULE_SKIPPED_NO_READY_CONNECTOR',
              `Schedule "${sched.name}" skipped: none of the selected connectors are verified as READY.`
            );
          } else {
            const summary = await runDiscoveryPipeline({
              services,
              platforms: runnablePlatforms,
              countries,
              minScore: sched.min_score || 60,
              maxResults: sched.max_results || 10,
              intelligentMode: true,
              actor: `scheduler:${sched.name}`,
            });

            // Optional n8n webhook notification for hot leads
            const settings = getAppSettings();
            if (settings.n8n_webhook_url && summary.created_lead_ids.length > 0) {
              const hotCreated = db
                .prepare(
                  `SELECT id, lead_code, prospect_name, service_requested, lead_score, original_post_url
                   FROM leads WHERE id IN (${summary.created_lead_ids.map(() => '?').join(',')}) AND lead_score >= 80`
                )
                .all(...summary.created_lead_ids);
              if (hotCreated.length > 0) {
                fetch(settings.n8n_webhook_url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ event: 'HOT_LEADS_DISCOVERED', leads: hotCreated }),
                }).catch(() => {});
              }
            }
          }

          const freq = Math.max(5, Number(sched.frequency_minutes || 60));
          db.prepare(
            `UPDATE search_schedules
             SET last_run_at = datetime('now'),
                 next_run_at = datetime('now', '+' || ? || ' minutes')
             WHERE id = ?`
          ).run(freq, sched.id);
        } catch (err: any) {
          logSystemEvent('ERROR', 'scheduler', 'SCHEDULE_RUN_FAILED', `${sched.name}: ${err?.message || 'Error'}`);
        }
      }
    } finally {
      isRunningCycle = false;
    }
  }, 60 * 1000);
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
