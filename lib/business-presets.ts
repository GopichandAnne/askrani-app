import type { Database } from "@/lib/database.types";

type AgentKey = Database["public"]["Enums"]["agent_config_key"];

/**
 * A business-type preset seeds a new store's agent so it behaves sensibly from
 * day one — the owner fine-tunes it later in Agent Setup. `{{name}}` in any
 * value is replaced with the store's display name at seed time.
 */
export type BusinessPreset = {
  id: string; // stored in stores.business_type
  label: string; // shown in the onboarding dropdown
  ordersDefault: boolean; // pre-selects the "Enable ordering" toggle
  catalogDefault: boolean; // pre-selects the "Structured catalogue" toggle
  config: Partial<Record<AgentKey, string>>; // overrides merged onto BASE
};

const LANG =
  "Reply in the same language and script the customer used, including romanized Hindi, Telugu, " +
  "Tamil, Spanish, Arabic and more. Mirror them naturally.";

const ENGAGE =
  "Engage every customer warmly. When they ask about a product, service, location, availability " +
  "or hours, look it up in the knowledge base and answer clearly - never guess a fact. Suggest " +
  "relevant options and help them decide. If you cannot answer or they need a person, say you " +
  "will check with the team. Keep replies short and friendly.";

const OFFTOPIC_RETAIL =
  "Help only with this business - its products, services, navigation, hours and orders. Politely " +
  "decline unrelated requests and steer back.";

/**
 * Applied to every preset; each preset's `config` overrides these. Keeps a
 * common baseline so even the generic "Other" type gets a working bot.
 */
const BASE: Partial<Record<AgentKey, string>> = {
  personality:
    "You are Rani, a warm, helpful assistant for {{name}}. Greet customers, answer their questions, " +
    "guide them to what they need, and help them place requests. Be concise and friendly.",
  store_prompt:
    "{{name}}. Answer questions about products, services, locations, hours and policies using the " +
    "knowledge base. Capture any order or request as items for the team to confirm.",
  engage_info: ENGAGE,
  off_topic_handling: OFFTOPIC_RETAIL,
  language_handling: LANG,
  history_turns: "10",
};

