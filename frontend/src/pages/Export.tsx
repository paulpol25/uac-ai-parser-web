import { useState } from "react";
import { Download, FileJson, FileText, Table } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useSessionStore } from "@/stores/sessionStore";

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
        `/api/v1/export?session_id=${sessionId}&format=${selectedFormat}`
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
      <Card padding="lg">
        <div className="text-center py-12">
          <Download className="w-12 h-12 mx-auto mb-4 text-text-muted" />
          <h2 className="font-heading font-semibold text-xl mb-2">
            No Session Active
          </h2>
          <p className="text-text-secondary mb-4">
            Upload a UAC output file from the Dashboard to export data.
          </p>
          <Button onClick={() => (window.location.href = "/")}>
            Go to Dashboard
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Card padding="lg">
        <CardHeader>
          <CardTitle>Export Format</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {exportFormats.map((format) => {
              const Icon = format.icon;
              const isSelected = selectedFormat === format.id;

              return (
                <button
                  key={format.id}
                  onClick={() => setSelectedFormat(format.id)}
                  className={`
                    flex items-start gap-4 p-4 rounded-lg border text-left transition-all
                    ${
                      isSelected
                        ? "border-brand-primary bg-brand-primary/5"
                        : "border-border-default hover:border-border-strong"
                    }
                  `}
                >
                  <div
                    className={`
                    p-2 rounded
                    ${isSelected ? "bg-brand-primary/20" : "bg-bg-elevated"}
                  `}
                  >
                    <Icon
                      className={`w-5 h-5 ${isSelected ? "text-brand-primary" : "text-text-secondary"}`}
                    />
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">
                      {format.name}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {format.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-primary font-medium">Ready to export</p>
              <p className="text-sm text-text-secondary">
                Session: {sessionId.slice(0, 8)}...
              </p>
            </div>
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-text-inverse border-t-transparent rounded-full mr-2" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Export {selectedFormat.toUpperCase()}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
