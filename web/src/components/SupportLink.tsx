import { useI18n } from "../lib/i18n";

const SUPPORT_PHONE = "+963 942 556 404";
const SUPPORT_URL = "https://wa.me/963942556404";

function WhatsAppLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#25D366" className={`shrink-0 ${className}`} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/**
 * Opens a WhatsApp chat with support.
 * card: logo, label and number, for login screens and account pages.
 * row: a line in the account menu.
 * icon: logo only, for the page headers.
 */
export function SupportLink({ variant = "card", className = "" }: { variant?: "card" | "row" | "icon"; className?: string }) {
  const { tr } = useI18n();
  const label = tr("الدعم والتواصل عبر واتساب", "Support & contact on WhatsApp");
  const number = (
    <span dir="ltr" className="num">
      {SUPPORT_PHONE}
    </span>
  );

  if (variant === "icon") {
    return (
      <a
        href={SUPPORT_URL}
        target="_blank"
        rel="noreferrer"
        aria-label={`${label} ${SUPPORT_PHONE}`}
        title={`${label} ${SUPPORT_PHONE}`}
        className={`grid shrink-0 place-items-center ${className}`}
      >
        <WhatsAppLogo className="h-[22px] w-[22px]" />
      </a>
    );
  }

  if (variant === "row") {
    return (
      <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start hover:bg-sunken ${className}`}>
        <WhatsAppLogo />
        <span className="min-w-0 leading-tight">
          <span className="block">{tr("الدعم والتواصل", "Support & contact")}</span>
          <span className="block text-xs text-faint">{number}</span>
        </span>
      </a>
    );
  }

  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noreferrer"
      className={`flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-ink hover:bg-sunken ${className}`}
    >
      <WhatsAppLogo className="h-7 w-7" />
      <span className="min-w-0 text-start leading-tight">
        <span className="block text-sm text-muted">{label}</span>
        <span className="block font-semibold">{number}</span>
      </span>
    </a>
  );
}
