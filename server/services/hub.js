const HEARTBEAT_URL = 'https://hub-production-623c.up.railway.app/api/agents/heartbeat';
const PROJECT = 'pulse';
const TIMEOUT_MS = 5000;

export function warnMissingHubKey() {
  if (!process.env.HUB_AGENT_KEY) {
    console.warn(
      '[hub] HUB_AGENT_KEY is not set, so scheduled runs will report no heartbeat and Hub will show this project as stale'
    );
  }
}

// Reporting must never be able to fail a run: a Hub outage, a wrong key or a hanging socket all
// resolve to a warning. The abort timeout matters as much as the catch — the pipeline cron fires
// every 5 minutes, and an unbounded POST would stall it rather than merely fail it.
export async function heartbeat({ name, status, summary, staleAfterMinutes }) {
  const key = process.env.HUB_AGENT_KEY;
  if (!key) return;

  try {
    const response = await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Key': key },
      body: JSON.stringify({
        name,
        project: PROJECT,
        status,
        summary,
        stale_after_minutes: staleAfterMinutes,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[hub] heartbeat for ${name} returned ${response.status}`);
    }
  } catch (error) {
    console.warn(`[hub] heartbeat for ${name} failed: ${error.message}`);
  }
}
