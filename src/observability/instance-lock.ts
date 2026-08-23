import net from "node:net";
import { logger } from "./logger";

const LOCK_PORT = Number(process.env.INSTANCE_LOCK_PORT ?? 39_127);

// Chặn chạy 2 tiến trình bot cùng lúc (Discord cho phép nhiều gateway session
// cùng token nên không có lỗi nào báo cả, hậu quả là bot trả lời trùng lặp).
export async function acquireInstanceLock(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${LOCK_PORT} đang bị chiếm: BOT ĐÃ CHẠY Ở TIẾN TRÌNH KHÁC. Hãy tắt tiến trình cũ (taskkill /F /IM node.exe) rồi khởi động lại.`,
          ),
        );
        return;
      }
      reject(err);
    });
    server.listen(LOCK_PORT, () => resolve());
  });
  logger.info(`instance lock acquired on :${LOCK_PORT}`);
}
