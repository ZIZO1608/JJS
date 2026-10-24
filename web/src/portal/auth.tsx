import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, post, put } from "../lib/api";
import { useI18n, type Lang } from "../lib/i18n";

export interface PortalClient {
  accountId: string;
  clientId: string;
  name: string;
  username: string;
  language: Lang;
  mustChangePassword: boolean;
}
interface Business {
  nameAr: string;
  nameEn: string;
  logo: string;
}

type Status = "loading" | "login" | "ready";

interface PortalAuthCtx {
  status: Status;
  client: PortalClient | null;
  business: Business | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  setLanguage: (l: Lang) => Promise<void>;
}

const Ctx = createContext<PortalAuthCtx | null>(null);

/** The client's own login: a separate cookie and API (/api/portal) from the staff app. */
export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [status, setStatus] = useState<Status>("loading");
  const [client, setClient] = useState<PortalClient | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);

  const accept = useCallback(
    (c: PortalClient) => {
      setClient(c);
      setLang(c.language);
      setStatus("ready");
    },
    [setLang],
  );

  useEffect(() => {
    get<{ business: Business }>("/portal/info")
      .then((r) => setBusiness(r.business))
      .catch(() => undefined);
    get<{ client: PortalClient }>("/portal/me")
      .then((r) => accept(r.client))
      .catch(() => setStatus("login"));
    const onOut = () => {
      setClient(null);
      setStatus("login");
    };
    window.addEventListener("jjs:logged-out", onOut);
    return () => window.removeEventListener("jjs:logged-out", onOut);
  }, [accept]);

  const value = useMemo<PortalAuthCtx>(
    () => ({
      status,
      client,
      business,
      login: async (username, password) => {
        accept((await post<{ client: PortalClient }>("/portal/login", { username, password })).client);
        window.history.replaceState(null, "", "/portal");
      },
      logout: async () => {
        await post("/portal/logout").catch(() => undefined);
        setClient(null);
        setStatus("login");
      },
      changePassword: async (current, next) => {
        setClient((await put<{ client: PortalClient }>("/portal/me/password", { current, next })).client);
      },
      setLanguage: async (l) => {
        setLang(l);
        if (client) setClient((await put<{ client: PortalClient }>("/portal/me/language", { language: l })).client);
      },
    }),
    [status, client, business, accept, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortalAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePortalAuth must be used inside PortalAuthProvider");
  return v;
}