export const BUSINESS_PRESETS: BusinessPreset[] = [
  {
    id: "grocery",
    label: "Grocery / supermarket",
    ordersDefault: true,
    catalogDefault: false,
    config: { suggestion_chips: "Where is the rice?\nDo you deliver?\nWhat are your hours?" },
  },
  {
    id: "convenience",
    label: "Convenience store",
    ordersDefault: true,
    catalogDefault: false,
    config: { suggestion_chips: "Do you have milk?\nWhat time do you close?\nDo you deliver?" },
  },
  {
    id: "liquor",
    label: "Liquor / wine & spirits",
    ordersDefault: true,
    catalogDefault: false,
    config: {
      engage_info:
        ENGAGE +
        " You are knowledgeable about wine, beer and spirits: offer food pairings, gift ideas and " +
        "occasion-based picks from the knowledge base. Always remind buyers they must be of legal " +
        "drinking age with valid ID.",
      suggestion_chips: "Wine for steak?\nAny good IPAs?\nGift ideas?",
    },
  },
  {
    id: "hardware",
    label: "Hardware / DIY",
    ordersDefault: true,
    catalogDefault: false,
    config: {
      engage_info:
        ENGAGE +
        " Help with projects: suggest the tools and parts needed for a job from the knowledge base, " +
        "and match specs like sizes and voltages.",
      suggestion_chips: "Fixing a leaky faucet\nWhere's the paint?\nDo you cut wood?",
    },
  },
  {
    id: "pet",
    label: "Pet store",
    ordersDefault: true,
    catalogDefault: false,
    config: {
      engage_info:
        ENGAGE +
        " Recommend by pet type, age and size. For any health concern, remind the owner to consult a vet.",
      suggestion_chips: "Puppy food?\nCat litter aisle?\nWhat are your hours?",
    },
  },
  {
    id: "bookstore",
    label: "Bookstore / library",
    ordersDefault: true,
    catalogDefault: false,
    config: {
      engage_info:
        ENGAGE +
        " Give reading recommendations by genre, author or similar titles, and help readers find the right shelf.",
      suggestion_chips: "Books like Atomic Habits?\nKids section?\nStory time?",
    },
  },
  {
    id: "nursery",
    label: "Garden centre / nursery",
    ordersDefault: true,
    catalogDefault: false,
    config: {
      engage_info:
        ENGAGE +
        " Give plant-care advice - light, watering and seasonal picks - from the knowledge base.",
      suggestion_chips: "Plants for shade?\nWatering succulents?\nWhat are your hours?",
    },
  },
  {
    id: "restaurant",
    label: "Restaurant / café",
    ordersDefault: true,
    catalogDefault: true,
    config: {
      personality:
        "You are Rani, a friendly assistant for {{name}}. Help guests with the menu, dietary options, " +
        "hours and reservations, and take orders. Be warm and concise.",
      engage_info:
        ENGAGE +
        " Help guests explore the menu, flag vegetarian, vegan and allergen options from the knowledge " +
        "base, and suggest popular dishes.",
      suggestion_chips: "Today's specials?\nVegetarian options?\nCan I book a table?",
    },
  },
  {
    id: "hospitality",
    label: "Hotel / hospitality",
    ordersDefault: true,
    catalogDefault: false,
    config: {
      personality:
        "You are Rani, a concierge-style assistant for {{name}}. Help guests with rooms, dining, " +
        "amenities, hours and local recommendations, and note any requests for staff. Be warm and concise.",
      off_topic_handling:
        "You are a concierge assistant for this hotel. Help guests with rooms, dining, amenities, " +
        "check-in and check-out, hours and facilities. You SHOULD also give local recommendations - " +
        "restaurants, attractions and things to do nearby - using the knowledge base. Note guest " +
        "requests for staff to follow up. Only decline requests truly unrelated to the stay or the " +
        "local area, and steer back politely.",
      suggestion_chips: "Today's menu?\nWhere's the pool?\nLocal recommendations?",
    },
  },
  {
    id: "rental",
    label: "Vacation rental / Airbnb",
    ordersDefault: true,
    catalogDefault: false,
    config: {
      personality:
        "You are Rani, the guest's friendly host assistant for {{name}}, a short-term vacation rental. " +
        "Greet guests, answer questions about the property and the local area, help during their stay, " +
        "and note any requests for the host. Be warm and concise.",
      store_prompt:
        "{{name}}, a vacation rental. Answer guest questions about check-in and check-out, wifi, house " +
        "rules, appliances and amenities using the knowledge base, and give local recommendations from " +
        "the knowledge base. Capture maintenance needs, special requests and future-booking inquiries " +
        "as items for the host to follow up.",
      off_topic_handling:
        "You are the guest's host assistant for this vacation rental. Help with house rules, wifi, " +
        "check-in and check-out, appliances and amenities, and help during the stay. You SHOULD also " +
        "give local recommendations - restaurants, cafes, groceries, attractions and trails - using the " +
        "knowledge base for specific local tips. Help with questions about extending the stay or future " +
        "bookings by noting the requested dates for the host to follow up. Only decline requests truly " +
        "unrelated to the guest's stay or the local area, and steer back politely.",
      suggestion_chips: "What's the wifi password?\nBest dinner nearby?\nLate checkout possible?",
    },
  },
  {
    id: "wholesale",
    label: "Wholesale / distribution",
    ordersDefault: true,
    catalogDefault: false,
    config: {
      personality:
        "You are Rani, an assistant for {{name}}, a wholesale distributor. Help buyers check stock and " +
        "case pricing, then capture bulk orders for the team to confirm. Be efficient and clear.",
      store_prompt:
        "{{name}}, a wholesale distributor. Answer questions about stock, case and bulk pricing, minimum " +
        "orders, delivery and lead times using the knowledge base. Capture bulk orders and reorders as " +
        "items for the team to confirm pricing and delivery.",
      engage_info:
        ENGAGE +
        " Buyers order by the case or pallet: quote case prices and volume tiers from the knowledge base, " +
        "and help them reorder.",
      suggestion_chips: "Case price on 1L water?\nIs item #4021 in stock?\nDo you deliver?",
    },
  },
  {
    id: "church",
    label: "Church / place of worship",
    ordersDefault: false,
    catalogDefault: false,
    config: {
      personality:
        "You are Rani, a warm, welcoming assistant for {{name}}. Help visitors with service times, " +
        "events, facilities and programs. Be friendly and inclusive.",
      store_prompt:
        "{{name}}, a place of worship. Answer questions about service times, events, ministries, parking " +
        "and facilities using the knowledge base. Note any requests to join a group or reach the office.",
      off_topic_handling:
        "Welcome everyone warmly. Help visitors with service times, events, programs, facilities and " +
        "directions from the knowledge base. Politely decline unrelated requests and steer back.",
      suggestion_chips: "Sunday service time?\nWhere's the kids area?\nJoin a small group?",
    },
  },
  {
    id: "other",
    label: "Other",
    ordersDefault: false,
    catalogDefault: false,
    config: {},
  },
];

export function presetFor(id: string | null | undefined): BusinessPreset | undefined {
  if (!id) return undefined;
  return BUSINESS_PRESETS.find((p) => p.id === id);
}

/**
 * Resolve a business type into the concrete agent_config values to seed
 * (BASE merged with the preset's overrides), with `{{name}}` filled in.
 * Excludes orders_enabled / catalog_enabled — those come from the explicit
 * onboarding toggles.
 */
export function presetConfig(
  id: string | null | undefined,
  displayName: string,
): Partial<Record<AgentKey, string>> {
  const preset = presetFor(id);
  const merged: Partial<Record<AgentKey, string>> = { ...BASE, ...(preset?.config ?? {}) };
  const out: Partial<Record<AgentKey, string>> = {};
  for (const [k, v] of Object.entries(merged)) {
    out[k as AgentKey] = (v ?? "").replace(/\{\{name\}\}/g, displayName);
  }
  return out;
}
