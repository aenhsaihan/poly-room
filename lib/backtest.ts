// Pure-TS strategy backtest engine over CLOB price history.
// Strategy logic ported from evan-kolberg/prediction-market-backtesting
// (long-only, all-in sizing, signal fills at the bar price, no fees — Polymarket
// charges no taker fee on most markets).

export interface PricePoint { t: number; p: number }

export type StrategyId = 'buyhold' | 'meanrev' | 'rsi' | 'emacross' | 'breakout';

export interface BtTrade {
  t: number;
  side: 'BUY' | 'SELL';
  price: number;
  shares: number;
  reason: string;
}

export interface BtResult {
  equity: { t: number; v: number }[];
  trades: BtTrade[];
  finalValue: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  winRate: number;        // % of closed round trips that were profitable
  numRoundTrips: number;
  openPosition: boolean;  // still holding at the end (marked to market)
  exposurePct: number;    // % of bars spent in a position
}

const START_CASH = 1000;

function sma(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[]): number {
  const m = sma(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

// Standard simple-average RSI: 100 - 100 / (1 + avgGain/avgLoss)
function rsiAt(prices: number[], i: number, period: number): number | null {
  if (i < period) return null;
  let gain = 0, loss = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const d = prices[j] - prices[j - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

export interface StrategyParams {
  // meanrev
  window?: number;     // rolling SMA window (bars)
  threshold?: number;  // dip below SMA to buy, in price points (0.03 = 3¢)
  // rsi
  rsiPeriod?: number;
  rsiBuy?: number;
  rsiSell?: number;
  // emacross
  emaFast?: number;
  emaSlow?: number;
  // breakout
  breakoutWindow?: number;
  breakoutStd?: number;
}

export const STRATEGY_DEFAULTS: Record<StrategyId, StrategyParams> = {
  buyhold: {},
  meanrev: { window: 12, threshold: 0.03 },
  rsi: { rsiPeriod: 14, rsiBuy: 30, rsiSell: 55 },
  emacross: { emaFast: 8, emaSlow: 21 },
  breakout: { breakoutWindow: 20, breakoutStd: 1.5 },
};

export function runBacktest(
  points: PricePoint[],
  strategy: StrategyId,
  params: StrategyParams = {}
): BtResult | null {
  if (points.length < 5) return null;
  const p = { ...STRATEGY_DEFAULTS[strategy], ...params };
  const prices = points.map(pt => pt.p);
  const n = prices.length;

  let cash = START_CASH;
  let shares = 0;
  let entryPrice = 0;
  const trades: BtTrade[] = [];
  const equity: { t: number; v: number }[] = [];
  let wins = 0, roundTrips = 0, barsInPosition = 0;

  // EMA state (seeded on first bar)
  let emaF = prices[0], emaS = prices[0];
  const aF = 2 / ((p.emaFast ?? 8) + 1);
  const aS = 2 / ((p.emaSlow ?? 21) + 1);
  let prevDiff = 0;

  const buy = (i: number, reason: string) => {
    if (prices[i] <= 0) return;
    shares = cash / prices[i];
    cash = 0;
    entryPrice = prices[i];
    trades.push({ t: points[i].t, side: 'BUY', price: prices[i], shares, reason });
  };
  const sell = (i: number, reason: string) => {
    cash = shares * prices[i];
    trades.push({ t: points[i].t, side: 'SELL', price: prices[i], shares, reason });
    roundTrips++;
    if (prices[i] > entryPrice) wins++;
    shares = 0;
  };

  for (let i = 0; i < n; i++) {
    const price = prices[i];
    const inPos = shares > 0;
    if (inPos) barsInPosition++;

    if (strategy === 'buyhold') {
      if (i === 0) buy(i, 'buy & hold');
    } else if (strategy === 'meanrev') {
      const w = p.window ?? 12;
      if (i >= w) {
        const avg = sma(prices.slice(i - w, i));
        if (!inPos && price <= avg - (p.threshold ?? 0.03)) buy(i, `dipped ${(((avg - price)) * 100).toFixed(1)}¢ below avg`);
        else if (inPos && price >= avg) sell(i, 'recovered to average');
      }
    } else if (strategy === 'rsi') {
      const r = rsiAt(prices, i, p.rsiPeriod ?? 14);
      if (r !== null) {
        if (!inPos && r < (p.rsiBuy ?? 30)) buy(i, `RSI ${r.toFixed(0)} — oversold`);
        else if (inPos && r > (p.rsiSell ?? 55)) sell(i, `RSI ${r.toFixed(0)} — recovered`);
      }
    } else if (strategy === 'emacross') {
      if (i > 0) {
        emaF = aF * price + (1 - aF) * emaF;
        emaS = aS * price + (1 - aS) * emaS;
        const diff = emaF - emaS;
        const warm = i >= (p.emaSlow ?? 21);
        if (warm) {
          if (!inPos && prevDiff <= 0 && diff > 0) buy(i, 'fast EMA crossed above slow');
          else if (inPos && prevDiff >= 0 && diff < 0) sell(i, 'fast EMA crossed below slow');
        }
        prevDiff = diff;
      }
    } else if (strategy === 'breakout') {
      const w = p.breakoutWindow ?? 20;
      if (i >= w) {
        const win = prices.slice(i - w, i);
        const mean = sma(win);
        const sd = stdev(win);
        const level = mean + (p.breakoutStd ?? 1.5) * sd;
        if (!inPos && price > level && price < 0.97) buy(i, `broke out above ${(level * 100).toFixed(1)}¢`);
        else if (inPos && price <= mean) sell(i, 'fell back to average');
      }
    }

    equity.push({ t: points[i].t, v: cash + shares * price });
  }

  const finalValue = equity[equity.length - 1].v;

  // max drawdown over the equity curve
  let peak = equity[0].v, maxDd = 0;
  for (const e of equity) {
    if (e.v > peak) peak = e.v;
    const dd = (peak - e.v) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const buyHoldFinal = prices[0] > 0 ? START_CASH * (prices[n - 1] / prices[0]) : START_CASH;

  return {
    equity,
    trades,
    finalValue,
    totalReturnPct: ((finalValue - START_CASH) / START_CASH) * 100,
    buyHoldReturnPct: ((buyHoldFinal - START_CASH) / START_CASH) * 100,
    maxDrawdownPct: maxDd * 100,
    winRate: roundTrips > 0 ? (wins / roundTrips) * 100 : 0,
    numRoundTrips: roundTrips,
    openPosition: shares > 0,
    exposurePct: (barsInPosition / n) * 100,
  };
}
