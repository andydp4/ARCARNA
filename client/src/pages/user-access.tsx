import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Users, 
  UserCheck, 
  Shield, 
  Clock, 
  Trash2,
  Home,
  CheckCircle,
  XCircle,
  Crown
} from "lucide-react";
import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useOrg, type Organization } from "@/contexts/OrgContext";

const ASSIGNABLE_ROLES = ["ADMIN", "MANAGER", "CASHIER"] as const;

interface AllowedUser {
  id: string;
  replitUserId: string;
  email: string | null;
  name: string | null;
  isOwner: number;
  role?: string | null;
  orgId?: string | null;
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
  const { user: currentUser } = useAuth();
  const { organizations } = useOrg();
  const [confirmRemove, setConfirmRemove] = useState<AllowedUser | null>(null);
  const [removeAcknowledged, setRemoveAcknowledged] = useState(false);
  const [activeTab, setActiveTab] = useState("pending");
  const [approveTarget, setApproveTarget] = useState<ApprovalRequest | null>(null);
  const [approveRole, setApproveRole] = useState<string>("CASHIER");
  const [approveOrgId, setApproveOrgId] = useState<string>("");

  const { data: allowedUsers = [], isLoading: loadingUsers } = useQuery<AllowedUser[]>({
    queryKey: ["/api/admin/allowed-users"],
  });

  const { data: pendingApprovals = [], isLoading: loadingPending } = useQuery<ApprovalRequest[]>({
    queryKey: ["/api/admin/pending-approvals"],
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ replitUserId, role }: { replitUserId: string; role: string }) => {
      return apiRequest("PATCH", `/api/admin/allowed-users/${replitUserId}`, { role });
    },
    onSuccess: () => {
      toast({ title: "Role updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/allowed-users"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (payload: { replitUserId: string; role: string; orgId?: string }) => {
      return apiRequest("POST", `/api/admin/approve/${payload.replitUserId}`, {
        role: payload.role,
        orgId: payload.orgId || undefined,
      });
    },
    onSuccess: () => {
      toast({
        title: "User Approved",
        description: "The user can now access the system",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/allowed-users"] });
      setApproveTarget(null);
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
                <p className="text-sm text-muted-foreground">Manage who can access this organization</p>
                <Badge variant="outline" className="mt-2 font-normal">
                  Scope: this workspace / org
                </Badge>
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
                  New sign-ins appear here until an owner or admin approves them for this organization.
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
                        <CardContent className="space-y-4 pt-4">
                          <div className="flex items-center gap-3">
                            {request.profileImageUrl ? (
                              <img
                                src={request.profileImageUrl}
                                alt={request.name || "User"}
                                className="h-12 w-12 shrink-0 rounded-full"
                              />
                            ) : (
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                                <Users className="h-6 w-6 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-semibold">{request.name || "Unknown user"}</p>
                              <p className="text-sm text-muted-foreground">{request.email || "No email on file"}</p>
                              <p className="text-xs text-muted-foreground">Requested {formatDate(request.requestedAt)}</p>
                            </div>
                          </div>
                          <Separator />
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            <Button
                              onClick={() => {
                                setApproveTarget(request);
                                setApproveRole("CASHIER");
                                setApproveOrgId(
                                  currentUser?.role === "SUPER_ADMIN"
                                    ? organizations[0]?.id ?? ""
                                    : currentUser?.orgId ?? "",
                                );
                              }}
                              disabled={approveMutation.isPending}
                              className="min-h-[44px] w-full bg-green-600 hover:bg-green-700 sm:w-auto sm:flex-1"
                              data-testid={`button-approve-${request.replitUserId}`}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Approve access
                            </Button>
                            <Button
                              variant="outline"
                              className="min-h-[44px] w-full border-destructive/50 text-destructive hover:bg-destructive/10 sm:w-auto sm:flex-1"
                              onClick={() => rejectMutation.mutate(request.replitUserId)}
                              disabled={rejectMutation.isPending}
                              data-testid={`button-reject-${request.replitUserId}`}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Deny request
                            </Button>
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
                  Everyone listed below can sign in to this organization. Owner has full admin rights.
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
                              <Badge className="gap-1 bg-amber-500 text-white hover:bg-amber-500">
                                <Crown className="h-3 w-3" />
                                SUPER_ADMIN
                              </Badge>
                            ) : (
                              <Select
                                value={user.role ?? "CASHIER"}
                                onValueChange={(role) =>
                                  updateRoleMutation.mutate({ replitUserId: user.replitUserId, role })
                                }
                                disabled={updateRoleMutation.isPending}
                              >
                                <SelectTrigger className="h-9 w-[130px]" data-testid={`role-select-${user.replitUserId}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSIGNABLE_ROLES.map((r) => (
                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
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
                                className="min-h-[44px] border-destructive/40 text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                  setConfirmRemove(user);
                                  setRemoveAcknowledged(false);
                                }}
                                data-testid={`button-remove-${user.replitUserId}`}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove…
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

      <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Approve access</DialogTitle>
            <DialogDescription>
              Assign a role{currentUser?.role === "SUPER_ADMIN" ? " and organization" : ""} for{" "}
              <strong>{approveTarget?.name || approveTarget?.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={approveRole} onValueChange={setApproveRole}>
                <SelectTrigger data-testid="approve-role-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {currentUser?.role === "SUPER_ADMIN" && (
              <div className="space-y-2">
                <Label>Organization</Label>
                <Select value={approveOrgId} onValueChange={setApproveOrgId}>
                  <SelectTrigger data-testid="approve-org-select">
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org: Organization) => (
                      <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button
              onClick={() =>
                approveTarget &&
                approveMutation.mutate({
                  replitUserId: approveTarget.replitUserId,
                  role: approveRole,
                  orgId: currentUser?.role === "SUPER_ADMIN" ? approveOrgId : undefined,
                })
              }
              disabled={
                approveMutation.isPending ||
                (currentUser?.role === "SUPER_ADMIN" && !approveOrgId)
              }
              data-testid="button-confirm-approve"
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmRemove}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmRemove(null);
            setRemoveAcknowledged(false);
          }
        }}
      >
        <DialogContent className="border-destructive/20 sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">Remove access?</DialogTitle>
            <DialogDescription>
              <strong>{confirmRemove?.name || confirmRemove?.email}</strong> will no longer be able to sign in to this organization until
              approved again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <Checkbox
              id="remove-access-ack"
              checked={removeAcknowledged}
              onCheckedChange={(c) => setRemoveAcknowledged(c === true)}
              data-testid="checkbox-remove-access-ack"
              className="mt-0.5"
            />
            <Label htmlFor="remove-access-ack" className="cursor-pointer text-sm font-normal leading-snug">
              I understand this user will lose access immediately.
            </Label>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={() => setConfirmRemove(null)} className="min-h-[44px] w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemove && removeMutation.mutate(confirmRemove.replitUserId)}
              disabled={removeMutation.isPending || !removeAcknowledged}
              className="min-h-[44px] w-full sm:w-auto"
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? "Removing…" : "Remove access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
