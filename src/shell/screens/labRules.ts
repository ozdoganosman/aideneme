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

/** Operandın ölçek katsayısı (yoksa 1) — editörde "× katsayı" alanı. */
export function factorOf(operand: Operand): number {
  return operand.kind === 'scale' ? operand.factor : 1;
}

/** Operandın ölçeksiz hali — editör veri türünü bunun üstünden gösterir. */
export function baseOf(operand: Operand): Operand {
  return operand.kind === 'scale' ? operand.of : operand;
}

export function withFactor(operand: Operand, factor: number): Operand {
  const base = baseOf(operand);
  if (!Number.isFinite(factor) || factor === 1) return base;
  return { kind: 'scale', of: base, factor };
}
