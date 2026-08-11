const MAX_PAGES = 50;

function authHeaders() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET,
  };
}

export async function getBars(symbols, timeframe, start) {
  const url = new URL('/v2/stocks/bars', process.env.ALPACA_DATA_URL);
  url.searchParams.set('symbols', symbols.join(','));
  url.searchParams.set('timeframe', timeframe);
  url.searchParams.set('start', start.toISOString());
  url.searchParams.set('adjustment', 'raw');
  url.searchParams.set('limit', '10000');

  const bars = {};
  let pageToken = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`Alpaca getBars ${timeframe} failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    for (const [symbol, symbolBars] of Object.entries(body.bars ?? {})) {
      bars[symbol] = (bars[symbol] ?? []).concat(symbolBars);
    }

    pageToken = body.next_page_token;
    if (!pageToken) return bars;
  }
  throw new Error(`Alpaca getBars ${timeframe} exceeded ${MAX_PAGES} pages`);
}
