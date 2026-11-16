import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckSquare,
  Compass,
  Database,
  Globe,
  LayoutDashboard,
  LogOut,
  Mail,
  MailCheck,
  Menu,
  Moon,
  Plug,
  Send,
  Settings,
  ShieldAlert,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { api, clearSessionToken, hasPermission, isAdmin, isSuperAdmin } from './lib/api';
import type {
  AgentConfig,
  AppSettings,
  DashboardMetrics,
  LeadRecord,
  PlatformConnector,
  ServiceCategory,
  UserAccount,
  UserPermissions,
} from '../shared/types';
import { LoginScreen } from './components/LoginScreen';
import { OverviewPage } from './components/OverviewPage';
import { DiscoveryPage } from './components/DiscoveryPage';
import { TargetCountriesPage } from './components/TargetCountriesPage';
import { LeadsDatabasePage } from './components/LeadsPages';
import { AiEmailWriterPage } from './components/AiEmailWriterPage';
import { EmailApprovalCenterPage } from './components/EmailApprovalCenterPage';
import { EmailAccountsPage } from './components/EmailAccountsPage';
import { EmailAnalyticsPage, EmailCampaignsPage } from './components/EmailCampaignsAnalyticsPage';
import { InvitedUsersPage } from './components/InvitedUsersPage';
import { FollowUpManagerPage, OutreachGeneratorPage } from './components/OutreachCrmPages';
import { SettingsPage, SystemLogsPage } from './components/SystemPages';
import { IntegrationsAppsPage } from './components/IntegrationsAppsPage';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPerm?: keyof UserPermissions;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Module 11: Exact 14 Navigation Items
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Discovery & Targeting',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'discovery', label: 'Global Lead Discovery', icon: Compass, requiredPerm: 'can_discover' },
      { id: 'target_countries', label: 'Target Countries', icon: Globe },
      { id: 'leads_database', label: 'Leads Database', icon: Database },
    ],
  },
  {
    label: 'AI Email Outreach',
    items: [
      { id: 'email_writer', label: 'AI Email Writer', icon: Mail, requiredPerm: 'can_generate_emails' },
      { id: 'email_approval', label: 'Email Approval Center', icon: CheckSquare, requiredPerm: 'can_approve_emails' },
      { id: 'email_accounts', label: 'Email Accounts', icon: MailCheck, requiredPerm: 'can_connect_email_accounts' },
      { id: 'email_campaigns', label: 'Email Campaigns', icon: Send },
      { id: 'follow_ups', label: 'Follow-up Manager', icon: Activity },
      { id: 'email_analytics', label: 'Email Analytics', icon: BarChart3, requiredPerm: 'can_view_analytics' },
    ],
  },
  {
    label: 'Team & Administration',
    items: [
      { id: 'invited_users', label: 'Invited Users', icon: Users, adminOnly: true },
      { id: 'integrations', label: 'Integrations & Connected Apps', icon: Plug, superAdminOnly: true },
      { id: 'system_logs', label: 'System Logs', icon: ShieldAlert },
      { id: 'owner_settings', label: 'Owner Settings', icon: Settings },
    ],
  },
];

const EXTRA_PAGE_LABELS: Record<string, string> = {
  lead_details: 'Leads Database / Details',
  outreach_gen: '5-Channel Outreach Generator',
};

const PAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label]))),
  ...EXTRA_PAGE_LABELS,
};

