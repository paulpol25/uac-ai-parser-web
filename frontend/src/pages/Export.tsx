import { useState } from "react";
import { Download, FileJson, FileText, Table, FileArchive, CheckCircle2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { Spinner } from "@/components/ui/Loader";
import { useSessionStore } from "@/stores/sessionStore";
import { getAuthHeader } from "@/stores/authStore";

const exportFormats = [
  {
    id: "jsonl",
    name: "JSONL (Timesketch)",
    description: "Compatible with Timesketch import",
    icon: FileJson,
  },
  {
    id: "json",
    name: "JSON",
    description: "Structured JSON export",
    icon: FileJson,
  },
  {
    id: "markdown",
    name: "Markdown Report",
    description: "Human-readable report format",
    icon: FileText,
  },
  {
    id: "csv",
    name: "CSV",
    description: "Spreadsheet compatible",
    icon: Table,
  },
];

export function Export() {
  const { sessionId } = useSessionStore();
  const [selectedFormat, setSelectedFormat] = useState("jsonl");
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!sessionId) return;

    setIsExporting(true);
    try {
      const response = await fetch(
        `/api/v1/export?session_id=${sessionId}&format=${selectedFormat}`,
        { headers: getAuthHeader() }
      );

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const filename =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename=(.+)/)?.[1] || `export.${selectedFormat}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
    } finally {
      setIsExporting(false);
    }
  };

  if (!sessionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <div className="w-12 h-12 mx-auto bg-brand-primary/10 rounded-xl flex items-center justify-center mb-4">
            <Download className="w-6 h-6 text-brand-primary" />
          </div>
          <h2 className="font-heading font-semibold text-lg mb-1">
            No Session Active
          </h2>
          <p className="text-text-secondary text-sm mb-5">
            Upload a UAC output file from the Dashboard to export data.
          </p>
          <button
            onClick={() => (window.location.href = "/")}
            className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-brand-primary/10 rounded-lg flex items-center justify-center">
          <FileArchive className="w-4 h-4 text-brand-primary" />
        </div>
        <div>
          <h1 className="text-lg font-heading font-semibold">Export Evidence</h1>
          <p className="text-xs text-text-muted font-mono">Session: {sessionId.slice(0, 12)}...</p>
        </div>
      </div>

      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h2 className="font-semibold text-xs text-text-muted uppercase tracking-wider">Select Export Format</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {exportFormats.map((format) => {
              const Icon = format.icon;
              const isSelected = selectedFormat === format.id;

              return (
                <button
                  key={format.id}
                  onClick={() => setSelectedFormat(format.id)}
                  className={cn(
                    "flex items-start gap-3 p-3.5 rounded-lg border text-left transition-all group",
                    isSelected
                      ? "border-brand-primary bg-brand-primary/5 shadow-sm"
                      : "border-border-default hover:border-brand-primary/30 hover:bg-bg-hover/50"
                  )}
                >
                  <div className={cn(
                    "p-2 rounded-lg transition-colors",
                    isSelected ? "bg-brand-primary/20" : "bg-bg-elevated group-hover:bg-bg-hover"
                  )}>
                    <Icon className={cn("w-4 h-4", isSelected ? "text-brand-primary" : "text-text-secondary")} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary">{format.name}</p>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-brand-primary" />}
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">{format.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-bg-surface border border-border-subtle rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary font-medium">Ready to export</p>
            <p className="text-xs text-text-muted">
              Format: <span className="font-mono text-text-secondary">{selectedFormat.toUpperCase()}</span>
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-brand-primary text-bg-base rounded-lg hover:bg-brand-primary-hover disabled:opacity-50 transition-colors shadow-lg shadow-brand-primary/20"
          >
            {isExporting ? (
              <>
                <Spinner className="w-4 h-4" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export {selectedFormat.toUpperCase()}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
