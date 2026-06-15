import { useEffect, useState } from 'react';
import { IndicatorSettings } from './Chart';
import { IndicatorParams, DEFAULT_PARAMS } from '../indicators/calc';

interface Props {
  settings: IndicatorSettings;
  onChange: (s: IndicatorSettings) => void;
  params: IndicatorParams;
  onParams: (p: IndicatorParams) => void;
}

// Each indicator group: its on/off key + the editable period fields.
const GROUPS: { key: keyof IndicatorSettings; label: string; fields: [keyof IndicatorParams, string][] }[] = [
  { key: 'ema', label: 'EMA', fields: [['emaFast', 'hızlı'], ['emaSlow', 'yavaş']] },
  { key: 'volume', label: 'Hacim', fields: [] },
  { key: 'williams', label: 'Williams %R', fields: [['wr', '%R'], ['wrEmaA', 'EMA·1'], ['wrEmaB', 'EMA·2']] },
  { key: 'macd', label: 'MACD (NizamiCedid)', fields: [['macdFast', 'hızlı'], ['macdSlow', 'yavaş'], ['macdSig', 'sinyal'], ['macdVwma', 'eMACD']] },
  { key: 'adx', label: 'ADX', fields: [['adx', 'ADX'], ['adxEma', 'EMA']] },
  { key: 'roc', label: 'Momentum / ROC', fields: [['roc', 'N'], ['rocEma', 'EMA']] },
];

// Smooth integer input: keeps local text so it can be cleared/retyped, commits
// only valid (>=1) values upward.
function NumIn({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  return (
    <input
      className="ind-num"
      type="number"
      min={1}
      inputMode="numeric"
      value={t}
      onChange={(e) => {
        setT(e.target.value);
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v) && v >= 1) onChange(v);
      }}
    />
  );
}

export function IndicatorMenu({ settings, onChange, params, onParams }: Props) {
  const on = GROUPS.filter((g) => settings[g.key]).length;
  return (
    <details className="menu">
      <summary className="ctl">İndikatörler {on}/{GROUPS.length} ▾</summary>
      <div className="menu-pop ind-pop">
        {GROUPS.map((g) => (
          <div key={g.key} className="ind-row">
            <label className="ind-tog">
              <input type="checkbox" checked={!!settings[g.key]} onChange={(e) => onChange({ ...settings, [g.key]: e.target.checked })} />
              {g.label}
            </label>
            {g.fields.length > 0 && (
              <span className={'ind-fields' + (settings[g.key] ? '' : ' dim')}>
                {g.fields.map(([pk, lbl]) => (
                  <label key={pk} className="ind-field">
                    <span className="ind-flbl">{lbl}</span>
                    <NumIn value={params[pk]} onChange={(v) => onParams({ ...params, [pk]: v })} />
                  </label>
                ))}
              </span>
            )}
          </div>
        ))}
        <button className="ind-reset" onClick={() => onParams({ ...DEFAULT_PARAMS })}>
          ↺ Varsayılan periyotlar
        </button>
      </div>
    </details>
  );
}
