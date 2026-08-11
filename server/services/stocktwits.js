const API_URL = 'https://api.stocktwits.com/api/2';

export async function fetchSymbolStream(symbol) {
  const res = await fetch(`${API_URL}/streams/symbol/${symbol}.json`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Stocktwits stream ${symbol} failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  return (body.messages ?? []).map((message) => ({
    id: message.id,
    authorId: message.user?.id,
    likes: message.likes?.total ?? 0,
    sentiment: message.entities?.sentiment?.basic ?? null,
    createdAt: new Date(message.created_at),
  }));
}
