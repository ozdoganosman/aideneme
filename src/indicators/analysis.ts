import { Candles } from '../data/types';
import { emaArr } from './calc';

// Per-holding technical read, translated to plain language for beginners.
export interface HoldingAnalysis {
  volPct: number; // annualized volatility %
  maxDD: number; // worst historical drawdown %
  r1y: number; // 1-year return %
  fromHigh: number; // % vs 52w high (negative = below)
  rsi: number; // 0..100
  trend: string; // label
  riskLabel: string;
  riskClass: 'low' | 'mid' | 'high' | 'xhigh';
  lean: 'Olumlu' | 'Nötr' | 'Zayıf';
  bullets: string[]; // plain-language points
}

export function analyzeHolding(c: Candles): HoldingAnalysis | null {
  const n = c.length;
  if (n < 30) return null;
  const close = c.close;
  const last = close[n - 1];
  const e50 = emaArr(close, 50);
  const e200 = emaArr(close, 200);
  const above200 = last > e200[n - 1];
  const goldUp = e50[n - 1] > e200[n - 1];

  const rsi = rsi14(close);
  const { hh, ll } = lastHiLo(c, 14);
  const wr = hh > ll ? (100 * (last - hh)) / (hh - ll) + 100 : 50; // 0 oversold .. 100 overbought

  const i1y = idxSince(c, 365);
  let hi52 = -Infinity;
  for (let i = i1y; i < n; i++) if (c.high[i] > hi52) hi52 = c.high[i];
  const fromHigh = hi52 > 0 ? (last / hi52 - 1) * 100 : 0;
  const r1y = close[i1y] > 0 ? (last / close[i1y] - 1) * 100 : 0;

  const volPct = annVol(close);
  const maxDD = maxDrawdown(close);

  let trend: string;
  if (above200 && goldUp) trend = 'Güçlü yukarı trend';
  else if (above200) trend = 'Yukarı trend';
  else if (!above200 && !goldUp) trend = 'Aşağı trend';
  else trend = 'Yatay / kararsız';

  let riskLabel = 'Düşük';
  let riskClass: HoldingAnalysis['riskClass'] = 'low';
  if (volPct >= 80) {
    riskLabel = 'Çok yüksek';
    riskClass = 'xhigh';
  } else if (volPct >= 50) {
    riskLabel = 'Yüksek';
    riskClass = 'high';
  } else if (volPct >= 30) {
    riskLabel = 'Orta';
    riskClass = 'mid';
  }

  let score = 0;
  score += above200 ? 1 : -1;
  score += goldUp ? 1 : -1;
  if (rsi > 55) score += 1;
  else if (rsi < 45) score -= 1;
  if (wr > 85) score -= 1; // overbought caution
  const lean: HoldingAnalysis['lean'] = score >= 2 ? 'Olumlu' : score <= -2 ? 'Zayıf' : 'Nötr';

  const bullets: string[] = [];
  bullets.push(
    above200
      ? '📈 Uzun vadeli trend YUKARI: fiyat 200 günlük ortalamanın üstünde — genel resim olumlu.'
      : '📉 Uzun vadeli trend ZAYIF: fiyat 200 günlük ortalamanın altında — temkinli olunmalı.',
  );
  bullets.push(
    goldUp
      ? '↗️ Kısa vadeli ortalama (50) uzun ortalamanın (200) üstünde — yön yukarı.'
      : '↘️ Kısa vadeli ortalama (50) uzun ortalamanın (200) altında — yön aşağı.',
  );
  if (rsi >= 70)
    bullets.push(`🔴 RSI ${rsi.toFixed(0)}: AŞIRI ALIM. Çok hızlı yükselmiş, kısa vadede geri çekilebilir.`);
  else if (rsi <= 30)
    bullets.push(`🟢 RSI ${rsi.toFixed(0)}: AŞIRI SATIM. Çok düşmüş, tepki yükselişi gelebilir.`);
  else bullets.push(`⚪ RSI ${rsi.toFixed(0)}: dengeli bölge (ne aşırı alım ne aşırı satım).`);
  bullets.push(
    fromHigh <= -1
      ? `🎯 52 haftanın zirvesinin %${Math.abs(fromHigh).toFixed(0)} altında.`
      : '🎯 52 haftanın zirvesine çok yakın / yeni zirvede.',
  );
  bullets.push(
    `⚠️ Risk: oynaklık ${riskLabel.toLowerCase()} (yılda ~%${volPct.toFixed(0)} dalgalanır); geçmişteki en sert düşüş %${maxDD.toFixed(0)}.`,
  );

  return { volPct, maxDD, r1y, fromHigh, rsi, trend, riskLabel, riskClass, lean, bullets };
}

function idxSince(c: Candles, days: number): number {
  const tlast = c.time[c.length - 1];
  const cut = tlast - days * 86400;
  let i = c.length - 1;
  while (i > 0 && c.time[i - 1] >= cut) i--;
  return i;
}

function rsi14(close: Float64Array): number {
  const len = 14;
  const n = close.length;
  if (n <= len) return 50;
  let ag = 0;
  let al = 0;
  for (let i = 1; i <= len; i++) {
    const ch = close[i] - close[i - 1];
    ag += Math.max(ch, 0);
    al += Math.max(-ch, 0);
  }
  ag /= len;
  al /= len;
  for (let i = len + 1; i < n; i++) {
    const ch = close[i] - close[i - 1];
    ag = (ag * (len - 1) + Math.max(ch, 0)) / len;
    al = (al * (len - 1) + Math.max(-ch, 0)) / len;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function lastHiLo(c: Candles, len: number): { hh: number; ll: number } {
  const n = c.length;
  let hh = -Infinity;
  let ll = Infinity;
  for (let i = Math.max(0, n - len); i < n; i++) {
    if (c.high[i] > hh) hh = c.high[i];
    if (c.low[i] < ll) ll = c.low[i];
  }
  return { hh, ll };
}

function annVol(close: Float64Array): number {
  const n = close.length;
  const start = Math.max(1, n - 252);
  const rs: number[] = [];
  let m = 0;
  for (let i = start; i < n; i++) {
    const r = close[i] / close[i - 1] - 1;
    if (Number.isFinite(r)) {
      rs.push(r);
      m += r;
    }
  }
  if (rs.length < 2) return 0;
  m /= rs.length;
  let v = 0;
  for (const r of rs) v += (r - m) * (r - m);
  v /= rs.length - 1;
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

function maxDrawdown(close: Float64Array): number {
  let peak = -Infinity;
  let dd = 0;
  for (let i = 0; i < close.length; i++) {
    const v = close[i];
    if (v > peak) peak = v;
    const d = peak > 0 ? (peak - v) / peak : 0;
    if (d > dd) dd = d;
  }
  return dd * 100;
}
