import { describe, expect, it } from 'vitest';
import {
  applyPlatt,
  auc,
  brier,
  expectedCalibrationError,
  fitPlatt,
  logLoss,
  reliability,
} from './calibration';

describe('olasılık kalitesi', () => {
  it('kusursuz ayrımda AUC 1, ters ayrımda 0', () => {
    expect(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0])).toBe(1);
    expect(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0])).toBe(0);
  });

  it('tüm tahminler eşitse AUC 0.5 (beraberlik yarı yarıya sayılır)', () => {
    expect(auc([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBe(0.5);
  });

  it('tek sınıf varsa AUC tanımsızdır — 0.5 uydurulmaz', () => {
    expect(Number.isNaN(auc([0.3, 0.7], [1, 1]))).toBe(true);
  });

  it('Brier ve log-kayıp kesin tahminleri ödüllendirir', () => {
    expect(brier([1, 0], [1, 0])).toBe(0);
    expect(brier([0.5, 0.5], [1, 0])).toBeCloseTo(0.25, 12);
    expect(logLoss([0.5, 0.5], [1, 0])).toBeCloseTo(Math.log(2), 12);
  });

  it('güvenilirlik kovaları tahmin ile gerçekleşmeyi yan yana koyar', () => {
    // %80 diyen 10 vakanın 8'i gerçekleşmiş → kova kusursuz kalibre.
    const p = Array(10).fill(0.8);
    const y = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
    const bins = reliability(p, y, 5);
    const bin = bins[4];
    expect(bin.count).toBe(10);
    expect(bin.predicted).toBeCloseTo(0.8, 12);
    expect(bin.observed).toBeCloseTo(0.8, 12);
    expect(expectedCalibrationError(bins)).toBeCloseTo(0, 12);
  });

  it('aşırı güvenli model kalibrasyon hatasıyla yakalanır', () => {
    const p = Array(10).fill(0.95);
    const y = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]; // gerçekte %50
    expect(expectedCalibrationError(reliability(p, y, 5))).toBeCloseTo(0.45, 12);
  });

  it('boş kovada sayı 0, değer NaN — sıfır uydurulmaz', () => {
    const bins = reliability([0.9], [1], 5);
    expect(bins[0].count).toBe(0);
    expect(Number.isNaN(bins[0].observed)).toBe(true);
  });

  it('Platt ölçekleme ham skoru taban orana yaklaştırır', () => {
    // Skorlar bilgisiz; gerçek pozitif oranı %30.
    const scores = Array.from({ length: 100 }, (_, i) => (i % 10) - 5);
    const y = Array.from({ length: 100 }, (_, i) => (i % 10 < 3 ? 1 : 0));
    const scaler = fitPlatt(scores, y, 2000, 0.3);
    const mean = scores.reduce((acc, s) => acc + applyPlatt(scaler, s), 0) / scores.length;
    expect(mean).toBeGreaterThan(0.2);
    expect(mean).toBeLessThan(0.4);
  });
});
