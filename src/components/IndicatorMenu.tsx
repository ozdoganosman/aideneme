import { IndicatorSettings } from './Chart';

interface Props {
  settings: IndicatorSettings;
  onChange: (s: IndicatorSettings) => void;
}

const ITEMS: [keyof IndicatorSettings, string][] = [
  ['ema', 'EMA 377 / 610'],
  ['volume', 'Hacim'],
  ['williams', 'Williams %R'],
  ['macd', 'MACD'],
];

export function IndicatorMenu({ settings, onChange }: Props) {
  return (
    <details className="menu">
      <summary className="ctl">İndikatörler ▾</summary>
      <div className="menu-pop">
        {ITEMS.map(([key, label]) => (
          <label key={key} className="menu-item">
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(e) => onChange({ ...settings, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}
