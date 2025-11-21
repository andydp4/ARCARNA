import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function TopCustomersTable() {
  const { data: topCustomers, isLoading } = useQuery({
    queryKey: ["/api/analytics/top-customers"],
  });

  const getCustomerStatus = (category: string) => {
    const categoryLower = category?.toLowerCase() || "bronze";
    if (categoryLower === "vip") return { variant: "default" as const, label: "VIP", className: "bg-accent/10 text-accent" };
    if (categoryLower === "gold") return { variant: "secondary" as const, label: "Gold", className: "bg-secondary/10 text-secondary" };
    return { variant: "outline" as const, label: "Silver", className: "bg-muted text-foreground" };
  };

  const getRFMBars = (score: number) => {
    const maxScore = 15;
    const filledBars = Math.round((score / maxScore) * 5);
    return Array.from({ length: 5 }, (_, i) => i < filledBars);
  };

  const getInitials = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Top Customers
            </h3>
            <p className="text-sm text-muted-foreground">
              Ranked by Customer Lifetime Value (CLV)
            </p>
          </div>
          <button className="px-4 py-2 text-sm font-medium text-secondary hover:bg-secondary/10 rounded-lg transition-colors" data-testid="button-viewallcustomers">
            View All
            <i className="fas fa-arrow-right ml-2"></i>
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Customer</TableHead>
                    <TableHead className="font-semibold">Email</TableHead>
                    <TableHead className="font-semibold">Orders</TableHead>
                    <TableHead className="font-semibold">Total Spent</TableHead>
                    <TableHead className="font-semibold">RFM Score</TableHead>
                    <TableHead className="font-semibold">CLV</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(topCustomers as any[])?.length > 0 ? (
                    (topCustomers as any[]).map((customer: any, index: number) => {
                      const status = getCustomerStatus(customer.category);
                      const rfmBars = getRFMBars(customer.rfmScore || 0);
                      const initials = getInitials(customer.name || "");
                      const bgColors = [
                        "from-secondary to-accent",
                        "from-purple-500 to-pink-500",
                        "from-orange-500 to-red-500",
                        "from-blue-500 to-cyan-500",
                        "from-green-500 to-emerald-500",
                      ];
                      const bgColor = bgColors[index % bgColors.length];

                      return (
                        <TableRow
                          key={customer.id}
                          className="hover:bg-muted/30 transition-colors"
                          data-testid={`row-customer-${customer.id}`}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-10 h-10 bg-gradient-to-br ${bgColor} rounded-full flex items-center justify-center text-white font-semibold`}
                              >
                                {initials}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-foreground" data-testid={`text-customername-${customer.id}`}>
                                  {customer.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  ID: #{customer.id.substring(0, 8)}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm text-foreground" data-testid={`text-customeremail-${customer.id}`}>
                              {customer.email || "N/A"}
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm font-medium text-foreground" data-testid={`text-ordercount-${customer.id}`}>
                              {customer.orderCount}
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm font-semibold text-foreground" data-testid={`text-totalspent-${customer.id}`}>
                              ${parseFloat(customer.totalSpent).toLocaleString()}
                            </p>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex gap-1">
                                {rfmBars.map((filled, i) => (
                                  <div
                                    key={i}
                                    className={`w-2 h-6 rounded-sm ${
                                      filled ? "bg-accent" : "bg-muted"
                                    }`}
                                  ></div>
                                ))}
                              </div>
                              <span className="text-sm font-semibold text-foreground" data-testid={`text-rfmscore-${customer.id}`}>
                                {customer.rfmScore}/15
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm font-bold text-accent" data-testid={`text-clv-${customer.id}`}>
                              ${parseFloat(customer.clv).toLocaleString()}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge className={status.className}>
                              {status.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <p className="text-muted-foreground">No customers available</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="px-6 py-4 border-t border-border bg-muted/30">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing <span className="font-medium text-foreground">1</span>{" "}
                  to{" "}
                  <span className="font-medium text-foreground">
                    {topCustomers?.length || 0}
                  </span>{" "}
                  of{" "}
                  <span className="font-medium text-foreground">
                    {topCustomers?.length || 0}
                  </span>{" "}
                  customers
                </p>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 text-sm font-medium text-muted-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                    disabled
                    data-testid="button-prevpage"
                  >
                    <i className="fas fa-chevron-left"></i>
                  </button>
                  <button className="px-3 py-1 text-sm font-medium text-white bg-secondary rounded-lg" data-testid="button-page1">
                    1
                  </button>
                  <button
                    className="px-3 py-1 text-sm font-medium text-muted-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
                    disabled
                    data-testid="button-nextpage"
                  >
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
