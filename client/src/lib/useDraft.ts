import { useEffect, useRef, useState } from 'react';

/** Sync clean forms, including dirty → clean, without undoing an HTTP ACK
 * with the pre-save WebSocket snapshot still present in props. */
export function useDraft<T>(remote: T, frozen = false) {
  const [base, setBase] = useState(remote);
  const [draft, setDraft] = useState(remote);
  const acknowledged = useRef<{ previous: string; value: T } | null>(null);
  const signature = JSON.stringify(remote);
  const latestSignature = useRef(signature);
  latestSignature.current = signature;
  const dirty = JSON.stringify(base) !== JSON.stringify(draft);
  useEffect(() => {
    const ack = acknowledged.current;
    if (ack && signature === ack.previous && signature !== JSON.stringify(ack.value)) return;
    if (ack) acknowledged.current = null;
    if (!dirty && !frozen) { setBase(remote); setDraft(remote); }
    // Values are compared by content; remote objects may be new on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, dirty, frozen]);
  const accept = (value: T) => {
    acknowledged.current = { previous: latestSignature.current, value };
    setBase(value); setDraft(value);
  };
  const reset = () => {
    const ack = acknowledged.current;
    const value = ack && signature === ack.previous ? ack.value : remote;
    setBase(value); setDraft(value);
  };
  return { base, draft, setDraft, dirty, accept, reset };
}
