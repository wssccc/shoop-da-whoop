import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className combiner (mirrors solitaire template). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
