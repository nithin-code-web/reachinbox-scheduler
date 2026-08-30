import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { Icon } from './Icon';
import type { CampaignDraft, Sender } from '../types';
import { isValidEmail, localDateTimeInputValue, parseRecipientText } from '../utils/recipients';

interface ComposeEmailProps {
  senders: Sender[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: CampaignDraft) => void;
}

const defaultStartTime = () => localDateTimeInputValue(new Date(Date.now() + 1000 * 60 * 15));

function tomorrowAt(hour: number, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return localDateTimeInputValue(date);
}

export function ComposeEmail({ senders, submitting, error, onClose, onSubmit }: ComposeEmailProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [senderId, setSenderId] = useState(senders[0]?.id ?? '');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(30);
  const [hourlyLimit, setHourlyLimit] = useState(50);
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [recipientWarning, setRecipientWarning] = useState<string | null>(null);

  const addRecipient = (value: string) => {
    const email = value.trim().replace(/,$/, '');
    if (!email) return;
    if (!isValidEmail(email)) {
      setRecipientWarning(`${email} is not a valid email address.`);
    } else if (!recipients.includes(email)) {
      setRecipients((current) => [...current, email]);
      setRecipientWarning(null);
    }
    setRecipientInput('');
  };

  const handleRecipientKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      event.preventDefault();
      addRecipient(recipientInput);
    }
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseRecipientText(String(reader.result));
      setRecipients((current) => [...new Set([...current, ...parsed.recipients])]);
      if (parsed.malformed.length > 0) setRecipientWarning(`${parsed.malformed.length} malformed email entr${parsed.malformed.length === 1 ? 'y was' : 'ies were'} skipped.`);
      else if (parsed.recipients.length === 0) setRecipientWarning('The selected file did not contain a valid email address.');
      else setRecipientWarning(null);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!senderId) return setFormError('Configure VITE_DEFAULT_SENDER_ID before scheduling a campaign.');
    if (!subject.trim()) return setFormError('Add a subject before scheduling.');
    if (!body.trim()) return setFormError('Add a message before scheduling.');
    if (!recipients.length) return setFormError('Add at least one valid recipient.');
    setFormError(null);
    onSubmit({ subject: subject.trim(), body: body.trim(), recipients, senderId, startTime: new Date(startTime).toISOString(), delaySeconds, hourlyLimit });
  };

  const suggestedTimes = [
    { label: 'Tomorrow, 10:00 AM', value: tomorrowAt(10) },
    { label: 'Tomorrow, 11:00 AM', value: tomorrowAt(11) },
    { label: 'Tomorrow, 3:00 PM', value: tomorrowAt(15) },
  ];

  return (
    <section className="compose-page">
      <div className="compose-topbar"><button className="back-button" onClick={onClose} type="button"><Icon name="arrow-left" size={19} /> Back</button><div className="compose-heading"><h1>Compose New Email</h1></div><div className="toolbar-actions"><button className="icon-button" type="button"><Icon name="paperclip" size={18} /></button><button className="icon-button" onClick={() => setScheduleOpen(true)} type="button"><Icon name="calendar" size={18} /></button><button className="button button-primary compose-send-btn" disabled={submitting} onClick={submit} type="button">{submitting ? 'Scheduling...' : 'Send Later'}</button></div></div>
      <form className="compose-form" onSubmit={submit}>
        <div className="form-row"><label htmlFor="from">From</label><div className="input-with-icon"><Icon name="user" size={17} /><select disabled={!senders.length} id="from" onChange={(event) => setSenderId(event.target.value)} value={senderId}>{senders.length ? senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.displayName ?? sender.email} · {sender.email}</option>) : <option value="">No sender configured</option>}</select><Icon name="chevron-down" size={16} /></div></div>
        {!senders.length && <div className="config-warning">Sender configuration is missing. Set <code>VITE_DEFAULT_SENDER_ID</code> to an owned sender UUID.</div>}
        <div className="form-row recipients-row"><label htmlFor="recipient">To</label><div className="recipient-field">{recipients.map((recipient) => <span className="recipient-chip" key={recipient}>{recipient}<button aria-label={`Remove ${recipient}`} onClick={() => setRecipients((current) => current.filter((item) => item !== recipient))} type="button"><Icon name="x" size={13} /></button></span>)}<input id="recipient" onBlur={() => addRecipient(recipientInput)} onChange={(event) => setRecipientInput(event.target.value)} onKeyDown={handleRecipientKey} placeholder={recipients.length ? 'Add another recipient' : 'recipient@example.com'} value={recipientInput} /></div><button className="upload-button" onClick={() => fileInput.current?.click()} type="button"><Icon name="upload" size={16} /> Upload List</button><input accept=".csv,.txt" className="hidden-input" onChange={handleFile} ref={fileInput} type="file" /></div>
        {recipientWarning && <div className="inline-warning">{recipientWarning}</div>}
        <div className="form-row"><label htmlFor="subject">Subject</label><input className="text-input" id="subject" onChange={(event) => setSubject(event.target.value)} placeholder="Subject" value={subject} /></div>
        <div className="settings-row"><label><span>Delay between 2 emails</span><div className="number-input"><input min="1" onChange={(event) => setDelaySeconds(Math.max(1, Number(event.target.value)))} type="number" value={delaySeconds} /><span>sec</span></div></label><label><span>Hourly Limit</span><div className="number-input"><input min="1" onChange={(event) => setHourlyLimit(Math.max(1, Number(event.target.value)))} type="number" value={hourlyLimit} /><span>emails / hr</span></div></label></div>
        <div className="editor-shell"><div className="editor-toolbar"><button type="button"><strong>B</strong></button><button className="italic" type="button">I</button><button className="underline" type="button">U</button><span className="editor-divider" /><button type="button">☷</button><button type="button">↗</button><button type="button"><Icon name="paperclip" size={16} /></button></div><textarea aria-label="Message body" onChange={(event) => setBody(event.target.value)} placeholder="Type Your Reply..." value={body} /></div>
        <div className="attachment-drop"><Icon name="image" size={21} /><div><strong>Drop an image or attachment here</strong><span>Attachments are not sent by the current backend contract.</span></div></div>
        {(formError || error) && <div className="form-error" role="alert">{error ?? formError}</div>}
      </form>
      {scheduleOpen && <div className="schedule-overlay" onClick={() => setScheduleOpen(false)}><div className="schedule-panel" onClick={(event) => event.stopPropagation()}><div className="schedule-panel-header"><strong>Send Later</strong></div><div className="schedule-date-row"><Icon name="calendar" size={15} /><span>Pick date &amp; time</span><input className="schedule-date-input" id="start-time" onChange={(event) => setStartTime(event.target.value)} type="datetime-local" value={startTime} /></div><div className="schedule-time-list"><div className="schedule-date-label">Tomorrow</div>{suggestedTimes.map((slot) => <button className={`schedule-time-slot${startTime === slot.value ? ' schedule-time-slot-active' : ''}`} key={slot.label} onClick={() => setStartTime(slot.value)} type="button">{slot.label}</button>)}</div><div className="schedule-panel-actions"><button className="sched-cancel" onClick={() => setScheduleOpen(false)} type="button">Cancel</button><button className="button button-primary sched-done" onClick={() => setScheduleOpen(false)} type="button">Done</button></div></div></div>}
    </section>
  );
}
