import { Icon } from './Icon';
import type { Mailbox, User } from '../types';

interface SidebarProps {
  user: User;
  view: Mailbox;
  scheduledCount: number;
  sentCount: number;
  collapsed: boolean;
  onViewChange: (view: Mailbox) => void;
  onCompose: () => void;
  onLogout: () => void;
}

export function Sidebar({ user, view, scheduledCount, sentCount, collapsed, onViewChange, onCompose, onLogout }: SidebarProps) {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="brand-mark">
        <span className="brand-symbol">R</span>
        {!collapsed && <span>ReachInbox</span>}
      </div>

      <div className="profile-block">
        <div className="avatar avatar-large">{user.name.slice(0, 1)}</div>
        {!collapsed && (
          <div className="profile-copy">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        )}
      </div>

      <button className="compose-button" onClick={onCompose} type="button">
        <Icon name="plus" size={17} />
        {!collapsed && <span>Compose</span>}
      </button>

      <div className="nav-label">{!collapsed && 'Mailbox'}</div>
      <nav aria-label="Mailbox navigation" className="sidebar-nav">
        <button className={view === 'scheduled' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => onViewChange('scheduled')} type="button">
          <Icon name="clock" size={18} />
          {!collapsed && <><span>Scheduled</span><span className="nav-count">{scheduledCount}</span></>}
        </button>
        <button className={view === 'sent' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => onViewChange('sent')} type="button">
          <Icon name="send" size={18} />
          {!collapsed && <><span>Sent</span><span className="nav-count">{sentCount}</span></>}
        </button>
      </nav>

      <div className="sidebar-footer">
        <button className="nav-item" type="button"><Icon name="settings" size={18} />{!collapsed && <span>Settings</span>}</button>
        {!collapsed && <button className="logout-link" onClick={onLogout} type="button">Log out</button>}
      </div>
    </aside>
  );
}
