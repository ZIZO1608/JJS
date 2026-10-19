import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import ar from "../i18n/ar.json";
import en from "../i18n/en.json";
import { ApiError } from "./api";

export type Lang = "ar" | "en";
const DICTS = { ar, en } as const;

type Dict = typeof en;
type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = T extends object ? { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T] : never;
export type TKey = Paths<Dict>;

function lookup(dict: unknown, key: string): string | undefined {
  const v = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);
  return typeof v === "string" ? v : undefined;
}

interface I18n {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** Pick the right half of a bilingual record. */
  pick: (o: { nameAr?: string; nameEn?: string; ar?: string; en?: string }) => string;
  /** Translate an API error by its code, falling back to its message. */
  err: (e: unknown) => string;
  /** Per-field messages from a validation error, in the current language. */
  fieldErrors: (e: unknown) => Record<string, string>;
  fmtDate: (iso: string | Date, withTime?: boolean) => string;
}

const Ctx = createContext<I18n | null>(null);

const readStored = (): Lang => {
  try {
    const v = localStorage.getItem("jjs.lang");
    return v === "en" ? "en" : "ar";
  } catch {
    return "ar";
  }
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored);
  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("jjs.lang", l);
    } catch {
      /* storage unavailable: language still applies for this session */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const t = (key: TKey, vars?: Record<string, string | number>) => {
      let s = lookup(DICTS[lang], key) ?? lookup(DICTS.en, key) ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    return {
      lang,
      dir,
      setLang,
      t,
      pick: (o) => (lang === "ar" ? (o.nameAr ?? o.ar ?? o.nameEn ?? o.en ?? "") : (o.nameEn ?? o.en ?? o.nameAr ?? o.ar ?? "")),
      err: (e) => {
        if (e instanceof ApiError) return lookup(DICTS[lang], `errors.${e.code}`) ?? e.message;
        return t("errors.generic");
      },
      fieldErrors: (e) => {
        const out: Record<string, string> = {};
        if (!(e instanceof ApiError)) return out;
        for (const i of e.issues ?? []) {
          const k = String(i.path[0] ?? "");
          if (!k || out[k]) continue;
          if (i.code === "too_small" && i.type === "string") out[k] = i.minimum === 1 ? t("errors.required") : t("errors.tooShort", { n: i.minimum ?? 1 });
          else if (i.code === "too_big") out[k] = t("errors.tooLong", { n: i.maximum ?? 0 });
          else if (i.code === "invalid_string" && i.message.includes("English")) out[k] = t("auth.usernameHint");
          else if (i.code === "invalid_string") out[k] = t("errors.badFormat");
          else if (i.code === "too_small") out[k] = t("errors.tooSmall", { n: i.minimum ?? 0 });
          else out[k] = lang === "en" ? i.message : t("errors.badValue");
        }
        return out;
      },
      fmtDate: (iso, withTime = false) => {
        const d = typeof iso === "string" ? new Date(iso) : iso;
        return d.toLocaleString(lang === "ar" ? "ar-SY-u-nu-latn" : "en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
          ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
        });
      },
    };
  }, [lang, dir, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}
