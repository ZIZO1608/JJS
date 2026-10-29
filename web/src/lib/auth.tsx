import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { perm, usesSimpleMode, type Action, type Module } from "@shared/permissions";
import { ApiError, get, post, put } from "./api";
import { clearDataCache } from "./useData";
import { useI18n, type Lang } from "./i18n";

export interface Me {
  id: string;
  name: string;
  username: string;
  language: Lang;
  role: { id: string; nameAr: string; nameEn: string; systemKey: "admin" | "manager" | "member" | null };
  permissions: string[];
}
export interface Business {
  nameAr: string;
  nameEn: string;
  logo: string;
  phone?: string;
  address?: string;
}

type Status = "loading" | "setup" | "login" | "ready";

interface AuthCtx {
  status: Status;
  me: Me | null;
  business: Business | null;
  can: (m: Module, a: Action) => boolean;
  simple: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (body: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
  setLanguage: (l: Lang) => Promise<void>;
  refreshBusiness: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);

  const accept = useCallback(
    (user: Me, goHome = false) => {
      if (goHome) window.history.replaceState(null, "", "/");
      setMe(user);
      setLang(user.language);
      setStatus("ready");
    },
    [setLang],
  );

  const boot = useCallback(async () => {
    try {
      const s = await get<{ needsSetup: boolean; business: Business }>("/auth/status");
      setBusiness(s.business);
      if (s.needsSetup) return setStatus("setup");
      const r = await get<{ user: Me }>("/auth/me");
      accept(r.user);
    } catch (e) {
      // no line to the server (weak internet): keep the spinner and try again, don't throw the user out to login
      if (e instanceof ApiError && e.status === 0) setTimeout(() => void boot(), 4000);
      else setStatus("login");
    }
  }, [accept]);

  useEffect(() => {
    void boot();
    const onOut = () => {
      clearDataCache();
      setMe(null);
      setStatus("login");
    };
    window.addEventListener("jjs:logged-out", onOut);
    return () => window.removeEventListener("jjs:logged-out", onOut);
  }, [boot]);

  const value = useMemo<AuthCtx>(() => {
    const set = new Set(me?.permissions ?? []);
    return {
      status,
      me,
      business,
      can: (m, a) => set.has(perm(m, a)),
      simple: me ? usesSimpleMode(me.permissions) : false,
      login: async (username, password) => {
        clearDataCache();
        accept((await post<{ user: Me }>("/auth/login", { username, password })).user, true);
      },
      setup: async (body) => {
        accept((await post<{ user: Me }>("/auth/setup", body)).user, true);
        await boot();
      },
      logout: async () => {
        await post("/auth/logout").catch(() => undefined);
        clearDataCache();
        setMe(null);
        setStatus("login");
      },
      setLanguage: async (l) => {
        setLang(l);
        if (me) setMe((await put<{ user: Me }>("/auth/me/language", { language: l })).user);
      },
      refreshBusiness: async () => {
        const s = await get<{ business: Business }>("/settings/public");
        setBusiness(s.business);
      },
    };
  }, [status, me, business, accept, boot, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
