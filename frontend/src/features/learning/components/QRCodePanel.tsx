// Phase A — A2 (device contract): QR-code panel for the warm
// graduation handoff. Renders a scannable QR of the magic-link URL
// returned by POST /api/anon/laptop-link so a learner who would rather
// not wait for email delivery can scan from their laptop's camera and
// hop straight to /start?invite=<token>.
//
// The QR is generated locally — no network call to a third-party QR
// service — so the magic-link token never leaves the user's device
// beyond the email round-trip the user explicitly initiated.

import { QRCodeSVG } from "qrcode.react";

export interface QRCodePanelProps {
  url: string;
}

export function QRCodePanel({ url }: QRCodePanelProps) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg p-4"
      role="img"
      aria-label="Scannable QR code linking to your laptop"
    >
      <QRCodeSVG
        value={url}
        size={180}
        level="M"
        includeMargin
        // Use brand colors. Dark module on light background keeps the
        // contrast camera-readable; some "themed" QR colors fail to
        // scan reliably on phones held at an angle.
        bgColor="#ffffff"
        fgColor="#000000"
      />
      <p className="text-center text-[11px] leading-tight text-muted">
        Open your laptop's camera and point it at this code.
      </p>
    </div>
  );
}
