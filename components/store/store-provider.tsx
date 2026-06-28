"use client";

import { createContext, useContext } from "react";
import type { StoreAccess } from "@/lib/auth/session";

type StoreContextValue = {
  stores: StoreAccess[];
  active: StoreAccess;
  isPlatformAdmin: boolean;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({
  value,
  children,
}: {
  value: StoreContextValue;
  children: React.ReactNode;
}) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** Active store + the user's store list, for client components in the shell. */
export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("useStore must be used within <StoreProvider>");
  }
  return ctx;
}
