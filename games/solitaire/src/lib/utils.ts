import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className combiner (mirrors othello template). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
