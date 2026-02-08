/**
 * cn - Utility for conditionally joining class names
 * 
 * Combines clsx and tailwind-merge for optimal class merging
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
