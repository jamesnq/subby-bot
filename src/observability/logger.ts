import pino from "pino";
import { config } from "../config";

export const logger = pino({
  level: process.env.NODE_ENV === "test" ? "silent" : config.LOG_LEVEL,
  base: undefined,
});
