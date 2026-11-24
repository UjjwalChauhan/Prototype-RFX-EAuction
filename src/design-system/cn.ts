/**
 * shadcn's class merger.
 *
 * `clsx` flattens the conditional forms a component wants to write; `twMerge`
 * resolves Tailwind conflicts in favour of the last class, which is what makes
 * a `className` prop able to override a variant rather than fight it. Both
 * halves matter: without the merge, `<Button className="h-7">` loses to the
 * variant's own `h-8` and the caller cannot tell why.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
