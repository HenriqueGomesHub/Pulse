const SHORT_INTEREST_URL = 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest';
const LOOKBACK_DAYS = 60;
const MAX_ROWS = 5000;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function getLatestShortInterest(symbols) {
  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const res = await fetch(SHORT_INTEREST_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: ['symbolCode', 'settlementDate', 'currentShortPositionQuantity'],
      dateRangeFilters: [
        { fieldName: 'settlementDate', startDate: isoDate(start), endDate: isoDate(end) },
      ],
      domainFilters: [{ fieldName: 'symbolCode', values: symbols }],
      limit: MAX_ROWS,
    }),
  });
  if (!res.ok) {
    throw new Error(`FINRA consolidatedShortInterest failed: ${res.status} ${await res.text()}`);
  }

  const rows = await res.json();
  if (rows.length >= MAX_ROWS) {
    throw new Error(
      `FINRA consolidatedShortInterest returned ${rows.length} rows at the ${MAX_ROWS} row limit, so the response may be truncated`
    );
  }

  const latest = new Map();
  for (const row of rows) {
    const held = latest.get(row.symbolCode);
    if (held === undefined || row.settlementDate > held.settlementDate) {
      latest.set(row.symbolCode, {
        settlementDate: row.settlementDate,
        sharesShort: Number.isFinite(row.currentShortPositionQuantity)
          ? row.currentShortPositionQuantity
          : null,
      });
    }
  }
  return latest;
}
