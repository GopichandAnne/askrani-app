import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  ClipboardList,
  LifeBuoy,
  MessagesSquare,
  Package,
  Plug,
  QrCode,
  ShoppingCart,
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
};

/** Information architecture for the panel (built in order across phases). */
export const NAV_ITEMS: NavItem[] = [
  { label: "Orders", href: "/orders", icon: ShoppingCart, available: true },
  { label: "Conversations", href: "/conversations", icon: MessagesSquare, available: true },
  { label: "Catalog", href: "/inventory", icon: Package, available: true },
  { label: "Agent", href: "/agent", icon: Bot, available: true, ownerOnly: true },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, available: true, ownerOnly: false },
  { label: "Web Chat", href: "/link", icon: QrCode, available: true, ownerOnly: true },
  { label: "Integrations", href: "/integrations", icon: Plug, available: true, ownerOnly: true },
  { label: "Tickets", href: "/tickets", icon: LifeBuoy, available: true },
  { label: "Dashboard", href: "/dashboard", icon: BarChart3, available: true, ownerOnly: true },
  // ── Platform admin (super admin) — store-agnostic ──
  { label: "Stores", href: "/admin/stores", icon: Building2, available: true, platformAdminOnly: true },
  { label: "Waitlist", href: "/admin/waitlist", icon: ClipboardList, available: true, platformAdminOnly: true },
];
