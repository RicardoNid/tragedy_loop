import { z } from 'zod';
import type { Command, GameSetup } from './game.js';

const text = z.string().min(1);
const integer = z.number().int().safe().nonnegative();
const positive = integer.positive();
const board = z.enum(['hospital', 'shrine', 'city', 'school']);
const seat = z.enum(['p0', 'p1', 'p2']);
const role = z.enum(['A', 'B', 'C']);
/** Strict JSON boundary: unknown fields must never silently become ignored rules. */
export const setupSchema: z.ZodType<GameSetup> = z
  .object({
    module: z.enum(['FS', 'BTX', 'MZ', 'MC', 'HSA', 'WM', 'AHR', 'LL']),
    anniversary: z.boolean(),
    loops: positive,
    days: positive,
    y: text,
    x: z.array(text),
    captain: seat,
    discussion: z.enum(['allowed', 'between-loops']),
    publicSpecialRules: z.array(text).optional(),
    characters: z
      .array(
        z
          .object({
            id: text,
            character: text,
            identity: text,
            initialArea: z.enum(['hospital', 'shrine', 'city', 'school', 'far']).optional(),
            enterDay: positive.optional(),
            enterLoop: positive.optional(),
            x: integer.optional(),
            territory: board.optional(),
            copiedFrom: text.optional(),
            reverseIdentity: text.optional(),
          })
          .strict(),
      )
      .min(1),
    incidents: z.array(
      z.object({ day: positive, name: text, publicName: text.optional(), culprit: text }).strict(),
    ),
    alternateY: text.optional(),
    anniversaryFragment: text.optional(),
    privateRoles: z.object({ p0: role, p1: role, p2: role }).strict().optional(),
    secretAddition: z.enum(['杀手', '主谋', '因果残片']).optional(),
  })
  .strict();
export const commandSchema: z.ZodType<Command> = z
  .object({
    id: text,
    expectedRevision: integer,
    decisionId: text,
    choice: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('start') }).strict(),
      z.object({ kind: z.literal('continue') }).strict(),
      z.object({ kind: z.literal('pass') }).strict(),
      z.object({ kind: z.literal('request-final-guess') }).strict(),
      z.object({ kind: z.literal('vote-final-guess'), agree: z.boolean() }).strict(),
      z
        .object({
          kind: z.literal('cards'),
          placements: z.array(z.object({ card: text, target: text }).strict()),
        })
        .strict(),
      z
        .object({
          kind: z.literal('ability'),
          ability: text,
          owner: text.optional(),
          choices: z.record(z.string()).optional(),
        })
        .strict(),
      z.object({ kind: z.literal('select'), value: z.string() }).strict(),
      z.object({ kind: z.literal('refuse'), refuse: z.boolean() }).strict(),
      z
        .object({
          kind: z.literal('guess'),
          character: text,
          identity: text,
          reverseIdentity: text.optional(),
        })
        .strict(),
      z.object({ kind: z.literal('guess-culprits'), answers: z.record(text) }).strict(),
    ]),
  })
  .strict();
