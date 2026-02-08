import { Heart } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-bg-surface border-t border-border-subtle py-2 px-6">
      <div className="flex items-center justify-center gap-1.5 text-xs text-text-muted">
        <span>Made with</span>
        <Heart className="w-3 h-3 text-red-500 fill-red-500 animate-pulse" />
        <span>by</span>
        <a 
          href="https://github.com/paulpol25" 
          target="_blank" 
          rel="noopener noreferrer"
          className="font-medium text-text-secondary hover:text-brand-primary transition-colors"
        >
          gambith
        </a>
      </div>
    </footer>
  );
}