export default function App() {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [dark, setDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [activePage, setActivePage] = useState<string>('overview');
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [leadsSubTab, setLeadsSubTab] = useState<'all' | 'details' | undefined>(undefined);

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [services, setServices] = useState<ServiceCategory[]>([]);
  const [platforms, setPlatforms] = useState<PlatformConnector[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [usersList, setUsersList] = useState<UserAccount[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    if (!user) return;
    try {
      const [mRes, lRes, sRes, pRes, aRes, cfgRes, uRes] = await Promise.all([
        api.getMetrics(),
        api.getLeads(),
        api.getServices(),
        api.getPlatforms(),
        api.getAgents(),
        api.getSettings(),
        isAdmin(user) ? api.getUsers().catch(() => ({ users: [] })) : Promise.resolve({ users: [] }),
      ]);
      setMetrics(mRes);
      setLeads(lRes.leads);
      setServices(sRes.services);
      setPlatforms(pRes.platforms);
      setAgents(aRes.agents);
      setSettings(cfgRes.settings);
      setUsersList(uRes.users || []);
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('authentication') || msg.includes('401') || msg.includes('suspended')) {
        clearSessionToken();
        setUser(null);
        return;
      }
      console.error('Failed to load workspace:', err);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadWorkspaceData();
    }
  }, [user, loadWorkspaceData]);

  function navigateTo(page: string, leadId?: number) {
    if (leadId !== undefined) setSelectedLeadId(leadId);
    if (page === 'lead_details') {
      setLeadsSubTab('details');
      setActivePage('leads_database');
    } else if (page === 'leads_database') {
      setLeadsSubTab('all');
      setActivePage('leads_database');
    } else {
      setActivePage(page);
    }
    setSidebarOpen(false);
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
  }

  async function handleSaveSettings(patch: Partial<AppSettings>) {
    const res = await api.updateSettings(patch);
    setSettings(res.settings);
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F19] text-xs text-slate-500">
        Initializing AI BUYER HUNTER session...
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onSuccess={(u) => setUser(u)} />;
  }

  function isNavVisible(item: NavItem): boolean {
    if (!user) return false;
    if (item.superAdminOnly && !isSuperAdmin(user)) return false;
    if (item.adminOnly && !isAdmin(user)) return false;
    if (item.requiredPerm && !hasPermission(user, item.requiredPerm)) return false;
    return true;
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation (256px) — Exact 14-item architecture */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform duration-150 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-14 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="font-display font-bold text-sm tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            AI BUYER HUNTER
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-slate-500 hover:text-slate-900"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter(isNavVisible);
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="px-2.5 mb-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const active = activePage === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigateTo(item.id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs rounded-md transition-colors text-left ${
                          active
                            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{user.name}</div>
            <div className="text-[11px] text-slate-500 truncate">
              {user.is_owner || user.role === 'super_admin' ? 'Super Admin (Owner)' : `Invited · ${user.role}`}
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-1.5 text-slate-500 hover:text-red-600 rounded hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header Bar */}
        <header className="h-14 px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              <span>AI BUYER HUNTER</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {PAGE_LABELS[activePage] || 'Workspace'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setDark(!dark)}
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
              title="Toggle Light / Dark Mode"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {hasPermission(user, 'can_approve_emails') && (
              <button
                onClick={() => navigateTo('email_approval')}
                className="px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap shrink-0"
              >
                Approval Center
              </button>
            )}
            {hasPermission(user, 'can_discover') && (
              <button
                onClick={() => navigateTo('discovery')}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
              >
                New Discovery
              </button>
            )}
          </div>
        </header>

        {/* Active Page Viewport */}
        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
          {activePage === 'overview' && (
            <OverviewPage
              metrics={metrics}
              settings={settings}
              recentLeads={leads}
              onNavigate={navigateTo}
            />
          )}

          {activePage === 'discovery' && (
            <DiscoveryPage
              services={services}
              platforms={platforms}
              user={user}
              onDiscoveryComplete={(leadId) => {
                loadWorkspaceData();
                if (leadId) navigateTo('lead_details', leadId);
              }}
              onOpenIntegrations={() => navigateTo('integrations')}
            />
          )}

          {activePage === 'target_countries' && <TargetCountriesPage />}

          {activePage === 'leads_database' && (
            <LeadsDatabasePage
              leads={leads}
              services={services}
              user={user}
              usersList={usersList}
              selectedLeadId={selectedLeadId}
              initialTab={leadsSubTab}
              onSelectLead={(id) => setSelectedLeadId(id)}
              onUpdateServices={(s) => setServices(s)}
              onRefresh={loadWorkspaceData}
              onNavigateDiscovery={() => navigateTo('discovery')}
              onOpenOutreach={(id) => navigateTo('outreach_gen', id)}
              onOpenAiEmailWriter={(id) => navigateTo('email_writer', id)}
            />
          )}

          {activePage === 'email_writer' && (
            <AiEmailWriterPage
              leads={leads}
              selectedLeadId={selectedLeadId}
              user={user}
              onNavigateApproval={() => navigateTo('email_approval')}
            />
          )}

          {activePage === 'email_approval' && (
            <EmailApprovalCenterPage user={user} onRefreshWorkspace={loadWorkspaceData} />
          )}

          {activePage === 'email_accounts' && <EmailAccountsPage user={user} />}

          {activePage === 'email_campaigns' && (
            <EmailCampaignsPage services={services} user={user} />
          )}

          {activePage === 'invited_users' && <InvitedUsersPage user={user} />}

          {activePage === 'follow_ups' && (
            <FollowUpManagerPage
              leads={leads}
              user={user}
              onRefresh={loadWorkspaceData}
              onNavigateApproval={() => navigateTo('email_approval')}
            />
          )}

          {activePage === 'email_analytics' && (
            <EmailAnalyticsPage
              services={services}
              user={user}
              metrics={metrics}
              settings={settings}
            />
          )}

          {activePage === 'outreach_gen' && (
            <OutreachGeneratorPage
              leads={leads}
              selectedLeadId={selectedLeadId}
              user={user}
              onRefresh={loadWorkspaceData}
            />
          )}

          {activePage === 'integrations' && (
            <IntegrationsAppsPage
              platforms={platforms}
              user={user}
              settings={settings}
              onUpdatePlatforms={(p) => setPlatforms(p)}
              onSaveSettings={handleSaveSettings}
            />
          )}

          {activePage === 'system_logs' && <SystemLogsPage user={user} />}

          {activePage === 'owner_settings' && (
            <SettingsPage
              settings={settings}
              user={user}
              agents={agents}
              onSaveSettings={handleSaveSettings}
              onUpdateAgents={(a) => setAgents(a)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
