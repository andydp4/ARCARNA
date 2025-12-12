import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Users, 
  UserCheck, 
  UserX, 
  Shield, 
  Clock, 
  Trash2,
  Home,
  CheckCircle,
  XCircle,
  Crown
} from "lucide-react";
import { Link } from "wouter";

interface AllowedUser {
  id: string;
  replitUserId: string;
  email: string | null;
  name: string | null;
  isOwner: number;
  createdAt: string;
}

interface ApprovalRequest {
  id: string;
  replitUserId: string;
  email: string | null;
  name: string | null;
  profileImageUrl: string | null;
  status: string;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export default function UserAccess() {
  const { toast } = useToast();
  const [confirmRemove, setConfirmRemove] = useState<AllowedUser | null>(null);
  const [activeTab, setActiveTab] = useState("pending");

  const { data: allowedUsers = [], isLoading: loadingUsers } = useQuery<AllowedUser[]>({
    queryKey: ["/api/admin/allowed-users"],
  });

  const { data: pendingApprovals = [], isLoading: loadingPending } = useQuery<ApprovalRequest[]>({
    queryKey: ["/api/admin/pending-approvals"],
  });

  const approveMutation = useMutation({
    mutationFn: async (replitUserId: string) => {
      return apiRequest("POST", `/api/admin/approve/${replitUserId}`);
    },
    onSuccess: () => {
      toast({
        title: "User Approved",
        description: "The user can now access the system",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/allowed-users"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to approve user",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (replitUserId: string) => {
      return apiRequest("POST", `/api/admin/reject/${replitUserId}`);
    },
    onSuccess: () => {
      toast({
        title: "User Rejected",
        description: "The user's access request has been denied",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-approvals"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reject user",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (replitUserId: string) => {
      return apiRequest("DELETE", `/api/admin/allowed-users/${replitUserId}`);
    },
    onSuccess: () => {
      toast({
        title: "User Removed",
        description: "The user has been removed from the allowed list",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/allowed-users"] });
      setConfirmRemove(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove user",
        variant: "destructive",
      });
    },
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" data-testid="button-back">
                  <Home className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-500" />
                  User Access Control
                </h1>
                <p className="text-sm text-muted-foreground">Manage who can access the system</p>
              </div>
            </div>
            {pendingApprovals.length > 0 && (
              <Badge variant="destructive" className="text-sm">
                {pendingApprovals.length} Pending
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="pending" className="flex items-center gap-2 min-h-[44px]" data-testid="tab-pending">
              <Clock className="h-4 w-4" />
              Pending Approvals
              {pendingApprovals.length > 0 && (
                <Badge variant="secondary" className="ml-1">{pendingApprovals.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="allowed" className="flex items-center gap-2 min-h-[44px]" data-testid="tab-allowed">
              <UserCheck className="h-4 w-4" />
              Allowed Users
              <Badge variant="secondary" className="ml-1">{allowedUsers.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  Pending Approval Requests
                </CardTitle>
                <CardDescription>
                  Users waiting for access to the system
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingPending ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : pendingApprovals.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <UserCheck className="h-12 w-12 mx-auto mb-4 opacity-30" />
                    <p>No pending approval requests</p>
                    <p className="text-sm">New login attempts will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pendingApprovals.map((request) => (
                      <Card key={request.id} className="border-yellow-200 bg-yellow-50/30 dark:bg-yellow-900/10" data-testid={`pending-user-${request.replitUserId}`}>
                        <CardContent className="pt-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              {request.profileImageUrl ? (
                                <img 
                                  src={request.profileImageUrl} 
                                  alt={request.name || 'User'} 
                                  className="h-12 w-12 rounded-full"
                                />
                              ) : (
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                  <Users className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                              <div>
                                <p className="font-medium">{request.name || 'Unknown User'}</p>
                                <p className="text-sm text-muted-foreground">{request.email || 'No email'}</p>
                                <p className="text-xs text-muted-foreground">
                                  Requested: {formatDate(request.requestedAt)}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                onClick={() => approveMutation.mutate(request.replitUserId)}
                                disabled={approveMutation.isPending}
                                className="min-h-[44px] bg-green-600 hover:bg-green-700"
                                data-testid={`button-approve-${request.replitUserId}`}
                              >
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Approve
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => rejectMutation.mutate(request.replitUserId)}
                                disabled={rejectMutation.isPending}
                                className="min-h-[44px]"
                                data-testid={`button-reject-${request.replitUserId}`}
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                Reject
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="allowed">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-green-500" />
                  Allowed Users
                </CardTitle>
                <CardDescription>
                  Users who have access to the system
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingUsers ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : allowedUsers.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
                    <p>No allowed users yet</p>
                    <p className="text-sm">The first person to log in will become the owner</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Added</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allowedUsers.map((user) => (
                        <TableRow key={user.id} data-testid={`allowed-user-${user.replitUserId}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {user.name || 'Unknown'}
                              {user.isOwner === 1 && (
                                <Crown className="h-4 w-4 text-yellow-500" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {user.email || 'No email'}
                          </TableCell>
                          <TableCell>
                            {user.isOwner === 1 ? (
                              <Badge className="bg-yellow-500">Owner</Badge>
                            ) : (
                              <Badge variant="secondary">User</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDate(user.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            {user.isOwner !== 1 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-red-600 min-h-[44px]"
                                onClick={() => setConfirmRemove(user)}
                                data-testid={`button-remove-${user.replitUserId}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={!!confirmRemove} onOpenChange={() => setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove User Access</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{confirmRemove?.name || confirmRemove?.email}</strong> from the allowed users list? 
              They will need to request access again to use the system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmRemove(null)} className="min-h-[44px]">
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => confirmRemove && removeMutation.mutate(confirmRemove.replitUserId)}
              disabled={removeMutation.isPending}
              className="min-h-[44px]"
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? "Removing..." : "Remove Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
