import type { EmailStatus } from '../types';

const labels: Record<EmailStatus, string> = {
  SCHEDULED: 'Scheduled',
  SENT: 'Sent',
  PROCESSING: 'Sending',
  FAILED: 'Failed',
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{labels[status]}</span>;
}
