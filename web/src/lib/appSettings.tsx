import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get } from "./api";
import type { Currency } from "./format";

export interface AppSettings {
  defaultCurrency: Currency;
  loyalty: { enabled: boolean; buyQty: number; freeQty: number };
  orders: { defaultDeliveryFee: number; allowStacking: boolean };
  printing: { receiptWidthMm: 58 | 80; labelWidthMm: number; labelHeightMm: number; receiptFooterAr: string; receiptFooterEn: string };
  business: { nameAr: string; nameEn: string; phone?: string; address?: string; logo?: string };
}

const Ctx = createContext<{ s: AppSettings | null; reload: () => Promise<void> }>({ s: null, reload: async () => undefined });

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AppSettings | null>(null);
  const reload = useCallback(async () => {
    try {
      setS(await get<AppSettings>("/system/app-settings"));
    } catch {
      /* not logged in yet */
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <Ctx.Provider value={{ s, reload }}>{children}</Ctx.Provider>;
}
/** Default currency, loyalty rule, printing sizes… (loaded once after login). */
export const useAppSettings = () => useContext(Ctx);
