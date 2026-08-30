import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';
import type { EmailRecord, Mailbox } from '../types';

function formatTime(value: string, mailbox: Mailbox) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(mailbox === 'sent' ? { month: 'short', day: 'numeric' } : {}) }).format(new Date(value));
}

export function EmailList({ emails, mailbox, selectedId, onSelect }: { emails: EmailRecord[]; mailbox: Mailbox; selectedId?: string; onSelect: (email: EmailRecord) => void }) {
  if (!emails.length) {
    return <div className="empty-state"><div className="empty-icon"><Icon name="mail" size={22} /></div><h3>No {mailbox} emails</h3><p>Emails you {mailbox === 'scheduled' ? 'schedule' : 'send'} will show up here.</p></div>;
  }

  return (
    <div className="email-list" role="list">
      {emails.map((email) => (
        <button className={`email-row ${selectedId === email.id ? 'email-row-selected' : ''}`} key={email.id} onClick={() => onSelect(email)} role="listitem" type="button">
          <div className="avatar">{email.recipient.slice(0, 1).toUpperCase()}</div>
          <div className="email-row-main">
            <div className="email-row-top"><strong>{email.recipient}</strong><span>{formatTime(email.sentAt ?? email.scheduledAt, mailbox)}</span></div>
            <div className="email-row-subject">{email.subject}</div>
            <p>{email.preview}</p>
          </div>
          <div className="email-row-actions"><StatusBadge status={email.status} /><Icon name="star" size={18} /></div>
        </button>
      ))}
    </div>
  );
}
