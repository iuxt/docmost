import { ReactNode } from "react";
import { useAtomValue } from "jotai";
import { capabilitiesAtom } from "@/features/workspace/capabilities/capabilities-atom";
import { Error404 } from "@/components/ui/error-404";

export function RequireFeature({
  feature,
  children,
}: {
  feature: string;
  children: ReactNode;
}) {
  const capabilities = useAtomValue(capabilitiesAtom);

  if (!capabilities) return null;
  if (!capabilities.features.includes(feature)) return <Error404 />;

  return children;
}
