import { z } from 'zod';
import { characterSetupSchema } from './validation.js';

const name = z.string().min(1);
const role = z.enum(['A', 'B', 'C']);
export const setupDomainSchema = z
  .object({
    characters: z
      .array(
        characterSetupSchema.omit({ identity: true, reverseIdentity: true }).extend({
          roles: z.array(z.union([name, z.tuple([name, name])])).optional(),
        }),
      )
      .min(1),
    plots: z
      .array(
        z
          .object({
            y: name,
            x: z.array(name),
            alternateY: name.optional(),
            secretAddition: z.enum(['杀手', '主谋', '因果残片']).optional(),
          })
          .strict(),
      )
      .optional(),
    incidents: z
      .array(
        z
          .object({
            day: z.number().int().positive(),
            names: z.array(name).optional(),
            culprits: z.array(name).optional(),
          })
          .strict(),
      )
      .optional(),
    captain: z.enum(['p0', 'p1', 'p2']).optional(),
    anniversaryFragments: z.array(name).optional(),
    privateRoles: z.object({ p0: role, p1: role, p2: role }).strict().optional(),
  })
  .strict();
export type SetupDomain = z.infer<typeof setupDomainSchema>;
