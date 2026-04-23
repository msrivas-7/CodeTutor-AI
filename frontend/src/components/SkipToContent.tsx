// Visually-hidden-until-focused anchor to the page's main region. First
// tab-stop on keyboard-only navigation so SR + keyboard users can jump past
// the header + collapsed rails into the content region in one keystroke.
export function SkipToContent({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:border focus:border-accent focus:bg-panel focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold focus:text-ink focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-accent"
    >
      Skip to main content
    </a>
  );
}
