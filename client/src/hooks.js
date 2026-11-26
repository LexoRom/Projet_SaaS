import { useCallback, useEffect, useRef, useState } from 'react';

/** Charge des données et fournit `reload` ; ignore les réponses devenues obsolètes. */
export function useLoad(load, dependencies) {
  const [state, setState] = useState({ data: null, error: null });
  const sequence = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const data = await load();
      if (current === sequence.current) setState({ data, error: null });
    } catch (error) {
      if (current === sequence.current) setState((previous) => ({ ...previous, error }));
    }
  }, dependencies);

  useEffect(() => {
    setState({ data: null, error: null });
    reload();
    return () => {
      sequence.current += 1;
    };
  }, [reload]);

  const setData = useCallback((update) => {
    setState((previous) => ({
      ...previous,
      data: typeof update === 'function' ? update(previous.data) : update,
    }));
  }, []);

  return { ...state, reload, setData };
}
