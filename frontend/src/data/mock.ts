import type { EmailRecord, Sender, User } from '../types';

export const mockUser: User = {
  id: 'demo-user',
  name: 'Olivia Rhye',
  email: 'olivia@reachinbox.com',
  avatarUrl: null,
};

export const mockSenders: Sender[] = [
  { id: 'demo-sender', displayName: 'Olivia Rhye', email: 'olivia@reachinbox.com' },
  { id: 'team-sender', displayName: 'ReachInbox Team', email: 'team@reachinbox.com' },
];

const now = Date.now();

export const mockScheduledEmails: EmailRecord[] = [
  {
    id: 'scheduled-1',
    recipient: 'jordan@acme.co',
    subject: 'Quick question about your growth plans',
    body: 'Hi Jordan,\n\nI came across Acme and wanted to share a quick idea that could help your team move faster.\n\nWould you be open to a short conversation next week?',
    scheduledAt: new Date(now + 1000 * 60 * 26).toISOString(),
    status: 'SCHEDULED',
    senderName: 'Olivia Rhye',
    senderEmail: 'olivia@reachinbox.com',
    preview: 'I came across Acme and wanted to share a quick idea that could help your team move faster.',
  },
  {
    id: 'scheduled-2',
    recipient: 'alex@northstar.io',
    subject: 'Loved your latest launch',
    body: 'Hi Alex,\n\nLoved seeing the latest Northstar launch. I have a few ideas that might be useful as you scale the team.\n\nBest,\nOlivia',
    scheduledAt: new Date(now + 1000 * 60 * 49).toISOString(),
    status: 'SCHEDULED',
    senderName: 'Olivia Rhye',
    senderEmail: 'olivia@reachinbox.com',
    preview: 'Loved seeing the latest Northstar launch. I have a few ideas that might be useful as you scale.',
  },
  {
    id: 'scheduled-3',
    recipient: 'sam@bloomlabs.dev',
    subject: 'A simple way to improve reply rates',
    body: 'Hi Sam,\n\nI noticed Bloom Labs is building a thoughtful outbound motion. Here is one simple experiment that can improve reply rates without adding more volume.',
    scheduledAt: new Date(now + 1000 * 60 * 75).toISOString(),
    status: 'SCHEDULED',
    senderName: 'ReachInbox Team',
    senderEmail: 'team@reachinbox.com',
    preview: 'Here is one simple experiment that can improve reply rates without adding more volume.',
  },
  {
    id: 'scheduled-4',
    recipient: 'casey@frame.work',
    subject: 'Following up on our conversation',
    body: 'Hi Casey,\n\nJust following up on our conversation. Happy to send over the notes whenever it is useful.',
    scheduledAt: new Date(now + 1000 * 60 * 108).toISOString(),
    status: 'SCHEDULED',
    senderName: 'Olivia Rhye',
    senderEmail: 'olivia@reachinbox.com',
    preview: 'Just following up on our conversation. Happy to send over the notes whenever it is useful.',
  },
];

export const mockSentEmails: EmailRecord[] = [
  {
    id: 'sent-1',
    recipient: 'morgan@vertex.studio',
    subject: 'A note on Vertex Studio',
    body: 'Hi Morgan,\n\nI have been following the work Vertex Studio is doing and wanted to reach out with a practical idea for your next stage of growth.\n\nWould Thursday work for a quick chat?',
    scheduledAt: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
    sentAt: new Date(now - 1000 * 60 * 60 * 2.8).toISOString(),
    status: 'SENT',
    senderName: 'Olivia Rhye',
    senderEmail: 'olivia@reachinbox.com',
    preview: 'I have been following the work Vertex Studio is doing and wanted to reach out with a practical idea.',
  },
  {
    id: 'sent-2',
    recipient: 'taylor@orbit.app',
    subject: 'A quick introduction',
    body: 'Hi Taylor,\n\nA quick introduction and a thought on how Orbit could make the most of its growing community.',
    scheduledAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
    sentAt: new Date(now - 1000 * 60 * 60 * 4.9).toISOString(),
    status: 'SENT',
    senderName: 'Olivia Rhye',
    senderEmail: 'olivia@reachinbox.com',
    preview: 'A quick introduction and a thought on how Orbit could make the most of its growing community.',
  },
  {
    id: 'sent-3',
    recipient: 'riley@studio-nine.com',
    subject: 'Your work at Studio Nine',
    body: 'Hi Riley,\n\nYour work at Studio Nine caught my eye. I would love to share a few ideas with you.',
    scheduledAt: new Date(now - 1000 * 60 * 60 * 8).toISOString(),
    sentAt: new Date(now - 1000 * 60 * 60 * 7.9).toISOString(),
    status: 'SENT',
    senderName: 'ReachInbox Team',
    senderEmail: 'team@reachinbox.com',
    preview: 'Your work at Studio Nine caught my eye. I would love to share a few ideas with you.',
  },
];
