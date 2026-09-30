export interface CounterProps {
  count: number;
  period?: string;
}

export function Counter({ count, period = 'this week' }: CounterProps) {
  return (
    <p className="aioff-counter" aria-live="polite">
      AI Off hid <strong>{count.toLocaleString()}</strong> AI {count === 1 ? 'thing' : 'things'} {period}.
    </p>
  );
}
