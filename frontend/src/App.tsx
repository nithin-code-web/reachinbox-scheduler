import { useEffect, useMemo, useState } from 'react';
import { ComposeEmail } from './components/ComposeEmail';
import { EmailDetail } from './components/EmailDetail';
import { EmailList } from './components/EmailList';
import { ErrorState } from './components/ErrorState';
import { Icon } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { api, googleLoginUrl } from './services/api';
import type { CampaignDraft, EmailRecord, Mailbox, Sender, User } from './types';

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <main className="login-page"><div className="login-card"><div className="login-brand"><span className="brand-symbol">R</span><span>ReachInbox</span></div><h1>Login</h1><a className="google-button" href={googleLoginUrl}><span className="google-icon">G</span>Login with Google</a><div className="login-divider"><span>or sign up through email</span></div><form onSubmit={(event) => { event.preventDefault(); onLogin(); }}><label htmlFor="login-email">Email ID</label><input id="login-email" placeholder="you@company.com" type="email" /><label htmlFor="login-password">Password</label><input id="login-password" placeholder="••••••••" type="password" /><button className="button button-primary login-submit" type="submit">Login</button></form></div></main>
  );
}

function Topbar({ mailbox, query, onQueryChange, onMenu }: { mailbox: Mailbox; query: string; onQueryChange: (query: string) => void; onMenu: () => void }) {
  return <header className="topbar"><button aria-label="Open navigation" className="mobile-menu icon-button" onClick={onMenu} type="button"><Icon name="menu" size={20} /></button><div><p className="eyebrow">Mailbox</p><h1>{mailbox === 'scheduled' ? 'Scheduled' : 'Sent'}</h1></div><div className="topbar-search"><Icon name="search" size={17} /><input aria-label="Search emails" onChange={(event) => onQueryChange(event.target.value)} placeholder="Search emails" value={query} /><kbd>⌘ K</kbd></div><button className="topbar-avatar avatar" type="button">O</button></header>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<Mailbox>('scheduled');
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailRecord[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api.currentUser(), api.scheduledEmails(), api.sentEmails(), api.senders()]).then(([currentUser, scheduled, sent, availableSenders]) => {
      setUser(currentUser);
      setEmails(scheduled);
      setSentEmails(sent);
      setSenders(availableSenders);
    }).catch(() => setLoadError('We could not load your mailbox.')).finally(() => setLoading(false));
  }, []);

  const visibleEmails = useMemo(() => {
    const source = view === 'scheduled' ? emails : sentEmails;
    const normalized = query.trim().toLowerCase();
    if (!normalized) return source;
    return source.filter((email) => `${email.recipient} ${email.subject} ${email.preview}`.toLowerCase().includes(normalized));
  }, [emails, sentEmails, view, query]);

  const handleLogout = () => { void api.logout().finally(() => setUser(null)); };
  const handleSubmit = (draft: CampaignDraft) => {
    void api.sendCampaign(draft).then(() => { setComposeOpen(false); setNotice(`${draft.recipients.length} email${draft.recipients.length === 1 ? '' : 's'} scheduled`); window.setTimeout(() => setNotice(null), 3000); });
  };

  if (loading) return <div className="screen-state"><div className="loading-orb" /><span>Loading your mailbox</span></div>;
  if (loadError) return <ErrorState message={loadError} onRetry={() => window.location.reload()} />;
  if (!user) return <LoginScreen onLogin={() => { setUser({ id: 'demo-user', name: 'Olivia Rhye', email: 'olivia@reachinbox.com' }); }} />;

  return <div className="app-shell">
    <div className={`mobile-overlay ${sidebarOpen ? 'mobile-overlay-visible' : ''}`} onClick={() => setSidebarOpen(false)} />
    <div className={sidebarOpen ? 'sidebar-wrap sidebar-wrap-open' : 'sidebar-wrap'}><Sidebar collapsed={false} onCompose={() => { setComposeOpen(true); setSidebarOpen(false); }} onLogout={handleLogout} onViewChange={(nextView) => { setView(nextView); setSelectedEmail(null); setSidebarOpen(false); }} scheduledCount={emails.length} sentCount={sentEmails.length} user={user} view={view} /></div>
    <main className="main-content">
      {composeOpen ? <ComposeEmail onClose={() => setComposeOpen(false)} onSubmit={handleSubmit} senders={senders} /> : selectedEmail ? <EmailDetail email={selectedEmail} onBack={() => setSelectedEmail(null)} /> : <><Topbar mailbox={view} onMenu={() => setSidebarOpen(true)} onQueryChange={setQuery} query={query} /><section className="mailbox-content"><div className="list-meta"><div><span className="result-count">{visibleEmails.length} messages</span><span className="meta-dot">·</span><span>Updated just now</span></div><button className="filter-button" type="button"><Icon name="settings" size={15} /> Filters</button></div><EmailList emails={visibleEmails} mailbox={view} onSelect={setSelectedEmail} /></section></>}
    </main>
    {notice && <div className="toast"><span className="toast-check">✓</span>{notice}</div>}
  </div>;
}
