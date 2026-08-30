export interface ParsedRecipients {
  recipients: string[];
  malformed: string[];
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return emailPattern.test(value.trim());
}

export function parseRecipientText(text: string): ParsedRecipients {
  const tokens = text
    .split(/[\s,;]+/)
    .map((token) => token.trim().replace(/^['"]|['"]$/g, '').replace(/[\r\n]+/g, ''))
    .filter(Boolean);
  const candidates = tokens.filter((token) => token.includes('@'));
  const recipients = [...new Set(candidates.filter(isValidEmail))];
  const malformed = [...new Set(candidates.filter((token) => !isValidEmail(token)))];

  return { recipients, malformed };
}

export function localDateTimeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
