const CASHTAG = /\$([A-Za-z]{1,5})\b/g;
const UPPERCASE_WORD = /\b[A-Z]{2,5}\b/g;

const BLOCKLIST = new Set([
  'DD', 'CEO', 'CFO', 'CTO', 'COO', 'YOLO', 'IMO', 'IMHO', 'USA', 'ATH', 'ATL', 'FDA', 'SEC', 'ETF', 'ETN',
  'IPO', 'AI', 'EPS', 'PE', 'PT', 'TA', 'FA', 'EOD', 'EOW', 'EOM', 'YTD', 'QOQ', 'YOY', 'ITM', 'OTM', 'ATM',
  'IV', 'RSI', 'MACD', 'VWAP', 'CPI', 'PPI', 'GDP', 'FOMC', 'FED', 'IRS', 'IRA', 'LLC', 'INC', 'LTD', 'PLC',
  'SPAC', 'OTC', 'NYSE', 'NFA', 'TLDR', 'TL', 'DR', 'PSA', 'OP', 'EDIT', 'LOL', 'LMAO', 'WTF', 'FUD', 'HODL',
  'MOASS', 'FTD', 'DTC', 'DTCC', 'CTB', 'SI', 'BUY', 'SELL', 'HOLD', 'LONG', 'SHORT', 'PUT', 'PUTS', 'CALL',
  'CALLS', 'BULL', 'BEAR', 'GAIN', 'LOSS', 'RIP', 'MOON', 'USD', 'EUR', 'GBP', 'CAD', 'JPY', 'CNY', 'AH',
  'PM', 'MM', 'HF', 'ER', 'EV', 'CC', 'ASAP', 'FYI', 'ETC', 'AKA',
  'AN', 'AND', 'ANY', 'ARE', 'AS', 'AT', 'BE', 'BUT', 'BY', 'CAN', 'DO', 'FOR', 'GET', 'GO', 'HAS', 'HAVE',
  'HE', 'IF', 'IN', 'IS', 'IT', 'ITS', 'ME', 'MY', 'NO', 'NOT', 'NOW', 'OF', 'OK', 'ON', 'ONE', 'OR', 'OUT',
  'SO', 'THE', 'THIS', 'TO', 'UP', 'US', 'WAS', 'WE', 'WHY', 'WILL', 'YOU', 'ALL', 'NEW', 'OLD', 'BIG', 'LOW',
  'HIGH', 'JUST', 'LIKE', 'WHAT', 'WHEN', 'WHO', 'YES', 'NEXT', 'OVER', 'MORE', 'LESS', 'GOOD', 'BAD', 'BEST',
  'REAL', 'SAME', 'ONLY', 'ALSO', 'THAN', 'THEN', 'THEY',
]);

export function extractTickers(text) {
  const found = new Set();

  for (const [, symbol] of text.matchAll(CASHTAG)) {
    found.add(symbol.toUpperCase());
  }
  for (const [symbol] of text.matchAll(UPPERCASE_WORD)) {
    if (!BLOCKLIST.has(symbol)) found.add(symbol);
  }

  return [...found];
}
