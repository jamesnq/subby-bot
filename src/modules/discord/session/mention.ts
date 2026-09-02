const BOT_MENTION_RE = /^<@!?(\d{17,20})>\s*/;
const LEADING_MENTION_RE = /^<@!?(\d{17,20})>\s*/;

export function stripLeadingBotMention(
  content: string,
  botUserId: string,
): { mentioned: boolean; prompt: string; mentionedUserId?: string } {
  const match = BOT_MENTION_RE.exec(content);
  if (!match) {
    return { mentioned: false, prompt: content.trim() };
  }

  const mentionedUserId = match[1];
  return {
    mentioned: mentionedUserId === botUserId,
    mentionedUserId,
    prompt: content.slice(match[0].length).trim(),
  };
}

export function hasForeignLeadingMention(content: string, botUserId: string): boolean {
  const match = LEADING_MENTION_RE.exec(content);
  return !!match && match[1] !== botUserId;
}
