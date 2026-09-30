import { playClick } from './sound.ts';

export interface SwitchProps {
  /** True when AI Off is active, which means the AI switch sits in the OFF position. */
  aiOff: boolean;
  onChange: (aiOff: boolean) => void;
  locked?: boolean;
  sound?: boolean;
  size?: 'md' | 'lg';
}

/** The big physical-style switch. The lever is labeled AI; flipping it down turns AI off. */
export function Switch({ aiOff, onChange, locked = false, sound = true, size = 'lg' }: SwitchProps) {
  const flip = () => {
    if (locked) return;
    if (sound) playClick(!aiOff);
    onChange(!aiOff);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!aiOff}
      aria-label="Artificial intelligence"
      aria-disabled={locked}
      className={`aioff-switch aioff-switch--${size} ${aiOff ? 'is-off' : 'is-on'} ${locked ? 'is-locked' : ''}`}
      onClick={flip}
    >
      <span className="aioff-switch__plate">
        <span className="aioff-switch__label aioff-switch__label--on">ON</span>
        <span className="aioff-switch__slot">
          <span className="aioff-switch__lever">
            <span className="aioff-switch__lever-text">AI</span>
          </span>
        </span>
        <span className="aioff-switch__label aioff-switch__label--off">OFF</span>
        <span className="aioff-switch__screw aioff-switch__screw--t" />
        <span className="aioff-switch__screw aioff-switch__screw--b" />
      </span>
    </button>
  );
}
