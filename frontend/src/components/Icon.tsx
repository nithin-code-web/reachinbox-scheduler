import type { SVGProps } from 'react';

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'calendar'
  | 'chevron-down'
  | 'clock'
  | 'close'
  | 'file'
  | 'image'
  | 'inbox'
  | 'mail'
  | 'menu'
  | 'paperclip'
  | 'plus'
  | 'search'
  | 'send'
  | 'settings'
  | 'star'
  | 'trash'
  | 'upload'
  | 'user'
  | 'x';

const paths: Record<IconName, string> = {
  'arrow-left': 'M19 12H5m7 7-7-7 7-7',
  'arrow-right': 'M5 12h14m-7-7 7 7-7 7',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  'chevron-down': 'm6 9 6 6 6-6',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  close: 'M6 6l12 12M18 6 6 18',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6',
  image: 'm4 16 4-4 3 3 3-4 6 6M5 20h14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1ZM8 9h.01',
  inbox: 'M4 13h4l2 3h4l2-3h4M5 5h14l2 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2-8Z',
  mail: 'M4 5h16v14H4zM4 6l8 6 8-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  paperclip: 'm20 11.5-8.3 8.3a5 5 0 0 1-7.1-7.1l8.3-8.3a3.5 3.5 0 0 1 5 5l-8.3 8.3a2 2 0 1 1-2.8-2.8l7.6-7.6',
  plus: 'M12 5v14M5 12h14',
  search: 'm21 21-4.3-4.3m2.3-5.2a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  send: 'm22 2-7 20-4-9-9-4Z M22 2 11 13',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5-2 .7a6.6 6.6 0 0 1-.8 1.9l.9 1.9-1.8 1.8-1.9-.9a6.6 6.6 0 0 1-1.9.8l-.7 2h-2.6l-.7-2a6.6 6.6 0 0 1-1.9-.8l-1.9.9-1.8-1.8.9-1.9a6.6 6.6 0 0 1-.8-1.9l-2-.7V9.4l2-.7a6.6 6.6 0 0 1 .8-1.9l-.9-1.9 1.8-1.8 1.9.9a6.6 6.6 0 0 1 1.9-.8l.7-2h2.6l.7 2a6.6 6.6 0 0 1 1.9.8l1.9-.9 1.8 1.8-.9 1.9a6.6 6.6 0 0 1 .8 1.9l2 .7Z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  trash: 'M5 7h14m-9 4v6m4-6v6M9 7V4h6v3m-9 0 1 14h10l1-14',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M5 20h14',
  user: 'M20 21a8 8 0 0 0-16 0m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  x: 'M6 6l12 12M18 6 6 18',
};

export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size} {...props}>
      <path d={paths[name]} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}
