import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonSize = "md" | "lg";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "h-11 px-5 text-sm",
  lg: "h-14 px-6 text-base",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-full bg-neutral-900 font-semibold text-white shadow-sm shadow-neutral-900/10 transition-colors duration-150 hover:bg-neutral-800 active:bg-black disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-neutral-950";

export function buttonVariants({
  size = "md",
  className,
}: {
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(BASE_CLASSES, SIZE_CLASSES[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "md", ...props }, ref) => {
    return <button ref={ref} className={buttonVariants({ size, className })} {...props} />;
  }
);
Button.displayName = "Button";
