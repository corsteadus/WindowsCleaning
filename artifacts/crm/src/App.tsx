import { Redirect, Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { revalidateAuth, useAuth, type AuthUser } from "@workspace/replit-auth-web";
import { useLoginWithPassword } from "@workspace/api-client-react";
import APP_VERSION from "@/version";
import React, { useLayoutEffect, useState } from "react";
import { useNavigationTracker } from "@/hooks/use-back-navigation";
import { SandboxEnvironmentLabel } from "@/components/Layout";

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Superior CRM] Uncaught render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-xl font-bold text-amber-700">!</div>
            <h2 className="text-lg font-bold text-slate-900">Something went wrong</h2>
            <p className="text-sm text-slate-500 font-mono bg-slate-50 rounded-lg p-3 text-left break-words">
              {this.state.error.message}
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="bg-primary text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import Dashboard from "@/pages/Dashboard";
import Customers from "@/pages/Customers";
import Properties from "@/pages/Properties";
import Services from "@/pages/Services";
import Quotes from "@/pages/Quotes";
import QuoteNew from "@/pages/QuoteNew";
import QuoteDetail from "@/pages/QuoteDetail";
import QuotePrint from "@/pages/QuotePrint";
import Schedule from "@/pages/Schedule";
import PublicEstimate from "@/pages/PublicEstimate";
import Jobs from "@/pages/Jobs";
import JobNew from "@/pages/JobNew";
import JobDetail from "@/pages/JobDetail";
import Invoices from "@/pages/Invoices";
import InvoiceDetail from "@/pages/InvoiceDetail";
import Crews from "@/pages/Crews";
import RecurringPlans from "@/pages/RecurringPlans";
import RecurringPlanNew from "@/pages/RecurringPlanNew";
import RecurringPlanDetail from "@/pages/RecurringPlanDetail";
import Tasks from "@/pages/Tasks";
import Payments from "@/pages/Payments";
import FinancialReconciliation from "@/pages/FinancialReconciliation";
import FinancialPermissions from "@/pages/FinancialPermissions";
import ApprovalInbox from "@/pages/ApprovalInbox";
import Communications from "@/pages/Communications";
import Automations from "@/pages/Automations";
import AutomationHealth from "@/pages/AutomationHealth";
import AutomationNew from "@/pages/AutomationNew";
import AutomationDetail from "@/pages/AutomationDetail";
import Settings from "@/pages/Settings";
import Admin from "@/pages/Admin";
import AdminImport from "@/pages/AdminImport";
import TeamUsers from "@/pages/TeamUsers";
import AccessDenied from "@/pages/AccessDenied";
import ProfilePage from "@/pages/Profile";
import CustomerDetail from "@/pages/CustomerDetail";
import LeadDetail from "@/pages/LeadDetail";
import NotFound from "@/pages/not-found";
import { AUTOMATION_ROUTES } from "@/lib/automation-routes";
import { canAccessPage, hasClientCapability } from "@/lib/rbac";
import {
  AUTH_INVALID_EVENT, authScopeFingerprint, mandatoryAuthScopeQueryHash,
  setActiveAuthScopeFingerprint, AUTH_REVALIDATE_EVENT,
} from "@/lib/auth-scope";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      queryKeyHashFn: mandatoryAuthScopeQueryHash,
    },
  },
});

function loginErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { status?: number; data?: { error?: string } | null };
    if (e.data && typeof e.data === "object" && typeof e.data.error === "string" && e.data.error) {
      return e.data.error;
    }
    if (e.status === 401) return "Invalid username or password";
    if (e.status === 429) return "Too many login attempts. Please try again in a few minutes.";
  }
  return "Login failed. Please try again.";
}

