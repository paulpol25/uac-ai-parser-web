import { Heart, Shield } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-bg-surface/60 border-t border-border-subtle py-1.5 px-6">
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <div className="flex items-center gap-1.5">
          <Shield className="w-2.5 h-2.5 text-brand-primary/50" />
          <span className="font-mono tracking-wider uppercase">UAC AI Parser</span>
        </div>
        <div className="flex items-center gap-1">
          <span>Made with</span>
          <Heart className="w-2.5 h-2.5 text-red-500 fill-red-500" />
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
      </div>
    </footer>
  );
}
