import { useAtom } from "jotai";
import { capabilitiesAtom } from "@/features/workspace/capabilities/capabilities-atom";

export const useHasFeature = (feature: string): boolean => {
  const [capabilities] = useAtom(capabilitiesAtom);
  return capabilities?.features?.includes(feature) ?? false;
};
