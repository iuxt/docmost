import { atom, type PrimitiveAtom } from "jotai";
import type { Capabilities } from "./capabilities.types";

export const capabilitiesAtom = atom(
  null,
) as PrimitiveAtom<Capabilities | null>;
