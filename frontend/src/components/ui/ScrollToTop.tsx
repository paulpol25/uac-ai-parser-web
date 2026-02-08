import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";

interface ScrollToTopProps {
  /** Target element to scroll, defaults to window */
  targetRef?: React.RefObject<HTMLElement>;
  /** Threshold in pixels before button shows */
  threshold?: number;
}

export function ScrollToTop({ targetRef, threshold = 300 }: ScrollToTopProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = targetRef?.current?.scrollTop ?? window.scrollY;
      setIsVisible(scrollTop > threshold);
    };

    const target = targetRef?.current ?? window;
    target.addEventListener("scroll", handleScroll);
    handleScroll(); // Check initial state

    return () => target.removeEventListener("scroll", handleScroll);
  }, [targetRef, threshold]);

  const scrollToTop = () => {
    if (targetRef?.current) {
      targetRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (!isVisible) return null;

  return (
    <button
      onClick={scrollToTop}
      className="fixed bottom-6 right-6 z-40 flex items-center justify-center w-10 h-10 bg-brand-primary text-white rounded-full shadow-lg hover:bg-brand-primary/90 transition-all hover:scale-110 animate-fade-in"
      aria-label="Scroll to top"
    >
      <ArrowUp className="w-5 h-5" />
    </button>
  );
}
