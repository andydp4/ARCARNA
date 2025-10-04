import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md">
        {/* Logo & Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-accent rounded-2xl mb-4 shadow-lg">
            <i className="fas fa-cash-register text-3xl text-white"></i>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Midnight EPOS</h1>
          <p className="text-slate-300 text-base sm:text-lg">
            Enterprise Point of Sale System
          </p>
        </div>

        {/* Login Card */}
        <Card className="shadow-2xl border-slate-700">
          <CardContent className="p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">
              Welcome Back
            </h2>
            <p className="text-muted-foreground mb-6">
              Sign in to access your dashboard
            </p>

            <Button
              onClick={handleLogin}
              className="w-full min-h-[44px] bg-secondary hover:bg-blue-600 text-white font-medium py-3 px-4 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl"
              data-testid="button-login"
            >
              <i className="fab fa-codepen text-xl"></i>
              <span>Login with Replit</span>
            </Button>

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                Secure authentication powered by Replit Auth
              </p>
            </div>

            {/* Development Mode Notice */}
            <div className="mt-4 p-3 bg-accent/10 border border-accent/20 rounded-lg">
              <div className="flex items-start gap-2">
                <i className="fas fa-info-circle text-accent mt-0.5"></i>
                <div className="text-sm text-foreground">
                  <strong>Dev Mode:</strong> In development, this bypasses OAuth
                  and creates a test session.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-8 text-slate-400 text-sm">
          <p>© 2024 Midnight EPOS. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
