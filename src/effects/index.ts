import { createFog } from "./fog.ts";
import { createPeel } from "./peel.ts";
import { createScratch } from "./scratch.ts";
import { createShatter } from "./shatter.ts";
import { createTear } from "./tear.ts";
import type { Effect } from "./types.ts";

export { AUTO_REVEAL } from "./types.ts";
export type { Effect, Pointer, Surface } from "./types.ts";

export const effectIds = ["scratch", "tear", "fog", "peel", "shatter"] as const;
export type EffectId = (typeof effectIds)[number];

export function createEffect(id: string): Effect {
  switch (id) {
    case "tear":
      return createTear();
    case "fog":
      return createFog();
    case "peel":
      return createPeel();
    case "shatter":
      return createShatter();
    default:
      return createScratch();
  }
}

export const isEffectId = (value: string): value is EffectId =>
  (effectIds as readonly string[]).includes(value);
