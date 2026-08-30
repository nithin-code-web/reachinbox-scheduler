import { useCallback, useEffect, useMemo, useState } from 'react';
import { ComposeEmail } from './components/ComposeEmail';
import { EmailDetail } from './components/EmailDetail';
import { EmailList } from './components/EmailList';
import { ErrorState } from './components/ErrorState';
import { Icon } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { api, googleLoginUrl, isApiError } from './services/api';
import type { CampaignDraft, EmailRecord, Mailbox, Sender, User } from './types';

function LoginScreen({ notice, onEmailAttempt }: { notice: string | null; onEmailAttempt: () => void }) {
  return <main className="login-page"><div className="login-card"><div className="login-brand"><span className="brand-symbol">R</span><span>ReachInbox</span></div><h1>Welcome back</h1><p className="login-intro">Log in to keep your outreach moving.</p><a className="google-button" href={googleLoginUrl}><span className="google-icon">G</span>Continue with Google</a><div className="login-divider"><span>or continue with email</span></div><form onSubmit={(event) => { event.preventDefault(); onEmailAttempt(); }}><label htmlFor="login-email">Email</label><input id="login-email" placeholder="you@company.com" type="email" /><label htmlFor="login-password">Password</label><input id="login-password" placeholder="••••••••" type="password" /><button className="button button-primary login-submit" type="submit">Log in</button></form>{notice ? <p className="login-form-notice" role="status">{notice}</p> : <p className="login-note">Use Google to sign in securely.</p>}</div></main>;
}

function Topbar({ mailbox, query, onQueryChange, onMenu }: { mailbox: Mailbox; query: string; onQueryChange: (query: string) => void; onMenu: () => void }) {
  return <header className="topbar"><button aria-label="Open navigation" className="mobile-menu icon-button" onClick={onMenu} type="button"><Icon name="menu" size={20} /></button><div><p className="eyebrow">Mailbox</p><h1>{mailbox === 'scheduled' ? 'Scheduled' : 'Sent'}</h1></div><div className="topbar-search"><Icon name="search" size={17} /><input aria-label="Search emails" onChange={(event) => onQueryChange(event.target.value)} placeholder="Search emails" value={query} /><kbd>⌘ K</kbd></div><div className="topbar-avatar avatar">O</div></header>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [view, setView] = useState<Mailbox>('scheduled');
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailRecord[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [mailboxLoading, setMailboxLoading] = useState(false);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMailbox = useCallback(async (mailbox: Mailbox, searchQuery: string, requestedPage: number) => {
    setMailboxLoading(true);
    setMailboxError(null);
    try {
      if (searchQuery.trim()) {
        const result = await api.searchEmails({ q: searchQuery.trim(), status: mailbox === 'scheduled' ? 'SCHEDULED' : 'SENT', page: requestedPage, limit: 20 });
        if (mailbox === 'scheduled') setEmails(result.items);
        else setSentEmails(result.items);
        setTotalResults(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
        setPage(result.pagination.page);
      } else if (mailbox === 'scheduled') {
        const result = await api.scheduledEmails();
        setEmails(result);
        setTotalResults(result.length);
        setTotalPages(1);
        setPage(1);
      } else {
        const result = await api.sentEmails();
        setSentEmails(result);
        setTotalResults(result.length);
        setTotalPages(1);
        setPage(1);
      }
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        setUser(null);
      } else {
        setMailboxError(error instanceof Error ? error.message : 'Could not load emails.');
      }
    } finally {
      setMailboxLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.currentUser().then((currentUser) => {
      if (!cancelled) setUser(currentUser);
    }).catch((error: unknown) => {
      if (!cancelled) setAuthError(error instanceof Error ? error.message : 'Could not check your session.');
    }).finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api.senders().then((availableSenders) => { if (!cancelled) setSenders(availableSenders); }).catch(() => { if (!cancelled) setSenders([]); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => { void loadMailbox(view, query, query.trim() ? page : 1); }, query.trim() ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [user, view, query, page, loadMailbox]);

  const visibleEmails = useMemo(() => view === 'scheduled' ? emails : sentEmails, [emails, sentEmails, view]);

  const handleLogout = () => {
    void api.logout().then(() => { setUser(null); setEmails([]); setSentEmails([]); }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Could not log out.'));
  };

  const handleSubmit = (draft: CampaignDraft) => {
    setSubmitting(true);
    setComposeError(null);
    void api.sendCampaign(draft).then(async () => {
      setComposeOpen(false);
      setNotice(`${draft.recipients.length} email${draft.recipients.length === 1 ? '' : 's'} scheduled`);
      await loadMailbox('scheduled', '', 1);
      window.setTimeout(() => setNotice(null), 3000);
    }).catch((error: unknown) => setComposeError(error instanceof Error ? error.message : 'Could not schedule the campaign.')).finally(() => setSubmitting(false));
  };

  if (authLoading) return <div className="screen-state"><div className="loading-orb" /><span>Checking your session</span></div>;
  if (authError) return <ErrorState message={authError} onRetry={() => window.location.reload()} />;
  if (!user) return <LoginScreen notice={loginNotice} onEmailAttempt={() => setLoginNotice('Email login is not enabled. Continue with Google.')} />;

  return <div className="app-shell"><div className={`mobile-overlay ${sidebarOpen ? 'mobile-overlay-visible' : ''}`} onClick={() => setSidebarOpen(false)} /><div className={sidebarOpen ? 'sidebar-wrap sidebar-wrap-open' : 'sidebar-wrap'}><Sidebar collapsed={false} onCompose={() => { setComposeOpen(true); setSidebarOpen(false); setComposeError(null); }} onLogout={handleLogout} onViewChange={(nextView) => { setView(nextView); setSelectedEmail(null); setPage(1); setSidebarOpen(false); }} scheduledCount={emails.length} sentCount={sentEmails.length} user={user} view={view} /></div><main className="main-content">{composeOpen ? <ComposeEmail error={composeError} onClose={() => setComposeOpen(false)} onSubmit={handleSubmit} senders={senders} submitting={submitting} /> : selectedEmail ? <EmailDetail email={selectedEmail} onBack={() => setSelectedEmail(null)} /> : <><Topbar mailbox={view} onMenu={() => setSidebarOpen(true)} onQueryChange={(nextQuery) => { setQuery(nextQuery); setPage(1); }} query={query} /><section className="mailbox-content"><div className="list-meta"><div><span className="result-count">{totalResults} messages</span><span className="meta-dot">·</span><span>{query.trim() ? 'Search results' : 'Updated just now'}</span></div><button className="filter-button" type="button"><Icon name="settings" size={15} /> {view === 'scheduled' ? 'Scheduled' : 'Sent'}</button></div>{mailboxLoading ? <div className="inline-loading"><div className="loading-orb" /> Loading emails</div> : mailboxError ? <ErrorState message={mailboxError} onRetry={() => void loadMailbox(view, query, query.trim() ? page : 1)} /> : <EmailList emails={visibleEmails} mailbox={view} onSelect={setSelectedEmail} />}{query.trim() && totalPages > 1 && <div className="pagination"><button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button"><Icon name="arrow-left" size={15} /></button><span>Page {page} of {totalPages}</span><button aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} type="button"><Icon name="arrow-right" size={15} /></button></div>}</section></>}</main>{notice && <div className="toast"><span className="toast-check">✓</span>{notice}</div>}</div>;
}
