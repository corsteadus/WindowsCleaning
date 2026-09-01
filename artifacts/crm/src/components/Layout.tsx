import { ReactNode, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import APP_VERSION from "@/version";
import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  CalendarDays,
  Receipt,
  Wrench,
  UserCircle,
  Menu,
  Target,
  RefreshCw,
  CheckSquare,
  LogOut,
  Zap,
  Briefcase,
  Search,
  Settings,
  ChevronRight,
  Shield,
  LineChart,
  Inbox,
  Activity,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@workspace/replit-auth-web";
import { AUTOMATION_ROUTES } from "@/lib/automation-routes";
import { hasClientCapability } from "@/lib/rbac";

// ─── Navigation structure ─────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: "Operations",
    items: [
      { href: "/",          label: "Dashboard", icon: LayoutDashboard, requiredCapability: "dashboard.view" },
      { href: "/schedule",  label: "Schedule",  icon: CalendarDays, requiredCapability: "schedule.view" },
      { href: "/jobs",      label: "Jobs",       icon: Briefcase, requiredCapability: "jobs.view" },
      { href: "/customers",       label: "Customers",     icon: Users, requiredCapability: "customers.view" },
      { href: "/prospects",       label: "Prospects",     icon: Target, requiredCapability: "leads.view" },
    ],
  },
  {
    label: "Revenue",
    items: [
      { href: "/quotes",          label: "Quotes",          icon: FileText, requiredCapability: "quotes.view" },
      { href: "/invoices",        label: "Invoices",        icon: Receipt, requiredCapability: "invoices.view" },
      { href: "/recurring-plans", label: "Recurring Plans", icon: RefreshCw, requiredCapability: "recurring_plans.view" },
      { href: "/payments/approvals", label: "Approval Inbox", icon: Inbox, requiredCapability: "approvals.view" },
      { href: "/reports/reconciliation", label: "Reconciliation", icon: LineChart, requiredCapability: "reconciliation.view" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/tasks",       label: "Tasks",           icon: CheckSquare, requiredCapability: "tasks.view" },
      { href: "/crews",       label: "Crews",           icon: UserCircle, requiredCapability: "crews.view" },
      { href: "/properties",  label: "Properties",      icon: Building2, requiredCapability: "properties.view" },
      { href: "/services",    label: "Service Catalog", icon: Wrench, requiredCapability: "services.view" },
      { href: AUTOMATION_ROUTES.index, label: "Automations",     icon: Zap, requiredCapability: "automation.view" },
      { href: AUTOMATION_ROUTES.health, label: "Automation Health", icon: Activity, requiredCapability: "automation_events.view" },
      { href: "/settings",    label: "Settings",        icon: Settings, requiredCapability: "settings.view" },
      { href: "/settings/financial-permissions", label: "Financial Permissions", icon: Shield, requiredCapability: "approvals.view" },
      { href: "/team-users",  label: "Team Users",       icon: Shield, requiredCapability: "team_users.manage" },
      { href: "/admin",       label: "Admin Panel",      icon: Shield, requiredCapability: "admin.settings" },
    ],
  },
];

// Route → page title mapping for the top header
const PAGE_TITLES: Record<string, string> = {
  "/":                 "Dashboard",
  "/schedule":         "Schedule",
  "/jobs":             "Jobs",
  "/customers":        "Customers",
  "/prospects":        "Prospects",
  "/leads":            "Prospects",
  "/quotes":           "Quotes",
  "/invoices":         "Invoices",
  "/recurring-plans":  "Recurring Plans",
  "/payments":         "Payments",
  "/reports/reconciliation": "Financial Reconciliation",
  "/tasks":            "Tasks",
  "/crews":            "Crews",
  "/properties":       "Properties",
  "/services":         "Service Catalog",
  [AUTOMATION_ROUTES.health]: "Automation Health",
  [AUTOMATION_ROUTES.index]: "Automations",
  "/communications":   "Communications",
  "/settings":         "Settings",
  "/team-users":       "Team Users",
  "/admin/import":     "Customer Factor Import",
  "/admin":            "Admin Panel",
};

function getPageTitle(location: string): string {
  if (location === "/") return "Dashboard";
  const match = Object.entries(PAGE_TITLES).find(
    ([path]) => path !== "/" && location.startsWith(path)
  );
  return match ? match[1] : "Superior CRM";
}

// ─── NavItem ─────────────────────────────────────────────────────────────────

function NavItem({
  href,
  label,
  icon: Icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      className={`
        group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
        transition-all duration-150 select-none
        ${isActive
          ? "bg-primary text-white shadow-sm"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}
      `}
    >
      <Icon
        className={`w-[18px] h-[18px] flex-shrink-0 transition-colors
          ${isActive ? "text-white" : "text-slate-400 group-hover:text-slate-600"}`}
      />
      <span className={isActive ? "font-semibold" : ""}>{label}</span>
    </Link>
  );
}

