import { SignIn } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";

export default function SignInPage() {
  const { data: runtime } = useQuery({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
  });

  if (runtime?.authProvider !== "clerk") {
    window.location.href = "/api/login";
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-slate-800 to-slate-900 px-4">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-in" afterSignInUrl="/" />
    </div>
  );
}
