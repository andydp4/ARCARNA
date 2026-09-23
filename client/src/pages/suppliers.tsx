import { Truck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { SuppliersHub } from "@/components/stock/SuppliersHub";

/**
 * Stock Centre › Suppliers (v1.2 Phase 3). Moved out of the Settings tabs:
 * suppliers are stock, not setup. Managers and above only — every supplier
 * read carries cost prices, and the server refuses them below MANAGER
 * (shared/accessPolicy.ts). Builds on the purchasing fixes in PR #225.
 */
export default function SuppliersPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={Truck}
        title="Suppliers"
        question="Who do you buy from, and do their prices match your product cards?"
        explanation="Each supplier's price sits beside the cost on the product card. A flag means they differ by more than 2%, or one is missing — update whichever is wrong."
      />
      <SuppliersHub />
    </div>
  );
}
