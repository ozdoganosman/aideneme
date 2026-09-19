import { describe, expect, it } from 'vitest';
import { minTableWidth, type Column } from './VirtualTable';

const col = (key: string, extra: Partial<Column<unknown>> = {}): Column<unknown> => ({
  key,
  header: key,
  render: () => null,
  ...extra,
});

describe('minTableWidth', () => {
  // Kırpılmış sayı okunamaz, yani YANLIŞ sayıdır. Ölçüldü: sütun eklenince
  // "+%18,67" ekranda "+%18,…" oldu. Tablo sütunların toplamından dar olamaz.
  it('sütun genişliklerini toplar', () => {
    expect(minTableWidth([col('a', { width: '110px' }), col('b', { width: '150px' })])).toBe(
      '260px',
    );
  });

  it('genişlik verilmemiş sütuna taban ölçü uygular', () => {
    expect(minTableWidth([col('a'), col('b', { numeric: true })])).toBe('224px');
  });

  // px dışında bir birim toplanamaz; tahmin etmektense taban ölçüyle say.
  it('px olmayan genişliği taban ölçüyle sayar', () => {
    expect(minTableWidth([col('a', { width: '50%' })])).toBe('120px');
  });

  it('sütun yoksa sıfır', () => {
    expect(minTableWidth([])).toBe('0px');
  });
});
