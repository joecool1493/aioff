import { LEVELS } from './levels.ts';

export interface DialProps {
  level: 1 | 2 | 3 | 4;
  onChange: (level: 1 | 2 | 3 | 4) => void;
  locked?: boolean;
  disabled?: boolean;
}

/** Four-position dial. A radio group underneath, so it works with a keyboard and a screen reader. */
export function Dial({ level, onChange, locked = false, disabled = false }: DialProps) {
  const current = LEVELS.find((l) => l.level === level)!;
  return (
    <div className={`aioff-dial ${disabled ? 'is-disabled' : ''}`}>
      <div className="aioff-dial__track" role="radiogroup" aria-label="Level">
        {LEVELS.map((l) => (
          <button
            key={l.level}
            type="button"
            role="radio"
            aria-checked={l.level === level}
            aria-label={`Level ${l.level}: ${l.name}`}
            disabled={locked}
            className={`aioff-dial__stop ${l.level === level ? 'is-current' : ''} ${l.level < level ? 'is-included' : ''}`}
            onClick={() => onChange(l.level)}
          >
            <span className="aioff-dial__num">{l.level}</span>
            <span className="aioff-dial__short">{l.short}</span>
          </button>
        ))}
      </div>
      <p className="aioff-dial__detail">
        <strong>{current.name}.</strong> {current.detail}
      </p>
    </div>
  );
}
