import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/workspace/")({
  beforeLoad: () => {
    throw redirect({ to: "/workspace/chat" });
  },
});
