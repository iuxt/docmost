import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getCapabilities } from "./capabilities-service";
import { Capabilities } from "./capabilities.types";

export function useCapabilities(): UseQueryResult<Capabilities> {
  return useQuery({
    queryKey: ["capabilities"],
    queryFn: getCapabilities,
    staleTime: 5 * 60 * 1000,
  });
}
