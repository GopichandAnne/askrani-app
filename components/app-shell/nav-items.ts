import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  ClipboardList,
  Inbox,
  MessagesSquare,
  Package,
  Plug,
  PlugZap,
  QrCode,
  Utensils,
  Megaphone,
  BadgeCheck,
  Ticket,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Telescope,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ConsoleProfile } from "@/lib/console-profile";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** false = planned but not built yet (shown disabled with a "Soon" chip). */
  available: boolean;
  /** owner/platform-admin only. */
  ownerOnly?: boolean;
  /** platform-admin (super admin) only — store-agnostic tools. */
  platformAdminOnly?: boolean;
  /** when set, the label is taken from the store's vertical vocabulary. */
  vocabKey?: "catalogNav";
  /** when set, shown only for these stores.business_type values. */
  businessTypes?: string[];
  /** when set, shown only for stores granted this entitlement (see StoreAccess). */
  entitlement?: "insights";
  /** when set, shown only for these console profiles (local | saas). Absent = all. */
  profiles?: ConsoleProfile[];
  /** optional per-profile label override (e.g. "Web Chat" → "Embed & install" for saas). */
  labelByProfile?: Partial<Record<ConsoleProfile, string>>;
  /** an opt-in module: shown for capability-driven profiles (saas) only when the
   *  store has this agent_config flag on. Local profiles always show it. */
  capability?: "orders" | "catalog";
};

/** Information architecture for the panel (built in order across phases). */
export const NAV_ITEMS: NavItem[] = [
  { label: "Ask Rani", href: "/assistant", icon: Sparkles, available: true },
  { label: "Orders", href: "/orders", icon: ShoppingCart, available: true, capability: "orders" },
  { label: "Redemptions", href: "/redemptions", icon: Ticket, available: true, profiles: ["local"] },
  { label: "Post reviews", href: "/reviews", icon: BadgeCheck, available: true, profiles: ["local"] },
  { label: "Campaigns", href: "/campaigns", icon: Megaphone, available: true, ownerOnly: true, profiles: ["local"] },
  { label: "Conversations", href: "/conversations", icon: MessagesSquare, available: true },
  { label: "Catalog", href: "/inventory", icon: Package, available: true, vocabKey: "catalogNav", capability: "catalog" },
  { label: "Diner", href: "/diner", icon: Utensils, available: true, ownerOnly: true, businessTypes: ["restaurant"], profiles: ["local"] },
  { label: "Agent", href: "/agent", icon: Bot, available: true, ownerOnly: true },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, available: true, ownerOnly: false },
  { label: "Web Chat", href: "/link", icon: QrCode, available: true, ownerOnly: true, labelByProfile: { saas: "Embed & install" } },
  { label: "Team", href: "/team", icon: Users, available: true, ownerOnly: true },
  { label: "Members", href: "/members", icon: ShieldCheck, available: true, ownerOnly: true, profiles: ["local"] },
  { label: "Integrations", href: "/integrations", icon: Plug, available: true, ownerOnly: true },
  { label: "Connections", href: "/connections", icon: PlugZap, available: true, ownerOnly: true, labelByProfile: { saas: "Integrations & tools" } },
  { label: "Inbox", href: "/inbox", icon: Inbox, available: true },
  { label: "Dashboard", href: "/dashboard", icon: BarChart3, available: true, ownerOnly: true },
  { label: "Insights", href: "/insights", icon: Telescope, available: true, ownerOnly: true, entitlement: "insights" },
  // ── Platform admin (super admin) — store-agnostic ──
  { label: "Stores", href: "/admin/stores", icon: Building2, available: true, platformAdminOnly: true },
  { label: "Waitlist", href: "/admin/waitlist", icon: ClipboardList, available: true, platformAdminOnly: true },
];
