import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getStore, type StoreShape } from './storage';

/** Live view of extension storage for React UIs. */
export function useStore<K extends keyof StoreShape>(...keys: K[]): Pick<StoreShape, K> | null {
  const [state, setState] = useState<Pick<StoreShape, K> | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getStore(...keys).then((s) => alive && setState(s));
    void load();
    const onChange = (_c: unknown, area: string) => area === 'local' && void load();
    browser.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}