function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useLoginWithPassword({
    mutation: {
      onSuccess: () => {
        // Session cookie is set — reload so the auth gate re-checks.
        window.location.reload();
      },
      onError: (err: unknown) => {
        setError(loginErrorMessage(err));
      },
    },
  });

  const submitting = loginMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !username.trim() || !password) return;
    setError(null);
    loginMutation.mutate({ data: { username: username.trim(), password } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-5 max-w-sm w-full">
        <img src="/images/superior-logo.png" alt="Superior Professional Window Cleaning" className="h-20 w-auto object-contain" />
        <div className="text-center -mt-1">
          <p className="text-slate-400 text-sm">Window Cleaning Business Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="w-full space-y-3 pt-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            data-testid="input-username"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            data-testid="input-password"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50"
          />
          {error && (
            <p data-testid="text-login-error" role="alert" className="text-sm text-red-600 text-center">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            data-testid="button-login"
            className="w-full flex items-center justify-center gap-2.5 bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl py-3.5 px-6 font-bold transition-colors shadow-md shadow-primary/25 text-[15px]"
          >
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="w-full flex items-center gap-3">
          <div className="flex-1 border-t border-slate-100" />
          <span className="text-[11px] uppercase tracking-wide text-slate-300">or</span>
          <div className="flex-1 border-t border-slate-100" />
        </div>

        <div className="w-full space-y-3">
          <button
            onClick={login}
            data-testid="button-replit-login"
            className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl py-3 px-6 font-semibold transition-colors text-[14px]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
            </svg>
            Sign in with Replit
          </button>
          <p className="text-xs text-center text-slate-400">
            Access is restricted to authorized team members.
          </p>
        </div>

        <div className="w-full border-t border-slate-100 pt-4 space-y-1.5">
          {[
            "Customers, properties & quotes",
            "Jobs, scheduling & crew management",
            "Invoices & payment tracking",
            "Recurring plans & automations",
          ].map((f) => (
            <div key={f} className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-xs text-slate-500">{f}</span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-slate-300 text-center">
          Created by: Lute Atieh &nbsp;·&nbsp; Rev {APP_VERSION}
        </p>
      </div>
    </div>
  );
}

function Router({ user }: { user: AuthUser }) {
  useNavigationTracker();
  const [location] = useLocation();
  if (
    location === "/"
    && !hasClientCapability(user, "dashboard.view")
    && hasClientCapability(user, "jobs.view")
  ) {
    return <Redirect to="/jobs" />;
  }
  if (!canAccessPage(location, user)) {
    return <AccessDenied role={user.role} />;
  }
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/leads/:id" component={LeadDetail} />
      <Route path="/leads">{() => <Customers mode="prospects" />}</Route>
      <Route path="/prospects/:id" component={CustomerDetail} />
      <Route path="/prospects">{() => <Customers mode="prospects" />}</Route>
      <Route path="/tasks" component={Tasks} />
      <Route path="/customers">{() => <Customers />}</Route>
      <Route path="/properties" component={Properties} />
      <Route path="/services" component={Services} />
      <Route path="/quotes" component={Quotes} />
      <Route path="/quotes/new" component={QuoteNew} />
      <Route path="/quotes/:id/print" component={QuotePrint} />
      <Route path="/quotes/:id" component={QuoteDetail} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/jobs/new" component={JobNew} />
      <Route path="/jobs/:id" component={JobDetail} />
      <Route path="/recurring-plans" component={RecurringPlans} />
      <Route path="/recurring-plans/new" component={RecurringPlanNew} />
      <Route path="/recurring-plans/:id" component={RecurringPlanDetail} />
      {/* Reserved paths must stay ahead of the dynamic automation ID route. */}
      <Route path={AUTOMATION_ROUTES.health} component={AutomationHealth} />
      <Route path={AUTOMATION_ROUTES.index} component={Automations} />
      <Route path={AUTOMATION_ROUTES.new} component={AutomationNew} />
      <Route path={AUTOMATION_ROUTES.detail} component={AutomationDetail} />
      <Route path="/payments" component={Payments} />
      <Route path="/payments/approvals" component={ApprovalInbox} />
      <Route path="/reports/reconciliation" component={FinancialReconciliation} />
      <Route path="/communications" component={Communications} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/invoices/:id" component={InvoiceDetail} />
      <Route path="/crews" component={Crews} />
      <Route path="/customers/:id" component={CustomerDetail} />
      <Route path="/settings" component={Settings} />
      <Route path="/settings/financial-permissions" component={FinancialPermissions} />
      <Route path="/admin/import" component={AdminImport} />
      <Route path="/admin" component={Admin} />
      <Route path="/team-users" component={TeamUsers} />
      <Route path="/profile" component={ProfilePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const { user, isLoading, isAuthenticated } = auth;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const publicPath = window.location.pathname.startsWith(base)
    ? window.location.pathname.slice(base.length) || "/"
    : window.location.pathname;

  if (/^\/estimate\/[^/]+$/.test(publicPath)) {
    return (
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Route path="/estimate/:token" component={PublicEstimate} />
      </WouterRouter>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router user={user!} />
    </WouterRouter>
  );
}

function UserScopedAuthGate() {
  const auth = useAuth();
  const { user, isLoading } = auth;
  const fingerprint = authScopeFingerprint(user);
  const signature = isLoading ? "loading" : fingerprint ?? "anonymous";
  const [readySignature, setReadySignature] = useState<string | null>(null);
  useLayoutEffect(() => {
    // clear() synchronously cancels observers and removes both query and
    // mutation caches before a differently-authorized tree can mount.
    setActiveAuthScopeFingerprint(fingerprint);
    queryClient.clear();
    setReadySignature(signature);
  }, [signature]);
  useLayoutEffect(() => {
    const deny = () => {
      setActiveAuthScopeFingerprint(null);
      queryClient.clear();
      setReadySignature(null);
      void revalidateAuth().then(() => setReadySignature(signature));
    };
    window.addEventListener(AUTH_INVALID_EVENT, deny);
    return () => window.removeEventListener(AUTH_INVALID_EVENT, deny);
  }, [signature]);
  useLayoutEffect(() => {
    // A 403 is normally a page-level authorization error. Revalidation only
    // purges/remounts when the auth envelope actually transitions.
    const revalidate = () => { void revalidateAuth(); };
    window.addEventListener(AUTH_REVALIDATE_EVENT, revalidate);
    return () => window.removeEventListener(AUTH_REVALIDATE_EVENT, revalidate);
  }, []);
  if (readySignature !== signature) {
    return <div className="min-h-screen bg-slate-50" aria-label="Loading access" />;
  }
  return <AuthGate key={signature} auth={auth} />;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <UserScopedAuthGate />
          <SandboxEnvironmentLabel />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
