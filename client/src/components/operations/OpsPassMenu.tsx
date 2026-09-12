import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OpsBoardStaffRow } from "@/hooks/useOpsBoard";
import type { BoardLane, BoardOrder } from "@/lib/orderTypes";

/**
 * "Pass to…" — an inline strip of staff to hand one order to, sorted
 * station-match first, then present, then least loaded (brief, "Assignment,
 * stations & presence").
 *
 * Inline rather than a popover or a dialog on purpose: this opens from a card
 * inside a lane that can be two-thirds of a tablet's width beside the order
 * form, and a floating panel over a busy counter screen is one more thing a
 * finger can miss. `OpsCardActions` toggles this open beneath the card it
 * belongs to, the same shape `OpsDelayInline` uses for the same reason.
 */
export interface OpsPassMenuProps {
  order: BoardOrder;
  staff: OpsBoardStaffRow[];
  currentUserId?: string;
  disabled?: boolean;
  onAssign: (userId: string) => void;
  onCancel: () => void;
}

function sortForPass(staff: OpsBoardStaffRow[], lane: BoardLane): OpsBoardStaffRow[] {
  return [...staff].sort((a, b) => {
    const aMatch = a.station === lane || a.station === "both" ? 0 : 1;
    const bMatch = b.station === lane || b.station === "both" ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    if (a.present !== b.present) return a.present ? -1 : 1;
    return a.openCount - b.openCount;
  });
}

export function OpsPassMenu({ order, staff, currentUserId, disabled, onAssign, onCancel }: OpsPassMenuProps) {
  const candidates = sortForPass(
    staff.filter((member) => member.userId !== order.assignedUserId),
    order.fulfilmentMethod,
  );

  return (
    <div
      role="group"
      aria-label={`Pass order ${order.shortCode} to`}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2"
      data-testid={`ops-pass-menu-${order.id}`}
    >
      {candidates.length === 0 ? (
        <p className="px-1 py-1 text-sm text-muted-foreground">Nobody else is on the board yet.</p>
      ) : (
        candidates.map((member) => (
          <Button
            key={member.userId}
            type="button"
            size="touch"
            variant="outline"
            disabled={disabled}
            onClick={() => onAssign(member.userId)}
            data-testid={`ops-pass-to-${order.id}-${member.userId}`}
          >
            <span className={cn(!member.present && "text-muted-foreground")}>
              {member.name}
              {member.userId === currentUserId ? " (you)" : ""}
              {member.onBreak ? " · on break" : !member.present ? " · away" : ""}
            </span>
          </Button>
        ))
      )}
      <Button
        type="button"
        size="touch"
        variant="ghost"
        onClick={onCancel}
        data-testid={`ops-pass-cancel-${order.id}`}
      >
        Cancel
      </Button>
    </div>
  );
}
