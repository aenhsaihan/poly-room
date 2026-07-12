// Trader copy backtest: replay a wallet's historical trades through our
// exact production sleeve + trailing-stop semantics.
//
// "If I had copied this trader with a $X sleeve and a Y% trail for the
// last N days, what would have happened?"
//
// Semantics mirrored from production (lib/copysync.ts / lib/traderstops.ts):
// - sizing: fraction of trader's at-risk capital × our allocation, fraction
//   capped at MAX_SLEEVE_FRACTION (0.5), spend capped by remaining sleeve cash
// - their SELL exits our whole mirrored position at their fill price
// - trader stop trails copy P&L in dollars; trigger when
//   pnl ≤ peak − trail% × deployed cost; on trigger sell everything at
//   current prices and stop copying
//
// Known approximations (surfaced in result.notes):
// - Historical portfolio value isn't retrievable, so the sizing denominator
//   is the trader's open cost basis reconstructed within the window (their
//   pre-window positions are invisible). Early-window trades size larger
//   than production would.
// - Marking/stop checks run on the price-history grid (12h/24h), not
//   tick-by-tick — the same granularity limitation as the production cadence.
// - Assets with missing price history are marked flat at our fill price.

const DATA_API = 'https://data-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const MAX_SLEEVE_FRACTION = 0.5; // keep in lockstep with lib/copysync.ts
const MAX_TRADES = 4000;
const MAX_PRICED_ASSETS = 40;

export interface TraderBacktestParams {
  wallet: string;
  allocation: number;
  trailPct: number | null;
  days: number;
}

interface RawTrade {
  asset: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  timestamp: number;
}

export interface CurvePoint { t: number; pnl: number; pnlNoStop: number }

export interface TraderBacktestResult {
  wallet: string;
  allocation: number;
  trailPct: number | null;
  days: number;
  tradesSeen: number;
  buysCopied: number;
  buysSkipped: number;
  sellsMirrored: number;
  marketsTouched: number;
  totalDeployed: number;
  finalPnl: number;
  finalPnlNoStop: number;
  peakPnl: number;
  maxDrawdown: number;
  stopOut: { t: number; pnl: number } | null;
  curve: CurvePoint[];
  notes: string[];
}

