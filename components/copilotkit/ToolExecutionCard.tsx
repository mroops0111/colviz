"use client";

import { CheckCircle, Loader2, LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ToolStatus = "inProgress" | "executing" | "complete" | "error";

export interface ToolExecutionCardProps {
  title: string;
  icon?: LucideIcon;
  status: ToolStatus;
  className?: string;
  query?: string;
  resultSummary?: string;
  resultDetails?: string;
}

export function ToolExecutionCard({
  title,
  icon: Icon,
  status,
  className,
  query,
  resultSummary,
  resultDetails,
}: ToolExecutionCardProps) {
  const isLoading = status === "inProgress" || status === "executing";

  return (
    <Card
      className={cn(
        "w-full max-w-2xl border shadow-sm bg-muted/30 dark:bg-muted/20",
        className
      )}
    >
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-center gap-2.5">
          <div className="flex-shrink-0 text-primary">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : Icon ? (
              <Icon className="h-4 w-4" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium">{title}</span>
            {status === "complete" && (
              <CheckCircle className="inline-block h-3 w-3 ml-1.5 text-muted-foreground" />
            )}
          </div>
        </div>
        {query && (
          <p className="text-[11px] text-muted-foreground truncate pl-6">
            {query}
          </p>
        )}
        {resultSummary && (
          <p className="text-xs text-muted-foreground pl-6">{resultSummary}</p>
        )}
        {resultDetails && (
          <pre className="text-[11px] text-muted-foreground pl-6 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
            {resultDetails}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
