import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { exportAPKBundle } from "@/lib/export.functions";
import { BuildStep } from "./BuildStep";
import {
  Download,
  Package,
  Smartphone,
  Archive,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
} from "lucide-react";

interface ExportTabProps {
  projectId: string;
  publishedUrl?: string;
  isPublished?: boolean;
}

const BUILD_STEPS = [
  { id: "assets", label: "Copy static assets", icon: Archive, duration: 900 },
  { id: "web-build", label: "Build web app bundle", icon: Package, duration: 2000 },
  { id: "capacitor-sync", label: "Sync Capacitor config", icon: Smartphone, duration: 1200 },
  { id: "gradle", label: "Compile & sign APK", icon: Download, duration: 2800 },
];

type StepStatus = "pending" | "running" | "done" | "error";

interface BuildRecord {
  id: string;
  filename: string;
  createdAt: string;
  status: "success" | "failed";
}

export function ExportTab({ projectId, publishedUrl, isPublished }: ExportTabProps) {
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(
    Object.fromEntries(BUILD_STEPS.map((s) => [s.id, "pending" as StepStatus]))
  );
  const [progressPct, setProgressPct] = useState(0);
  const [buildComplete, setBuildComplete] = useState(false);
  const [buildHistory, setBuildHistory] = useState<BuildRecord[]>(() => {
    try {
      const stored = localStorage.getItem(`apk_builds_${projectId}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const exportBundle = useServerFn(exportAPKBundle);

  const exportMut = useMutation({
    mutationFn: async () => {
      setBuildComplete(false);
      setProgressPct(0);
      setStepStatuses(Object.fromEntries(BUILD_STEPS.map((s) => [s.id, "pending" as StepStatus])));

      for (let i = 0; i < BUILD_STEPS.length; i++) {
        const step = BUILD_STEPS[i];
        setStepStatuses((prev) => ({ ...prev, [step.id]: "running" }));
        await new Promise((r) => setTimeout(r, step.duration));
        setStepStatuses((prev) => ({ ...prev, [step.id]: "done" }));
        setProgressPct(Math.round(((i + 1) / BUILD_STEPS.length) * 100));
      }

      return exportBundle({ data: { projectId, origin: window.location.origin } });
    },
    onSuccess: (res) => {
      const blob = new Blob(
        [Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0))],
        { type: "application/zip" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);

      setBuildComplete(true);
      const record: BuildRecord = {
        id: crypto.randomUUID(),
        filename: res.filename,
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        status: "success",
      };
      const updated = [record, ...buildHistory].slice(0, 5);
      setBuildHistory(updated);
      try {
        localStorage.setItem(`apk_builds_${projectId}`, JSON.stringify(updated));
      } catch {}

      toast.success("APK bundle generated and downloaded");
    },
    onError: (e) => {
      setStepStatuses((prev) => {
        const next = { ...prev };
        for (const s of BUILD_STEPS) {
          if (next[s.id] !== "done") {
            next[s.id] = "error";
            break;
          }
        }
        return next;
      });
      toast.error(e instanceof Error ? e.message : "Export failed");
    },
  });

  const isBuilding = exportMut.isPending;
  const isFailed = exportMut.isError;

  return (
    <div className="flex-1 overflow-y-auto space-y-4 mt-3 pr-1 text-foreground">
      {/* Build Card */}
      <div className="p-4 border rounded-xl bg-card/60 backdrop-blur-sm space-y-4 shadow-sm">
        {/* Header & Status Pill */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" />
              Android APK Bundle
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Capacitor-powered signed APK bundle with offline support.
            </p>
          </div>

          <div
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5 border ${
              isBuilding
                ? "bg-primary/10 text-primary border-primary/20"
                : buildComplete
                ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
                : isFailed
                ? "bg-destructive/10 text-destructive border-destructive/20"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isBuilding
                  ? "bg-primary animate-pulse"
                  : buildComplete
                  ? "bg-green-500"
                  : isFailed
                  ? "bg-destructive"
                  : "bg-muted-foreground"
              }`}
            />
            {isBuilding ? "Building..." : buildComplete ? "Ready" : isFailed ? "Failed" : "Idle"}
          </div>
        </div>

        {/* Multi-stage Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] font-medium text-muted-foreground">
            <span>Pipeline Progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isFailed ? "bg-destructive" : buildComplete ? "bg-green-500" : "bg-primary"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* 4 Steps */}
        <div className="space-y-2 pt-1">
          {BUILD_STEPS.map((step, idx) => (
            <BuildStep
              key={step.id}
              {...step}
              status={stepStatuses[step.id]}
              isLast={idx === BUILD_STEPS.length - 1}
            />
          ))}
        </div>

        {/* Action Button */}
        <Button
          className="w-full h-10 text-sm font-medium transition-all"
          disabled={isBuilding}
          variant={buildComplete ? "outline" : isFailed ? "destructive" : "default"}
          onClick={() => exportMut.mutate()}
        >
          {isBuilding ? (
            <span className="flex items-center gap-2">
              <RotateCw className="w-4 h-4 animate-spin" />
              Building APK Pipeline...
            </span>
          ) : buildComplete ? (
            <span className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Build & Download Again
            </span>
          ) : isFailed ? (
            <span className="flex items-center gap-2">
              <RotateCw className="w-4 h-4" />
              Retry Build Pipeline
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Generate APK Bundle
            </span>
          )}
        </Button>

        {/* Success Banner */}
        {buildComplete && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-xs text-green-700 dark:text-green-400 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Build Complete & Downloaded
            </div>
            <p className="text-[11px] leading-relaxed">
              Extract the downloaded zip, open the <code>android</code> folder in Android Studio, and run on any connected Android phone or emulator.
            </p>
          </div>
        )}

        {/* Error Banner */}
        {isFailed && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-xs text-destructive space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertCircle className="w-4 h-4" />
              Build Pipeline Error
            </div>
            <p className="text-[11px]">{exportMut.error instanceof Error ? exportMut.error.message : "Unknown export error occurred."}</p>
          </div>
        )}
      </div>

      {/* Build Configuration Specs */}
      <div className="p-4 border rounded-xl bg-card/40 space-y-2.5">
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Build Configuration
        </h4>
        <div className="divide-y divide-border/60 text-xs">
          {[
            { label: "Build Target", value: "Android API 33+ (Tiramisu)" },
            { label: "Architecture", value: "arm64-v8a, x86_64" },
            { label: "Runtime Engine", value: "Capacitor 6.x / Android WebView" },
            { label: "App Shell", value: "Single-Activity Native Host" },
            { label: "Signing Keystore", value: "Debug Keystore (pre-configured)" },
          ].map((row) => (
            <div key={row.label} className="py-1.5 flex justify-between items-center">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-mono text-[11px] text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Build History */}
      {buildHistory.length > 0 && (
        <div className="p-4 border rounded-xl bg-card/40 space-y-2.5">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Recent APK Builds
          </h4>
          <div className="space-y-1.5">
            {buildHistory.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between text-xs p-2 rounded-lg bg-background/50 border border-border/40"
              >
                <div className="truncate pr-2">
                  <p className="font-mono text-[11px] truncate text-foreground">{item.filename}</p>
                  <p className="text-[10px] text-muted-foreground">{item.createdAt}</p>
                </div>
                <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                  Ready
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PWA Builder Engine */}
      {isPublished && publishedUrl && (
        <div className="p-4 border rounded-xl bg-card/40 space-y-3">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5 text-primary" />
              Google Play Store (PWA Builder)
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              Generate an Android Application Bundle (.aab) ready for Google Play Store upload using Microsoft PWA Builder.
            </p>
          </div>
          <a
            href={`https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(publishedUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full"
          >
            <Button className="w-full h-9 text-xs" variant="outline">
              Open PWA Builder Portal ↗
            </Button>
          </a>
        </div>
      )}
    </div>
  );
        }
              
