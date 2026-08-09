import { useEffect, type RefObject } from "react";

/**
 * Fulfil a store-backed focus request only after its target can actually accept
 * focus. A request may arrive while a composer is still disabled during a
 * workspace handoff; consuming it at that point turns a timing difference into
 * a permanent focus loss.
 */
export function usePendingElementFocus<T extends HTMLElement>({
  requestNonce,
  settledNonce,
  targetRef,
  blocked,
  onSettled,
}: {
  requestNonce: number;
  settledNonce: number;
  targetRef: RefObject<T>;
  blocked: boolean;
  onSettled: (nonce: number) => void;
}) {
  useEffect(() => {
    if (requestNonce === 0 || requestNonce <= settledNonce || blocked) return;

    const target = targetRef.current;
    if (!target || target.matches(":disabled")) return;

    // These requests come from explicit navigation/help actions. Preserve the
    // browser's reveal behavior so a focused composer cannot remain off-screen
    // in a vertically stacked or compact workspace.
    target.focus();
    // Do not acknowledge a request that the browser declined. A later
    // readiness render can retry it instead of silently losing the handoff.
    if (document.activeElement === target) {
      // Settle in the owning store rather than only inside this mounted child.
      // Otherwise a later remount interprets the completed ticket as new and
      // steals focus from the route's intended arrival point.
      onSettled(requestNonce);
    }
  }, [blocked, onSettled, requestNonce, settledNonce, targetRef]);
}
