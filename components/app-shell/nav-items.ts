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
  QrCode,
  Utensils,
  Megaphone,
  BadgeCheck,
  Ticket,
  ShieldCheck,
  ShoppingCart,
  Telescope,
  Users,
  type LucideIcon,
} from "lucide-react";

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
};

/** Information architecture for the panel (built in order across phases). */
export const NAV_ITEMS: NavItem[] = [
  { label: "Orders", href: "/orders", icon: ShoppingCart, available: true },
  { label: "Redemptions", href: "/redemptions", icon: Ticket, available: true },
  { label: "Post reviews", href: "/reviews", icon: BadgeCheck, available: true },
  { label: "Campaigns", href: "/campaigns", icon: Megaphone, available: true, ownerOnly: true },
  { label: "Conversations", href: "/conversations", icon: MessagesSquare, available: true },
  { label: "Catalog", href: "/inventory", icon: Package, available: true, vocabKey: "catalogNav" },
  { label: "Diner", href: "/diner", icon: Utensils, available: true, ownerOnly: true, businessTypes: ["restaurant"] },
  { label: "Agent", href: "/agent", icon: Bot, available: true, ownerOnly: true },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, available: true, ownerOnly: false },
  { label: "Web Chat", href: "/link", icon: QrCode, available: true, ownerOnly: true },
  { label: "Team", href: "/team", icon: Users, available: true, ownerOnly: true },
  { label: "Members", href: "/members", icon: ShieldCheck, available: true, ownerOnly: true },
  { label: "Integrations", href: "/integrations", icon: Plug, available: true, ownerOnly: true },
  { label: "Inbox", href: "/inbox", icon: Inbox, available: true },
  { label: "Dashboard", href: "/dashboard", icon: BarChart3, available: true, ownerOnly: true },
  { label: "Insights", href: "/insights", icon: Telescope, available: true, ownerOnly: true, entitlement: "insights" },
  // ── Platform admin (super admin) — store-agnostic ──
  { label: "Stores", href: "/admin/stores", icon: Building2, available: true, platformAdminOnly: true },
  { label: "Waitlist", href: "/admin/waitlist", icon: ClipboardList, available: true, platformAdminOnly: true },
];
