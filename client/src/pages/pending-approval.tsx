import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, LogOut, XCircle, RefreshCw } from "lucide-react";

interface ApprovalStatus {
  authenticated: boolean;
  isAllowed: boolean;
  isPending: boolean;
  isRejected: boolean;
  name: string;
  email: string;
}

export default function PendingApproval() {
  const { data: status, isLoading, refetch } = useQuery<ApprovalStatus>({
    queryKey: ["/api/auth/approval-status"],
    queryFn: async () => {
      const response = await apiFetch("/api/auth/approval-status", { credentials: 'include' });
      return response.json();
    },
    refetchInterval: 30000,
  });

  const handleLogout = () => {
    window.location.href = '/api/logout';
  };

  const handleRefresh = () => {
    refetch();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (status?.isAllowed) {
    window.location.href = '/';
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {status?.isRejected ? (
            <>
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
              <CardTitle className="text-2xl text-red-600">Access Denied</CardTitle>
              <CardDescription>
                Your access request has been rejected
              </CardDescription>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-center">
                <Clock className="h-8 w-8 text-yellow-600 animate-pulse" />
              </div>
              <CardTitle className="text-2xl">Access Pending</CardTitle>
              <CardDescription>
                Your request is waiting for approval
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center space-y-2">
            <p className="text-lg font-medium">Hello, {status?.name || 'User'}</p>
            {status?.email && (
              <p className="text-sm text-muted-foreground">{status.email}</p>
            )}
          </div>

          {status?.isRejected ? (
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-center text-red-700 dark:text-red-400">
                The system administrator has denied your access request. 
                If you believe this is an error, please contact the administrator.
              </p>
            </div>
          ) : (
            <div className="bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <p className="text-sm text-center text-yellow-700 dark:text-yellow-400">
                The system administrator will review your access request. 
                This page will automatically update when your request is processed.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button 
              onClick={handleRefresh}
              variant="outline"
              className="w-full min-h-[44px]"
              data-testid="button-refresh-status"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Check Status
            </Button>
            <Button 
              onClick={handleLogout}
              variant="ghost"
              className="w-full min-h-[44px] text-muted-foreground"
              data-testid="button-logout"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Status checks automatically every 30 seconds
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
