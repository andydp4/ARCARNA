import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SetupBlocked() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Clock className="mx-auto h-12 w-12 text-yellow-500 mb-2" />
          <CardTitle>Setup in progress</CardTitle>
          <CardDescription>
            An administrator is completing organization setup. You can sign in again once setup is finished.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full min-h-[44px]" onClick={() => { window.location.href = "/api/logout"; }}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
