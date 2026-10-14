import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWorkspace } from "./workspace.functions";

export function useWorkspace() {
  const fn = useServerFn(getWorkspace);
  return useQuery({ queryKey: ["workspace"], queryFn: () => fn(), staleTime: 30_000 });
}
