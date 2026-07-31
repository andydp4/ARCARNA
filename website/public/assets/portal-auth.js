/*
 * Viger Cloud portal auth — adapted for the /apps page (#portal-root).
 * Uses the same Clerk application as Arcarna (see clerk-config.js).
 */
(function () {
  "use strict";

  var CLERK_JS_VERSION = "5";
  var root = document.getElementById("portal-root");
  if (!root) return;

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, isError) {
    var el = byId("auth-gate-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("auth-gate-error", !!isError);
  }

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
    root.classList.toggle("gate-open", signedIn);
    root.classList.toggle("gate-locked", !signedIn);
  }

  function applyAppPermissions(clerk) {
    var meta = (clerk.user && clerk.user.publicMetadata) || {};
    var allowed = meta.apps;
    var isSuperAdmin = meta.role === "SUPER_ADMIN" || meta.superAdmin === true;
    var tiles = root.querySelectorAll("[data-app]");
    for (var i = 0; i < tiles.length; i++) {
      var key = tiles[i].getAttribute("data-app");
      var permitted = isSuperAdmin || !Array.isArray(allowed) || allowed.indexOf(key) !== -1;
      tiles[i].hidden = !permitted;
    }
  }

  function applyAuthState(clerk) {
    if (clerk.user) {
      reveal(true);
      applyAppPermissions(clerk);
      var ub = byId("user-button");
      if (ub && !ub.dataset.mounted) {
        clerk.mountUserButton(ub, { afterSignOutUrl: window.location.origin + "/apps" });
        ub.dataset.mounted = "1";
      }
    } else {
      reveal(false);
      var target = byId("clerk-signin");
      if (target && !target.dataset.mounted) {
        clerk.mountSignIn(target, {
          fallbackRedirectUrl: window.location.href,
          signInFallbackRedirectUrl: window.location.href,
          signUpFallbackRedirectUrl: window.location.href,
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
    s.src =
      "https://" +
      fapi +
      "/npm/@clerk/clerk-js@" +
      CLERK_JS_VERSION +
      "/dist/clerk.browser.js";
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
      setStatus(
        "Sign-in is not configured yet. Set your Clerk publishable key in public/assets/clerk-config.js.",
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
