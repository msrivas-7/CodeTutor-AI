import { useEffect, useRef, type RefObject } from "react";

/**
 * Fulfil a store-backed focus request only after its target can actually accept
 * focus. A request may arrive while a composer is still disabled during a
 * workspace handoff; consuming it at that point turns a timing difference into
 * a permanent focus loss.
 */
export function usePendingElementFocus<T extends HTMLElement>({
  requestNonce,
  targetRef,
  blocked,
}: {
  requestNonce: number;
  targetRef: RefObject<T>;
  blocked: boolean;
}) {
  const handledNonceRef = useRef(0);

  useEffect(() => {
    // aiStore.reset() restarts the monotonic request counter. Reset the local
    // acknowledgement too so nonce 1 is not mistaken for an old request.
    if (requestNonce === 0) {
      handledNonceRef.current = 0;
      return;
    }
    if (handledNonceRef.current === requestNonce || blocked) return;

    const target = targetRef.current;
    if (!target || target.matches(":disabled")) return;

    target.focus({ preventScroll: true });
    // Do not acknowledge a request that the browser declined. A later
    // readiness render can retry it instead of silently losing the handoff.
    if (document.activeElement === target) {
      handledNonceRef.current = requestNonce;
    }
  }, [blocked, requestNonce, targetRef]);
}
