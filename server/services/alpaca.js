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

async function trading(path, init) {
  const res = await fetch(new URL(path, process.env.ALPACA_BASE_URL), {
    ...init,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Alpaca ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getLatestTradePrice(symbol) {
  const res = await fetch(new URL(`/v2/stocks/${symbol}/trades/latest`, process.env.ALPACA_DATA_URL), {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Alpaca getLatestTradePrice ${symbol} failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return Number(body.trade?.p);
}

export function submitOrder({ symbol, qty, side, clientOrderId }) {
  return trading('/v2/orders', {
    method: 'POST',
    body: JSON.stringify({
      symbol,
      qty: String(qty),
      side,
      type: 'market',
      time_in_force: 'day',
      client_order_id: clientOrderId,
    }),
  });
}

export function getOrder(orderId) {
  return trading(`/v2/orders/${orderId}`);
}

export async function findOrderByClientOrderId(clientOrderId) {
  const url = new URL('/v2/orders:by_client_order_id', process.env.ALPACA_BASE_URL);
  url.searchParams.set('client_order_id', clientOrderId);

  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Alpaca GET /v2/orders:by_client_order_id failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function getClock() {
  return trading('/v2/clock');
}

export function getPositions() {
  return trading('/v2/positions');
}

export function getAsset(symbol) {
  return trading(`/v2/assets/${symbol}`);
}
