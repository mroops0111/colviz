"use client";

import { AlertCircle, CheckCircle, Loader2, LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ToolStatus = "inProgress" | "executing" | "complete" | "error";

export interface ToolExecutionCardProps {
  title: string;
  icon?: LucideIcon;
  status: ToolStatus;
  className?: string;
  /** Short hint (e.g. "Running…" / "Done" / "Failed") */
  hint?: string;
  /**
   * Optional click handler. When provided AND status is "complete", the whole
   * card becomes interactive (cursor pointer, hover ring) and triggers this
   * callback on click. Useful e.g. to preview an output file the tool wrote.
   */
  onClick?: () => void;
}

export function ToolExecutionCard({
  title,
  icon: Icon,
  status,
  className,
  hint,
  onClick,
}: ToolExecutionCardProps) {
  const isLoading = status === "inProgress" || status === "executing";
  const isError = status === "error";
  const isClickable = !!onClick && status === "complete";

  return (
    <Card
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "w-full max-w-md border shadow-sm bg-muted/20 dark:bg-muted/10",
        isClickable &&
          "cursor-pointer transition-colors bg-primary/5 border-primary/20 hover:bg-primary/10 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <CardContent className="px-3 py-2">
        <div className="flex items-center gap-2.5 min-h-8">
          <div className="flex-shrink-0 text-primary">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isError ? (
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            ) : Icon ? (
              <Icon className="h-3.5 w-3.5" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-xs font-medium truncate">{title}</span>
            {status === "complete" && (
              <CheckCircle className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
            )}
          </div>
          {hint != null && (
            <span
              className={cn(
                "text-[11px] min-w-0 max-w-[60%] truncate",
                isError ? "text-destructive" : "text-muted-foreground"
              )}
              title={hint}
            >
              {hint}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
