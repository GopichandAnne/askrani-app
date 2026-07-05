import {
  BarChart3,
  BookOpen,
  Bot,
  LifeBuoy,
  MessagesSquare,
  Package,
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
};

/** Information architecture for the panel (built in order across phases). */
export const NAV_ITEMS: NavItem[] = [
  { label: "Orders", href: "/orders", icon: ShoppingCart, available: true },
  { label: "Conversations", href: "/conversations", icon: MessagesSquare, available: true },
  { label: "Inventory", href: "/inventory", icon: Package, available: true },
  { label: "Agent", href: "/agent", icon: Bot, available: true, ownerOnly: true },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, available: true, ownerOnly: false },
  { label: "Tickets", href: "/tickets", icon: LifeBuoy, available: true },
  { label: "Dashboard", href: "/dashboard", icon: BarChart3, available: true, ownerOnly: true },
];
