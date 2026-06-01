import { cn } from "@/lib/utils";

type SkeletonVariant = "row" | "card" | "avatar";

export type SkeletonProps = {
  count?: number;
  variant?: SkeletonVariant;
  className?: string;
};

/** Pulse bar; static when user prefers reduced motion. */
export function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted",
        "animate-pulse motion-reduce:animate-none",
        className
      )}
      aria-hidden
    />
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/50 p-4">
      <SkeletonBar className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonBar className="h-4 w-40 max-w-[70%]" />
        <SkeletonBar className="h-3 w-56 max-w-[85%]" />
        <SkeletonBar className="h-3 w-24" />
      </div>
      <SkeletonBar className="hidden h-9 w-20 shrink-0 sm:block" />
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <SkeletonBar className="h-5 w-40 max-w-full" />
          <SkeletonBar className="h-3 w-24" />
        </div>
        <SkeletonBar className="h-6 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <SkeletonBar className="h-3 w-16" />
            <SkeletonBar className="h-4 w-full max-w-[5rem]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonAvatar() {
  return (
    <div className="flex items-center gap-3">
      <SkeletonBar className="h-12 w-12 shrink-0 rounded-full" />
      <div className="space-y-2">
        <SkeletonBar className="h-4 w-32" />
        <SkeletonBar className="h-3 w-20" />
      </div>
    </div>
  );
}

const variantRenderers: Record<SkeletonVariant, () => JSX.Element> = {
  row: SkeletonRow,
  card: SkeletonCard,
  avatar: SkeletonAvatar,
};

/**
 * List-page loading primitive: repeated row, card, or avatar placeholders.
 * Respects `prefers-reduced-motion` (no pulse).
 */
export function Skeleton({ count = 3, variant = "row", className }: SkeletonProps) {
  const Item = variantRenderers[variant];
  return (
    <div
      className={cn(variant === "card" ? "space-y-4" : "space-y-3", className)}
      aria-busy="true"
      aria-label="Loading content"
    >
      {Array.from({ length: count }).map((_, i) => (
        <Item key={i} />
      ))}
    </div>
  );
}
