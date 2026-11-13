import api from "@/lib/api-client";
import { Capabilities } from "./capabilities.types";

export async function getCapabilities(): Promise<Capabilities> {
  const req = await api.post<Capabilities>("/workspace/capabilities");
  return req.data as Capabilities;
}
