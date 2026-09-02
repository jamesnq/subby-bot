export const ACCOUNT_PATTERNS = [
  /(?:log\s?in|login|sign\s?in)\s+to\s+(?:the\s+)?account\s+([A-Za-z0-9_.-]{2,64})/i,
  /\baccount\s+([A-Za-z0-9_.-]{2,64})\s*[:,]/i,
  /\bt[àa]i\s?kho[ảa]n\s+([A-Za-z0-9_.-]{2,64})/i,
  /(?:^|\s)(?:Dear|Xin ch[àa]o|Ch[àa]o)\s+([A-Za-z0-9_.-]{2,64})\s*[,:]/i,
];

export const SUBJECT_ACCOUNT_PATTERN =
  /\b(?:account|t[àa]i kho[ảa]n)\s+([A-Za-z0-9_.-]{2,64})/i;

/** Steam Guard alphabet - omits characters that misread (0/O, 1/I/L, S/5...). */
export const STEAM_GUARD_CODE_PATTERN = /\b[23456789BCDFGHJKMNPQRTVWXY]{5}\b/;
/** "code: DN356", "mã: DN356" - deliberately case-sensitive on the code group. */
export const LABELED_CODE_PATTERN =
  /(?:[Cc]ode|[Mm][aã])\s*(?:is|l[àa])?\s*[:：]?\s*([A-Z0-9]{5,8})\b/;

export const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
export const NUMERIC_CODE_PATTERN = /\b\d{5,}\b/g;
export const ALPHANUMERIC_CODE_PATTERN =
  /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,12}\b/g;