// ─── NavContent ───────────────────────────────────────────────────────────────

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <nav className="py-3 px-2 space-y-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 select-none">
            {section.label}
          </p>
          <div className="space-y-0.5" onClick={onNavigate}>
            {section.items
              .filter((item) => !("requiredCapability" in item) || hasClientCapability(user, item.requiredCapability as any))
              .map((item) => {
              const isActive =
                  item.href === "/"
                  ? location === "/"
                    : item.href === AUTOMATION_ROUTES.index
                      ? location === "/automations"
                  : location.startsWith(item.href);
              return (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  isActive={isActive}
                />
              );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ─── UserAvatar ───────────────────────────────────────────────────────────────

function UserAvatar({ user }: { user: any }) {
  if (user?.profileImageUrl) {
    return (
      <img
        src={user.profileImageUrl}
        alt="avatar"
        className="w-7 h-7 rounded-full object-cover ring-2 ring-white"
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center ring-2 ring-white">
      <span className="text-primary font-bold text-xs">
        {(user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase()}
      </span>
    </div>
  );
}

// ─── GlobalSearch ─────────────────────────────────────────────────────────────

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setQuery(""); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/customers?q=${encodeURIComponent(query.trim())}`);
    setOpen(false);
    setQuery("");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 h-8 px-3 rounded-lg border border-slate-200
                   text-slate-400 text-xs hover:bg-slate-50 hover:text-slate-600 hover:border-slate-300
                   transition-all group"
        title="Search (Ctrl+K)"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden md:block">Search…</span>
        <span className="hidden md:flex items-center gap-0.5 ml-1 text-[10px] text-slate-300 group-hover:text-slate-400">
          <kbd className="bg-slate-100 px-1 rounded text-[10px]">⌘K</kbd>
        </span>
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="hidden sm:flex items-center"
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => { if (!query) setOpen(false); }}
          placeholder="Search customers, jobs…"
          className="w-56 h-8 pl-9 pr-3 text-sm rounded-lg border border-primary/50 ring-2 ring-primary/10
                     bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none transition-all"
        />
      </div>
    </form>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export function SandboxEnvironmentLabel() {
  return (
    <div
      aria-label="Sandbox environment"
      className="pointer-events-none fixed bottom-3 right-3 z-50 rounded-md border border-slate-300/80 bg-white/90 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-slate-600 shadow-sm backdrop-blur-sm select-none"
    >
      SANDBOX 2 DATA FREE
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const pageTitle = getPageTitle(location);

  return (
    <div className="flex min-h-screen bg-slate-50">

      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-slate-200 sticky top-0 h-screen shrink-0">

        {/* Logo */}
        <div className="h-14 px-4 flex items-center border-b border-slate-100">
          <img src="/images/superior-logo.png" alt="Superior Professional Window Cleaning" className="h-7 w-auto object-contain" />
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto">
          <NavContent />
        </div>

        {/* User footer */}
        {user && (
          <div className="px-3 py-3 border-t border-slate-100">
            <div className="flex items-center gap-2.5 px-2">
              <Link href="/profile" title="My Profile">
                <UserAvatar user={user} />
              </Link>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate leading-tight">
                  {user.firstName
                    ? `${user.firstName} ${user.lastName || ""}`.trim()
                    : user.email}
                </p>
                <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">

        {/* Top header bar — visible on ALL screen sizes */}
        <header className="h-14 bg-white border-b border-slate-200 sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 shrink-0">

          {/* Left: hamburger (mobile only) + page title */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Sheet>
              <SheetTrigger asChild>
                <button className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
                  <Menu className="w-5 h-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-56 p-0 bg-white flex flex-col">
                <div className="h-14 px-4 flex items-center border-b border-slate-100 shrink-0">
                  <img src="/images/superior-logo.png" alt="Superior Professional Window Cleaning" className="h-7 w-auto object-contain" />
                </div>
                <div className="flex-1 overflow-y-auto">
                  <NavContent />
                </div>
                {hasClientCapability(user, "admin.settings") && (
                  <div className="px-3 py-3 border-t border-slate-100">
                    <Link
                      href="/admin"
                      className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-semibold border transition-colors
                        ${location.startsWith("/admin")
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-slate-50 text-slate-600 border-slate-200"}`}
                    >
                      <Shield className="w-4 h-4 shrink-0" />
                      <span>Admin Panel</span>
                    </Link>
                  </div>
                )}
              </SheetContent>
            </Sheet>

            {/* Breadcrumb: app name / page title */}
            <div className="flex items-center gap-1.5 text-sm">
              <span className="hidden lg:block font-medium text-slate-400">Superior</span>
              <ChevronRight className="hidden lg:block w-3.5 h-3.5 text-slate-300" />
              <h1 className="font-semibold text-slate-900">{pageTitle}</h1>
            </div>
          </div>

          {/* Center / Right: global search + user */}
          <div className="flex items-center gap-3 shrink-0">
            <GlobalSearch />

            {user && (
              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden md:flex items-center gap-2 text-right">
                  <div className="leading-tight">
                    <p className="text-xs font-semibold text-slate-700">
                      {user.firstName
                        ? `${user.firstName} ${user.lastName || ""}`.trim()
                        : user.email}
                    </p>
                  </div>
                </div>
                <Link href="/profile" title="My Profile">
                  <UserAvatar user={user} />
                </Link>
                <button
                  onClick={logout}
                  title="Sign out"
                  className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-7xl mx-auto w-full">
          {children}
        </main>

        {/* Version footer */}
        <footer className="shrink-0 px-4 py-2 md:px-8 flex items-center justify-end border-t border-slate-100">
          <span className="text-[10px] text-slate-300 font-medium tracking-wide select-none">
            Superior Professional Window Cleaning · Rev {APP_VERSION}
          </span>
        </footer>
      </div>

    </div>
  );
}
