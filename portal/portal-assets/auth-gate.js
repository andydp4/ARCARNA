/*
 * Viger Cloud portal — Clerk auth gate.
 *
 * The portal is a static site (no server). This script gates it on the client:
 * the sign-in card is the first thing shown, and the app grid is revealed only
 * after a user is signed in. The portal uses its OWN Clerk application, kept
 * SEPARATE from Arcarna, so a viger.cloud login is independent of a login on
 * arcarna.viger.cloud (see portal-assets/clerk-config.js).
 *
 * NOTE: client-side gating is a UX gate for the launcher, not a security
 * boundary. Real access control lives on each app subdomain (e.g.
 * arcarna.viger.cloud enforces Clerk server-side). Do not put secrets in the
 * static portal.
 *
 * Config: portal-assets/clerk-config.js sets window.__VIGER_CLERK_PUBLISHABLE_KEY__.
 */
(function () {
  "use strict";

  var CLERK_JS_VERSION = "5";

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, isError) {
    var el = byId("auth-gate-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("auth-gate-error", !!isError);
  }

  /**
   * Clerk publishable keys encode the Frontend API host as base64 of
   * "<host>$". Decode it so the script works for whatever key the operator
   * sets (production custom domain or *.clerk.accounts.dev for testing).
   */
  function frontendApiFromKey(pk) {
    try {
      var body = pk.split("_")[2];
      if (!body) return null;
      var decoded = atob(body);
      return decoded.replace(/\$+$/, "") || null;
    } catch (e) {
      return null;
    }
  }

  function reveal(signedIn) {
    document.body.classList.toggle("gate-open", signedIn);
    document.body.classList.toggle("gate-locked", !signedIn);
  }

  function applyAuthState(clerk) {
    if (clerk.user) {
      reveal(true);
      var ub = byId("user-button");
      if (ub && !ub.dataset.mounted) {
        clerk.mountUserButton(ub, { afterSignOutUrl: window.location.origin + "/" });
        ub.dataset.mounted = "1";
      }
    } else {
      reveal(false);
      var target = byId("clerk-signin");
      if (target && !target.dataset.mounted) {
        clerk.mountSignIn(target, {
          // Reload this page after auth so the grid is revealed in place.
          fallbackRedirectUrl: window.location.href,
          signInFallbackRedirectUrl: window.location.href,
          signUpFallbackRedirectUrl: window.location.href
        });
        target.dataset.mounted = "1";
      }
      setStatus("");
    }
  }

  function startClerk(pk) {
    var clerk = window.Clerk;
    if (!clerk || typeof clerk.load !== "function") {
      setStatus("Sign-in service did not initialise. Please refresh.", true);
      return;
    }
    clerk
      .load()
      .then(function () {
        applyAuthState(clerk);
        clerk.addListener(function () {
          applyAuthState(clerk);
        });
      })
      .catch(function () {
        setStatus("Could not start sign-in. Please refresh and try again.", true);
      });
  }

  function loadClerkScript(pk) {
    var fapi = frontendApiFromKey(pk);
    if (!fapi) {
      setStatus("Sign-in is misconfigured (invalid publishable key).", true);
      return;
    }
    var s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.setAttribute("data-clerk-publishable-key", pk);
    s.src = "https://" + fapi + "/npm/@clerk/clerk-js@" + CLERK_JS_VERSION + "/dist/clerk.browser.js";
    s.onload = function () {
      startClerk(pk);
    };
    s.onerror = function () {
      setStatus("Could not reach the sign-in service. Check your connection.", true);
    };
    document.head.appendChild(s);
  }

  function init() {
    var pk = window.__VIGER_CLERK_PUBLISHABLE_KEY__;
    if (!pk || /CHANGE_ME/.test(pk)) {
      // Stay locked and tell the operator what to do (never fail open).
      setStatus(
        "Sign-in is not configured yet. Set your Clerk publishable key in portal-assets/clerk-config.js.",
        true
      );
      return;
    }
    setStatus("Loading sign-in…");
    loadClerkScript(pk);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
