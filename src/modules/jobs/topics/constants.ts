export const DEFAULT_FETCH_LIMIT = 20;
export const DEFAULT_IDLE_MINUTES = 45;
export const DEFAULT_BOT_COOLDOWN_MINUTES = 180;
export const DEFAULT_BURST_WINDOW_MINUTES = 15;
export const DEFAULT_BURST_MESSAGE_THRESHOLD = 3;
export const DEFAULT_MAX_KEYWORDS = 6;
export const DEFAULT_MAX_RECENT_MESSAGES = 8;

export const TOPIC_PATTERNS: Array<{ topic: string; patterns: RegExp[] }> = [
  { topic: "game", patterns: [/\b(game|gaming|rank|skin|server|steam|valorant|lol|minecraft|roblox)\b/i] },
  { topic: "cong nghe", patterns: [/\b(ai|code|coding|dev|bug|deploy|app|web|tech|cong nghe|lap trinh)\b/i] },
  { topic: "hoc tap", patterns: [/\b(hoc|thi|bai tap|deadline|mon|lop|truong|study)\b/i] },
  { topic: "phim", patterns: [/\b(phim|movie|anime|series|netflix|rap)\b/i] },
  { topic: "am nhac", patterns: [/\b(nhac|music|playlist|song|album|spotify|karaoke)\b/i] },
  { topic: "doi song", patterns: [/\b(an gi|ca phe|cuoi tuan|hom nay|di dau|chuyen|tam su)\b/i] },
  { topic: "ho tro", patterns: [/\b(help|ho tro|loi|khong vao|mua|gia|nap|ticket)\b/i] },
];

export const STOPWORDS = new Set([
  "anh",
  "ban",
  "bot",
  "cai",
  "cho",
  "co",
  "con",
  "cua",
  "dang",
  "day",
  "duoc",
  "em",
  "gio",
  "hoi",
  "hom",
  "khong",
  "la",
  "lam",
  "minh",
  "mot",
  "nay",
  "nguoi",
  "nha",
  "nhe",
  "nhi",
  "qua",
  "roi",
  "the",
  "thi",
  "toi",
  "trong",
  "voi",
  "you",
  "the",
  "and",
  "for",
  "that",
  "this",
  "are",
  "was",
  "were",
]);
