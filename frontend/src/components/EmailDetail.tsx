import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';
import type { EmailRecord } from '../types';

export function EmailDetail({ email, onBack }: { email: EmailRecord; onBack: () => void }) {
  const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(email.sentAt ?? email.scheduledAt));
  return (
    <section className="detail-panel">
      <div className="detail-toolbar"><button className="icon-button" onClick={onBack} type="button"><Icon name="arrow-left" size={19} /></button><span>Email details</span><div className="toolbar-actions"><button className="icon-button" type="button"><Icon name="star" size={18} /></button><button className="icon-button" type="button"><Icon name="trash" size={18} /></button></div></div>
      <div className="detail-heading"><div><StatusBadge status={email.status} /><h1>{email.subject}</h1></div><span className="detail-date">{date}</span></div>
      <div className="detail-sender"><div className="avatar avatar-medium">{email.senderName.slice(0, 1)}</div><div><strong>{email.senderName}</strong><span>{email.senderEmail}</span></div><span className="detail-to">to {email.recipient}</span></div>
      <div className="message-content">{email.body.split('\n').map((paragraph, index) => paragraph ? <p key={`${email.id}-${index}`}>{paragraph}</p> : <div className="message-gap" key={`${email.id}-gap-${index}`} />)}<div className="highlight-block">A thoughtful message, sent at exactly the right time.</div></div>
      <div className="attachment-preview"><div className="attachment-thumb"><Icon name="image" size={24} /></div><div><strong>Message preview</strong><span>ReachInbox campaign attachment</span></div><button className="icon-button" type="button"><Icon name="arrow-right" size={17} /></button></div>
    </section>
  );
}
