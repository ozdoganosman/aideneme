import type { Condition, Operand, Strategy } from '../../core/strategy/dsl';

/**
 * DSL stratejisi ↔ laboratuvar kural editörü.
 *
 * Editör kasıtlı olarak DAR: "VE ile bağlı ikili karşılaştırmalar" listesi.
 * Hazır stratejilerin çoğu bu şekle sığar, hepsi değil. Sığmayan bir parçayı
 * sessizce kırpmak, kullanıcının sandığından farklı bir stratejiyi test etmesi
 * demektir; bu yüzden dönüştürücü ya TAM çevirir ya da neyin sığmadığını
 * söyleyip reddeder.
 */

export type SimpleOp = 'gt' | 'gte' | 'lt' | 'lte' | 'crossAbove' | 'crossBelow';

export interface SimpleRule {
  left: Operand;
  op: SimpleOp;
  right: Operand;
}

export interface LabForm {
  entry: SimpleRule[];
  exit: SimpleRule[];
  stopLossPct: number;
  takeProfitPct: number;
  atrStopLength: number;
  atrStopMult: number;
}

export interface Conversion {
  form: LabForm | null;
  /** Editöre sığmayan parçalar — boş değilse form null'dur. */
  unsupported: string[];
}

const SIMPLE_OPS: SimpleOp[] = ['gt', 'gte', 'lt', 'lte', 'crossAbove', 'crossBelow'];

function flatten(condition: Condition, into: SimpleRule[], unsupported: string[]): void {
  switch (condition.op) {
    case 'all':
      for (const item of condition.of) flatten(item, into, unsupported);
      return;
    case 'any':
      unsupported.push('VEYA bağlacı (editör yalnızca VE listesi tutar)');
      return;
    case 'not':
      unsupported.push('DEĞİL bağlacı');
      return;
    default:
      if (SIMPLE_OPS.includes(condition.op)) {
        into.push({ left: condition.left, op: condition.op, right: condition.right });
      } else {
        unsupported.push(`"${condition.op}" karşılaştırması`);
      }
  }
}

export function toForm(strategy: Strategy): Conversion {
  const unsupported: string[] = [];
  const entry: SimpleRule[] = [];
  const exit: SimpleRule[] = [];

  flatten(strategy.entry, entry, unsupported);
  if (strategy.exit) flatten(strategy.exit, exit, unsupported);
  if (entry.length === 0) unsupported.push('giriş kuralı okunamadı');

  if (unsupported.length > 0) return { form: null, unsupported };

  return {
    form: {
      entry,
      exit,
      stopLossPct: strategy.stopLossPct ?? 0,
      takeProfitPct: strategy.takeProfitPct ?? 0,
      atrStopLength: strategy.atrStop?.length ?? 14,
      atrStopMult: strategy.atrStop?.mult ?? 0,
    },
    unsupported: [],
  };
}

export function toCondition(rules: SimpleRule[]): Condition {
  return { op: 'all', of: rules.map((r) => ({ op: r.op, left: r.left, right: r.right })) };
}

export function fromForm(form: LabForm): Strategy {
  return {
    entry: toCondition(form.entry),
    exit: form.exit.length ? toCondition(form.exit) : undefined,
    stopLossPct: form.stopLossPct > 0 ? form.stopLossPct : undefined,
    takeProfitPct: form.takeProfitPct > 0 ? form.takeProfitPct : undefined,
    atrStop:
      form.atrStopMult > 0 ? { length: form.atrStopLength, mult: form.atrStopMult } : undefined,
  };
}

/**
 * Operand sarmalayıcıları (ölçek ve geri kaydırma) editörde ayrı alanlar olarak
 * gösterilir; çekirdek her zaman scale(prev(base)) sırasında yeniden kurulur ki
 * aynı kural her zaman aynı JSON'a serileşsin.
 */
export function factorOf(operand: Operand): number {
  if (operand.kind === 'scale') return operand.factor;
  if (operand.kind === 'prev') return factorOf(operand.of);
  return 1;
}

export function shiftOf(operand: Operand): number {
  if (operand.kind === 'prev') return operand.bars;
  if (operand.kind === 'scale') return shiftOf(operand.of);
  return 0;
}

/** Operandın sarmalayıcısız hali — editör veri türünü bunun üstünden gösterir. */
export function baseOf(operand: Operand): Operand {
  if (operand.kind === 'scale' || operand.kind === 'prev') return baseOf(operand.of);
  return operand;
}

function wrap(base: Operand, factor: number, shift: number): Operand {
  let out = base;
  if (Number.isFinite(shift) && shift > 0) out = { kind: 'prev', of: out, bars: shift };
  if (Number.isFinite(factor) && factor !== 1) out = { kind: 'scale', of: out, factor };
  return out;
}

export function withFactor(operand: Operand, factor: number): Operand {
  return wrap(baseOf(operand), factor, shiftOf(operand));
}

export function withShift(operand: Operand, shift: number): Operand {
  return wrap(baseOf(operand), factorOf(operand), shift);
}
