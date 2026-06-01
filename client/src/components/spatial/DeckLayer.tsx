import { cn } from "@/lib/utils";

type DeckNode = {
  id: string;
  cx: string;
  cy: string;
};

const NODES: DeckNode[] = [
  { id: "n1", cx: "18%", cy: "22%" },
  { id: "n2", cx: "82%", cy: "18%" },
  { id: "n3", cx: "12%", cy: "72%" },
  { id: "n4", cx: "88%", cy: "68%" },
  { id: "n5", cx: "50%", cy: "88%" },
];

const ARCS: Array<[string, string]> = [
  ["n1", "n2"],
  ["n2", "n4"],
  ["n3", "n5"],
  ["n4", "n5"],
];

function nodeById(id: string): DeckNode | undefined {
  return NODES.find((n) => n.id === id);
}

type DeckLayerProps = {
  className?: string;
};

export function DeckLayer({ className }: DeckLayerProps) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden
    >
      <svg
        className="h-full w-full text-metal-brushed"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="lm-deck-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              className="deck-grid-line"
              strokeWidth="0.75"
            />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill="url(#lm-deck-grid)" />

        {ARCS.map(([from, to]) => {
          const a = nodeById(from);
          const b = nodeById(to);
          if (!a || !b) return null;
          return (
            <path
              key={`${from}-${to}`}
              d={`M ${a.cx} ${a.cy} Q 50% 50% ${b.cx} ${b.cy}`}
              className="deck-arc"
              strokeWidth="1"
            />
          );
        })}

        {NODES.map((node) => (
          <circle
            key={node.id}
            cx={node.cx}
            cy={node.cy}
            r="3"
            className="deck-node"
          />
        ))}
      </svg>

      <div
        className="absolute inset-0 bg-gradient-to-b from-metal-graphite/20 via-transparent to-metal-graphite/40"
        aria-hidden
      />
    </div>
  );
}
