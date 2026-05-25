import { SignIn, useUser } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { appUrl } from "@/lib/authConfig";

const clerkAppearance = {
  elements: {
    rootBox: "w-full",
    card: "shadow-none border-0 p-0 w-full",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    footerAction: "hidden",
    footerActionLink: "hidden",
  },
};

/** Clerk sign-in UI — must render under ClerkProvider. */
export function ClerkSignInPanel({ routing = "hash" }: { routing?: "hash" | "path" }) {
  const [, setLocation] = useLocation();
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <Button disabled className="w-full min-h-[44px]">
        Loading sign-in…
      </Button>
    );
  }

  if (isSignedIn) {
    return (
      <Button
        className="w-full min-h-[44px]"
        onClick={() => setLocation("/")}
        data-testid="button-continue"
      >
        Continue to dashboard
      </Button>
    );
  }

  const signInProps = {
    signUpUrl: appUrl("/sign-in"),
    signInUrl: appUrl("/sign-in"),
    fallbackRedirectUrl: appUrl("/"),
    forceRedirectUrl: appUrl("/"),
    appearance: clerkAppearance,
  };

  return (
    <div className="w-full flex justify-center [&_.cl-rootBox]:w-full" data-testid="clerk-sign-in">
      {routing === "path" ? (
        <SignIn routing="path" path="/sign-in" {...signInProps} />
      ) : (
        <SignIn routing="hash" {...signInProps} />
      )}
    </div>
  );
}