async function fetchTraderTrades(wallet: string, startTs: number): Promise<RawTrade[]> {
  const out: RawTrade[] = [];
  let offset = 0;
  while (offset < MAX_TRADES) {
    const res = await fetch(`${DATA_API}/trades?user=${wallet}&limit=500&offset=${offset}`, { cache: 'no-store' });
    if (!res.ok) break;
    const rows = await res.json() as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      out.push({
        asset: String(r.asset ?? ''),
        side: r.side === 'SELL' ? 'SELL' : 'BUY',
        size: Number(r.size ?? 0),
        price: Number(r.price ?? 0),
        timestamp: Number(r.timestamp ?? 0),
      });
    }
    const oldest = Number(rows[rows.length - 1]?.timestamp ?? 0);
    offset += rows.length;
    if (oldest < startTs) break;
  }
  return out
    .filter(t => t.timestamp >= startTs && t.asset && t.price > 0 && t.price < 1 && t.size > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchPriceSeries(asset: string, startTs: number, endTs: number, fidelityMin: number): Promise<{ t: number; p: number }[]> {
  const url = `${CLOB_API}/prices-history?market=${asset}&startTs=${startTs}&endTs=${endTs}&fidelity=${fidelityMin}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json() as { history?: { t: number; p: number }[] };
  return Array.isArray(data.history) ? data.history : [];
}

// Step function: last known price at or before t
function priceAt(series: { t: number; p: number }[], t: number, fallback: number): number {
  let best = fallback;
  for (const pt of series) {
    if (pt.t <= t) best = pt.p;
    else break;
  }
  return best;
}

interface SimOutcome {
  curve: { t: number; pnl: number }[];
  finalPnl: number;
  stopOut: { t: number; pnl: number } | null;
  buysCopied: number;
  buysSkipped: number;
  sellsMirrored: number;
  totalDeployed: number;
  peakPnl: number;
}

function simulate(
  trades: RawTrade[],
  series: Map<string, { t: number; p: number }[]>,
  fillFallback: Map<string, number>,
  allocation: number,
  trailPct: number | null,
  startTs: number,
  endTs: number,
  stepSec: number,
): SimOutcome {
  // the trader's own book, reconstructed for the sizing denominator
  const traderBook = new Map<string, { shares: number; cost: number }>();
  let traderBasis = 0;

  // our mirrored book
  let sleeveCash = allocation;
  const pos = new Map<string, { shares: number; avg: number }>();
  let cost = 0;
  let proceeds = 0;
  let peak = 0;
  let stopped = false;
  let stopOut: { t: number; pnl: number } | null = null;

  let buysCopied = 0, buysSkipped = 0, sellsMirrored = 0;

  const curve: { t: number; pnl: number }[] = [];
  let ti = 0;

  const markPnl = (t: number): number => {
    let openValue = 0;
    for (const [asset, p] of pos) {
      const px = priceAt(series.get(asset) ?? [], t, fillFallback.get(asset) ?? p.avg);
      openValue += p.shares * px;
    }
    return openValue + proceeds - cost;
  };

  const liquidate = (t: number) => {
    for (const [asset, p] of pos) {
      const px = priceAt(series.get(asset) ?? [], t, fillFallback.get(asset) ?? p.avg);
      const value = p.shares * px;
      proceeds += value;
      sleeveCash += value;
    }
    pos.clear();
  };

  for (let t = startTs; t <= endTs; t += stepSec) {
    // apply this interval's trades in timestamp order
    while (ti < trades.length && trades[ti].timestamp <= t) {
      const tr = trades[ti++];

      // trader's own book always updates, even after we've stopped
      const tb = traderBook.get(tr.asset) ?? { shares: 0, cost: 0 };
      if (tr.side === 'BUY') {
        tb.shares += tr.size;
        tb.cost += tr.size * tr.price;
        traderBasis += tr.size * tr.price;
      } else if (tb.shares > 0) {
        const sellFrac = Math.min(1, tr.size / tb.shares);
        const costOut = tb.cost * sellFrac;
        tb.shares = Math.max(0, tb.shares - tr.size);
        tb.cost -= costOut;
        traderBasis -= costOut;
        if (tb.shares <= 0.0001) { tb.shares = 0; tb.cost = 0; }
      }
      traderBook.set(tr.asset, tb);

      if (stopped) continue;

      if (tr.side === 'BUY') {
        const usd = tr.size * tr.price;
        const denom = Math.max(traderBasis, usd);
        const frac = Math.min(denom > 0 ? usd / denom : 0, MAX_SLEEVE_FRACTION);
        const amount = Math.min(frac * allocation, sleeveCash);
        if (amount < 0.01) { buysSkipped++; continue; }
        sleeveCash -= amount;
        cost += amount;
        const shares = amount / tr.price;
        const mine = pos.get(tr.asset) ?? { shares: 0, avg: tr.price };
        mine.avg = (mine.shares * mine.avg + shares * tr.price) / (mine.shares + shares);
        mine.shares += shares;
        pos.set(tr.asset, mine);
        buysCopied++;
      } else {
        const mine = pos.get(tr.asset);
        if (!mine || mine.shares <= 0.0001) continue;
        const value = mine.shares * tr.price;
        proceeds += value;
        sleeveCash += value;
        pos.delete(tr.asset);
        sellsMirrored++;
      }
    }

    // mark to market + stop check on the grid
    let pnl = markPnl(t);
    if (!stopped && cost > 0) {
      peak = Math.max(peak, pnl);
      if (trailPct !== null && pnl <= peak - (trailPct / 100) * cost) {
        liquidate(t);
        pnl = proceeds - cost; // fully realized now
        stopOut = { t, pnl };
        stopped = true;
      }
    }
    curve.push({ t, pnl });
  }

  return {
    curve,
    finalPnl: curve.length ? curve[curve.length - 1].pnl : 0,
    stopOut,
    buysCopied,
    buysSkipped,
    sellsMirrored,
    totalDeployed: cost,
    peakPnl: peak,
  };
}

export async function runTraderBacktest(params: TraderBacktestParams): Promise<TraderBacktestResult> {
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - params.days * 86400;
  const stepSec = params.days <= 45 ? 43200 : 86400; // 12h grid for short windows
  const fidelityMin = stepSec / 60;
  const notes: string[] = [
    `Marks and stop checks run on a ${stepSec / 3600}h grid, not tick-by-tick.`,
    'Sizing denominator is the trader\'s cost basis reconstructed within the window — early trades size larger than production would.',
    'Past performance ≠ future results; leaderboard traders are winners by construction (survivorship bias).',
  ];

  const trades = await fetchTraderTrades(params.wallet, startTs);
  if (trades.length >= MAX_TRADES) notes.push(`Very active trader: truncated to the most recent ${MAX_TRADES} trades.`);

  // Only price the assets we can hold (their BUY targets), largest first
  const buyUsdByAsset = new Map<string, number>();
  for (const t of trades) {
    if (t.side === 'BUY') buyUsdByAsset.set(t.asset, (buyUsdByAsset.get(t.asset) ?? 0) + t.size * t.price);
  }
  const rankedAssets = [...buyUsdByAsset.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const pricedAssets = rankedAssets.slice(0, MAX_PRICED_ASSETS);
  if (rankedAssets.length > MAX_PRICED_ASSETS) {
    notes.push(`${rankedAssets.length} markets touched; price history fetched for the top ${MAX_PRICED_ASSETS} by size — the rest mark flat at fill price.`);
  }

  const series = new Map<string, { t: number; p: number }[]>();
  for (let i = 0; i < pricedAssets.length; i += 10) {
    const batch = pricedAssets.slice(i, i + 10);
    const results = await Promise.all(batch.map(a => fetchPriceSeries(a, startTs, endTs, fidelityMin).catch(() => [])));
    batch.forEach((a, j) => series.set(a, results[j]));
  }
  const missing = pricedAssets.filter(a => (series.get(a) ?? []).length === 0).length;
  if (missing > 0) notes.push(`${missing} asset(s) had no price history — marked flat at fill price.`);

  const fillFallback = new Map<string, number>();
  for (const t of trades) {
    if (t.side === 'BUY' && !fillFallback.has(t.asset)) fillFallback.set(t.asset, t.price);
  }

  const withTrail = simulate(trades, series, fillFallback, params.allocation, params.trailPct, startTs, endTs, stepSec);
  const noTrail = params.trailPct === null
    ? withTrail
    : simulate(trades, series, fillFallback, params.allocation, null, startTs, endTs, stepSec);

  // merged curve (identical grids) + drawdown on the with-trail curve
  let runPeak = 0, maxDrawdown = 0;
  const curve: CurvePoint[] = withTrail.curve.map((pt, i) => {
    runPeak = Math.max(runPeak, pt.pnl);
    maxDrawdown = Math.max(maxDrawdown, runPeak - pt.pnl);
    return { t: pt.t, pnl: pt.pnl, pnlNoStop: noTrail.curve[i]?.pnl ?? pt.pnl };
  });

  return {
    wallet: params.wallet,
    allocation: params.allocation,
    trailPct: params.trailPct,
    days: params.days,
    tradesSeen: trades.length,
    buysCopied: withTrail.buysCopied,
    buysSkipped: withTrail.buysSkipped,
    sellsMirrored: withTrail.sellsMirrored,
    marketsTouched: rankedAssets.length,
    totalDeployed: withTrail.totalDeployed,
    finalPnl: withTrail.finalPnl,
    finalPnlNoStop: noTrail.finalPnl,
    peakPnl: withTrail.peakPnl,
    maxDrawdown,
    stopOut: withTrail.stopOut,
    curve,
    notes,
  };
}
