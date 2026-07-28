import "server-only";
import type { PosAdapter, PosProviderId } from "./types";
import { squareAdapter } from "./adapters/square";
import { cloverAdapter } from "./adapters/clover";

/** All known POS adapters, in display order. Register a new provider here. */
export const POS_ADAPTERS: PosAdapter[] = [squareAdapter, cloverAdapter];

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
