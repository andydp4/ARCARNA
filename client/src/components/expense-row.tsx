import { memo } from "react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Edit, Trash2 } from "lucide-react";
import type { OverheadExpense } from "@shared/schema";

function getCategoryIcon(category: string) {
  switch (category) {
    case "rent":
      return "🏢";
    case "utilities":
      return "⚡";
    case "salaries":
      return "💰";
    case "insurance":
      return "🛡️";
    case "marketing":
      return "📢";
    case "maintenance":
      return "🔧";
    case "supplies":
      return "📦";
    case "taxes":
      return "📋";
    default:
      return "💵";
  }
}

function formatCurrency(amount: string | number) {
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(numAmount);
}

export type ExpenseRowProps = {
  expense: OverheadExpense;
  onEdit: (expense: OverheadExpense) => void;
  onDelete: (id: string) => void;
};

function ExpenseRowInner({ expense, onEdit, onDelete }: ExpenseRowProps) {
  return (
    <TableRow>
      <TableCell>
        <span className="mr-2">{getCategoryIcon(expense.category)}</span>
        {expense.category}
      </TableCell>
      <TableCell className="font-medium" data-testid={`text-expense-name-${expense.id}`}>
        {expense.name}
        {expense.description && (
          <div className="text-sm text-muted-foreground">{expense.description}</div>
        )}
      </TableCell>
      <TableCell data-testid={`text-expense-amount-${expense.id}`}>
        {formatCurrency(expense.amount)}
      </TableCell>
      <TableCell className="capitalize">{expense.frequency}</TableCell>
      <TableCell>{new Date(expense.startDate).toLocaleDateString()}</TableCell>
      <TableCell>
        {expense.endDate ? new Date(expense.endDate).toLocaleDateString() : "-"}
      </TableCell>
      <TableCell>
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
            expense.isActive === 1 ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
          }`}
        >
          {expense.isActive === 1 ? "Active" : "Inactive"}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit(expense)}
            data-testid={`button-edit-expense-${expense.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onDelete(expense.id)}
            data-testid={`button-delete-expense-${expense.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export const ExpenseRow = memo(
  ExpenseRowInner,
  (prev, next) =>
    prev.expense === next.expense &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete
);
