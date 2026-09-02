import { z } from "zod";

export const plannedCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});

export type PlannedCall = z.infer<typeof plannedCallSchema>;
