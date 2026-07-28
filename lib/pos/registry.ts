import "server-only";
import type { PosAdapter, PosProviderId } from "./types";
import { squareAdapter } from "./adapters/square";
import { cloverAdapter } from "./adapters/clover";
import { toastAdapter } from "./adapters/toast";
import { lightspeedAdapter } from "./adapters/lightspeed";
import { mockAdapter } from "./adapters/mock";

/** All known POS adapters, in display order. Register a new provider here.
 *  `mock` is test-only — configured() is false unless POS_MOCK is set, so it
 *  never appears in a real deployment. */
export const POS_ADAPTERS: PosAdapter[] = [squareAdapter, cloverAdapter, toastAdapter, lightspeedAdapter, mockAdapter];

export function getAdapter(id: string): PosAdapter | undefined {
  return POS_ADAPTERS.find((a) => a.id === id);
}

/** Adapters whose server env is configured (i.e. connectable on this server). */
export function configuredAdapters(): PosAdapter[] {
  return POS_ADAPTERS.filter((a) => a.configured());
}

export function isPosProvider(id: string): id is PosProviderId {
  return POS_ADAPTERS.some((a) => a.id === id);
}
