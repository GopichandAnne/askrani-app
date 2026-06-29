// WhatsApp Cloud API webhook payload shapes (only what Phase 1 needs).

export interface WaWebhook {
  object?: string;
  entry?: WaEntry[];
}
export interface WaEntry {
  id?: string;
  changes?: WaChange[];
}
export interface WaChange {
  field?: string;
  value?: WaValue;
}
export interface WaValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: WaContact[];
  messages?: WaMessage[];
  statuses?: unknown[]; // delivery/read receipts — ignored in Phase 1
}
export interface WaContact {
  wa_id?: string;
  profile?: { name?: string };
}
export interface WaMessage {
  from?: string; // customer phone (E.164 without +)
  id?: string; // wamid — stable across Meta retries (our dedup key)
  timestamp?: string; // unix seconds (string)
  type?: string; // text | image | interactive | ...
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}

export interface Store {
  id: string;
  slug: string;
  store_display_name: string | null;
}
