// Visually-hidden-until-focused anchor to the page's main region. First
// tab-stop on keyboard-only navigation so SR + keyboard users can jump past
// the header + collapsed rails into the content region in one keystroke.
export function SkipToContent({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      onClick={(event) => {
        const target = document.getElementById(targetId);
        if (!target) return;
        event.preventDefault();
        window.history.replaceState(null, "", `#${targetId}`);
        target.scrollIntoView({ block: "start" });
        target.focus({ preventScroll: true });
        window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
      }}
      className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:border focus:border-accent focus:bg-panel focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold focus:text-ink focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-accent"
    >
      Skip to main content
    </a>
  );
}
