export interface RuleExplainerProps {
  ruleId: string;
  description: string;
  siteName?: string;
  level?: number;
  selectors?: string[];
  textAnchors?: string[];
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  locked?: boolean;
}

/** "Why is this hidden?" The exact rule, in plain words and as data. */
export function RuleExplainer(p: RuleExplainerProps) {
  return (
    <details className="aioff-rule">
      <summary>
        {p.onToggle && (
          <input
            type="checkbox"
            checked={p.enabled ?? true}
            disabled={p.locked}
            aria-label={`Enable rule ${p.ruleId}`}
            onChange={(e) => p.onToggle?.(e.currentTarget.checked)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <span className="aioff-rule__desc">{p.description}</span>
        {p.level != null && <span className="aioff-rule__level">L{p.level}</span>}
      </summary>
      <dl>
        <dt>Rule</dt>
        <dd>
          <code>{p.ruleId}</code>
          {p.siteName ? ` on ${p.siteName}` : ''}
        </dd>
        {!!p.selectors?.length && (
          <>
            <dt>Selectors</dt>
            <dd>
              {p.selectors.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </dd>
          </>
        )}
        {!!p.textAnchors?.length && (
          <>
            <dt>Text anchors</dt>
            <dd>
              {p.textAnchors.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
