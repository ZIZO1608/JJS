import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Kind = "ok" | "error";
interface Toast {
  id: number;
  text: string;
  kind: Kind;
}
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => undefined);

/** `raised` lifts the toasts above a bottom tab bar (the client portal). */
export function ToastProvider({ children, raised = false }: { children: ReactNode; raised?: boolean }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string, kind: Kind = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2600);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className={`pointer-events-none fixed inset-x-0 ${raised ? "bottom-28" : "bottom-5"} z-50 flex flex-col items-center gap-2 px-4`} aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`max-w-lg rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg ${t.kind === "error" ? "bg-bad text-white" : "bg-ink text-bg"}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
