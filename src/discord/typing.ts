import type { TextBasedChannel } from "discord.js";

const TYPING_INTERVAL_MS = 8_000;

export function startTypingLoop(channel: TextBasedChannel): NodeJS.Timeout {
  const timer = setInterval(() => {
    if ("sendTyping" in channel) {
      void channel.sendTyping().catch(() => undefined);
    }
  }, TYPING_INTERVAL_MS);
  return timer;
}

export function stopTypingLoop(timer: NodeJS.Timeout | null | undefined): void {
  if (timer) clearInterval(timer);
}
