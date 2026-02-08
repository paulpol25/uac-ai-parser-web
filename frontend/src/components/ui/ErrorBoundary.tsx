/**
 * ErrorBoundary & Error display components
 */
import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, Bug } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorDisplay
          title="Something went wrong"
          message={this.state.error?.message || "An unexpected error occurred"}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}

interface ErrorDisplayProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  showHomeButton?: boolean;
}

export function ErrorDisplay({
  title = "Error",
  message,
  onRetry,
  showHomeButton = true,
}: ErrorDisplayProps) {
  return (
    <Card className="border-error/30">
      <CardContent>
        <div className="flex flex-col items-center text-center py-6">
          <div className="p-3 bg-error/10 rounded-full mb-4">
            <AlertTriangle className="w-8 h-8 text-error" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
          <p className="text-sm text-text-secondary mb-6 max-w-md">{message}</p>
          <div className="flex gap-3">
            {onRetry && (
              <Button onClick={onRetry} variant="secondary">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            )}
            {showHomeButton && (
              <Button
                variant="ghost"
                onClick={() => (window.location.href = "/")}
              >
                <Home className="w-4 h-4 mr-2" />
                Go Home
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
}

export function InlineError({ message, onRetry }: InlineErrorProps) {
  return (
    <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/30 rounded-lg">
      <AlertTriangle className="w-4 h-4 text-error flex-shrink-0" />
      <p className="text-sm text-error flex-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm text-error hover:text-error/80 underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}

interface ApiErrorProps {
  error: Error | null;
  onRetry?: () => void;
}

export function ApiError({ error, onRetry }: ApiErrorProps) {
  if (!error) return null;

  const isNetworkError = error.message.includes("fetch") || error.message.includes("network");
  const is404 = error.message.includes("404") || error.message.includes("not found");
  const isServerError = error.message.includes("500") || error.message.includes("server");

  let title = "Request Failed";
  let message = error.message;
  let icon = AlertTriangle;

  if (isNetworkError) {
    title = "Connection Error";
    message = "Unable to connect to the server. Please check your connection and try again.";
  } else if (is404) {
    title = "Not Found";
    message = "The requested resource could not be found.";
  } else if (isServerError) {
    title = "Server Error";
    message = "The server encountered an error. Please try again later.";
    icon = Bug;
  }

  const Icon = icon;

  return (
    <div className="flex items-start gap-3 p-4 bg-error/10 border border-error/30 rounded-lg">
      <div className="p-2 bg-error/20 rounded-lg">
        <Icon className="w-5 h-5 text-error" />
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-medium text-error">{title}</h4>
        <p className="text-sm text-text-secondary mt-1">{message}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

export default ErrorBoundary;
