import { ShieldOff, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

export default function NoAccess() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
            <ShieldOff className="h-8 w-8 text-red-600" />
          </div>
          <CardTitle className="text-2xl">No organization access</CardTitle>
          <CardDescription>
            Your account is approved but not assigned to an organization yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user?.email && (
            <p className="text-sm text-center text-muted-foreground">{user.email}</p>
          )}
          <p className="text-sm text-center text-muted-foreground">
            Contact a platform administrator to assign you to an organization and role.
          </p>
          <Button
            variant="outline"
            className="w-full min-h-[44px]"
            onClick={() => { window.location.href = "/api/logout"; }}
            data-testid="button-logout-no-access"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
