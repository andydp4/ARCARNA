import type { BulkActionDef } from "@shared/bulkActions";
import { Button } from "@/components/ui/button";

type Props = {
  count: number;
  actions: BulkActionDef[];
  onAction: (actionId: BulkActionDef["id"]) => void;
  onClear: () => void;
  busy?: boolean;
};

export function BulkActionBar({ count, actions, onAction, onClear, busy }: Props) {
  if (count <= 0) return null;

  return (
    <div className="sticky bottom-4 z-20 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
      <span className="text-sm font-medium">{count} selected</span>
      {actions.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.destructive ? "destructive" : "secondary"}
          disabled={busy}
          onClick={() => onAction(action.id)}
        >
          {action.label}
        </Button>
      ))}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
