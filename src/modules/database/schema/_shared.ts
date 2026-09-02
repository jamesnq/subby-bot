import { customType } from "drizzle-orm/pg-core";

export const VECTOR_DIMS = Number(process.env.VECTOR_DIMS ?? "1536");

export const vector = () =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${VECTOR_DIMS})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
  })();
