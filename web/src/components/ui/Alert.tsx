import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle, Info, XCircle } from "lucide-react";
import type { HTMLAttributes } from "react";

type AlertVariant = "info" | "success" | "warning" | "error";

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
}

const config: Record<AlertVariant, { icon: React.ElementType; cls: string }> = {
  info:    { icon: Info,          cls: "bg-blue-50 border-blue-200 text-blue-800" },
  success: { icon: CheckCircle,   cls: "bg-green-50 border-green-200 text-green-800" },
  warning: { icon: AlertTriangle, cls: "bg-amber-50 border-amber-200 text-amber-800" },
  error:   { icon: XCircle,       cls: "bg-red-50 border-red-200 text-red-800" },
};

export function Alert({ variant = "info", title, children, className, ...props }: AlertProps) {
  const { icon: Icon, cls } = config[variant];
  return (
    <div className={cn("flex gap-3 rounded-lg border p-4 text-sm", cls, className)} {...props}>
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div>
        {title && <p className="font-semibold mb-1">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
