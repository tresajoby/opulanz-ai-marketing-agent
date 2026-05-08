import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  colorClass?: string;
}

export function Badge({ className, colorClass, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        colorClass ?? "bg-gray-100 text-gray-700",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
