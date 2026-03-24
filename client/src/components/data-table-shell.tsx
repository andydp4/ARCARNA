import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Consistent frame around tables (scroll lives on the inner Table wrapper). */
export function DataTableShell({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-border/80 bg-card shadow-sm", className)}
      {...props}
    />
  );
}

/** Scroll region for long tables; use with sticky TableHeader. */
export function DataTableScrollRegion({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "max-h-[min(380px,52vh)] overflow-auto rounded-lg border border-border/80 bg-card shadow-sm",
        className
      )}
      {...props}
    />
  );
}
