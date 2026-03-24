import { cn } from "@/lib/utils";

type ActionLoaderProps = {
  className?: string;
};

/**
 * Compact spinner for blocking button / inline actions (checkout, export, regenerate).
 * Full-page and list loading should keep using skeletons.
 */
export function ActionLoader({ className }: ActionLoaderProps) {
  return (
    <svg
      className={cn("size-4 shrink-0 animate-spin text-current", className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-95"
      />
    </svg>
  );
}
