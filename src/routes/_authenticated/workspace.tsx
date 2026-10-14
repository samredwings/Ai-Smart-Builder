import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { MessageSquare, GitBranch, Settings } from "lucide-react";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "Workspace — App Forge" },
      { name: "description", content: "Chat with AI about files, ZIPs and links, manage Git repos, synced to Google Sheets." },
      { property: "og:title", content: "Workspace — App Forge" },
      { property: "og:description", content: "Personal AI workspace with Git and Google Sheets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkspaceLayout,
});

const NAV = [
  { to: "/workspace/chat", label: "Chat", icon: MessageSquare },
  { to: "/workspace/git", label: "Git", icon: GitBranch },
  { to: "/workspace/settings", label: "Settings", icon: Settings },
] as const;

function WorkspaceLayout() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col md:flex-row md:gap-6 md:px-4 md:py-6">
      <nav className="sticky top-0 z-10 flex border-b bg-background md:static md:w-48 md:shrink-0 md:flex-col md:gap-1 md:border-b-0">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-1 items-center justify-center gap-2 px-3 py-3 text-sm text-muted-foreground md:flex-none md:justify-start md:rounded-md md:py-2 hover:bg-muted"
            activeProps={{ className: "text-foreground font-medium border-b-2 border-primary md:border-b-0 md:bg-muted" }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <main className="min-w-0 flex-1 px-4 py-4 md:px-0 md:py-0">
        <Outlet />
      </main>
    </div>
  );
}
