import { bootstrap } from "./bootstrap";
import { logger } from "@shared/logger";

bootstrap().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
