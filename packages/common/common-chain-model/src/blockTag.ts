import { z } from 'zod';

export const BlockTagSchema = z.union([z.string(), z.number()]);
export type BlockTag = z.infer<typeof BlockTagSchema>;
