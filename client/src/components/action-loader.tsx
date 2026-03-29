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
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6 16c0-3.2 2.6-5.8 5.8-5.8 2.3 0 4.3 1.3 5.2 3.3M26 16c0 3.2-2.6 5.8-5.8 5.8-2.3 0-4.3-1.3-5.2-3.3"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-30"
      />
      <path
        d="M4.5 16c0-4 3.3-7.3 7.3-7.3 2.9 0 5.5 1.7 6.6 4.3"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-95"
      />
      <path
        d="M27.5 16c0 4-3.3 7.3-7.3 7.3-2.9 0-5.5-1.7-6.6-4.3"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-95"
      />
    </svg>
  );
}
