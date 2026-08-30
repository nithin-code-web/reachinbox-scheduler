import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';
import type { EmailRecord } from '../types';

export function EmailDetail({ email, onBack }: { email: EmailRecord; onBack: () => void }) {
  const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(email.sentAt ?? email.scheduledAt));
  return (
    <section className="detail-panel">
      <div className="detail-toolbar"><button className="icon-button" onClick={onBack} type="button"><Icon name="arrow-left" size={19} /></button><span>Email details</span><div className="toolbar-actions"><button className="icon-button" type="button"><Icon name="star" size={18} /></button><button className="icon-button" type="button"><Icon name="trash" size={18} /></button></div></div>
      <div className="detail-heading"><div><StatusBadge status={email.status} /><h1>{email.subject ?? 'Subject unavailable'}</h1></div><span className="detail-date">{date}</span></div>
      <div className="detail-sender"><div className="avatar avatar-medium"><Icon name="user" size={18} /></div><div><strong>Sender details unavailable</strong><span>Not included in the current email list response</span></div><span className="detail-to">to {email.recipient}</span></div>
      <div className="message-unavailable"><Icon name="mail" size={22} /><strong>Message content unavailable</strong><p>The current backend email endpoints provide delivery metadata only.</p></div>
    </section>
  );
}
