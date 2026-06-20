import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 ease-out will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100 active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-forest text-paper shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_0_rgba(0,41,29,0.25)] hover:bg-forest-700 hover:-translate-y-px hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_8px_20px_-6px_rgba(0,41,29,0.4)]",
  secondary:
    "bg-coffee text-paper shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_1px_2px_0_rgba(0,0,0,0.2)] hover:bg-coffee/90 hover:-translate-y-px hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_8px_20px_-6px_rgba(0,0,0,0.32)]",
  outline:
    "border border-white/60 bg-white/60 text-ink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] hover:bg-white/75 hover:border-white/70 hover:-translate-y-px hover:shadow-[0_8px_20px_-8px_rgba(0,41,29,0.18)]",
  ghost: "text-muted-fg hover:bg-white/55 hover:text-ink",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}
