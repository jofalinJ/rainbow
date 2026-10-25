(() => {
  "use strict";

  function start() {
    const requestForm = document.getElementById("recoveryRequestForm");
    const passwordForm = document.getElementById("recoveryPasswordForm");
    if (!requestForm || !passwordForm) return;

    const title = document.getElementById("recoveryTitle");
    const intro = document.getElementById("recoveryIntro");
    const status = document.getElementById("recoveryStatus");
    const email = document.getElementById("recoveryEmail");
    const password = document.getElementById("recoveryPassword");
    const confirmation = document.getElementById("recoveryPasswordConfirm");
    const fieldMessage = document.getElementById("recoveryFieldMessage");
    const requestSubmit = document.getElementById("recoveryRequestSubmit");
    const passwordSubmit = document.getElementById("recoveryPasswordSubmit");
    const newLink = document.getElementById("recoveryNewLink");
    const incoming = new URL(window.location.href);
    const fragment = new URLSearchParams(incoming.hash.replace(/^#/, ""));
    const callbackError = incoming.searchParams.has("error") || incoming.searchParams.has("error_code") ||
      fragment.has("error") || fragment.has("error_code");
    const callbackAttempt = callbackError || incoming.searchParams.has("code") ||
      fragment.has("access_token") || fragment.has("refresh_token") || fragment.get("type") === "recovery";
    let recoveryReady = false;
    let callbackActive = true;
    let busy = false;
    let client;

    function message(text, tone = "info") {
      status.textContent = text;
      status.dataset.tone = tone;
    }

    function clearCallbackUrl() {
      if (callbackAttempt && window.history?.replaceState) {
        window.history.replaceState(null, "", incoming.pathname);
      }
    }

    function setBusy(pending, action) {
      busy = pending;
      requestSubmit.disabled = pending;
      passwordSubmit.disabled = pending;
      newLink.disabled = pending;
      requestForm.setAttribute("aria-busy", String(pending && action === "request"));
      passwordForm.setAttribute("aria-busy", String(pending && action === "password"));
      requestSubmit.textContent = pending && action === "request" ? "Sending link…" : "Send reset link";
      passwordSubmit.textContent = pending && action === "password" ? "Saving password…" : "Save new password";
    }

    function requestMode(text = "") {
      recoveryReady = false;
      requestForm.hidden = false;
      passwordForm.hidden = true;
      newLink.hidden = true;
      title.textContent = "Reset your password";
      intro.textContent = "Enter your account email address and we’ll help you reset your password.";
      if (text) message(text, "error");
    }

    function showRecovery(session) {
      if (!callbackActive || callbackError || !session?.access_token || !session.user?.id) return;
      recoveryReady = true;
      requestForm.hidden = true;
      passwordForm.hidden = false;
      newLink.hidden = false;
      title.textContent = "Choose a new password";
      intro.textContent = "Your reset link is ready. Enter and confirm your new password below.";
      message("");
      clearCallbackUrl();
      password.focus();
    }

    try {
      if (typeof window.RainbowSupabase?.getClient === "function") {
        client = window.RainbowSupabase.getClient();
      } else {
        const config = window.RAINBOW_SUPABASE_CONFIG || {};
        if (window.supabase?.createClient && config.supabaseUrl && config.supabasePublishableKey) {
          client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
        }
      }
    } catch {
      client = null;
    }

    if (!client?.auth) {
      requestSubmit.disabled = true;
      message("Account recovery is temporarily unavailable. Please reload this page or contact the store.", "error");
      return;
    }

    // This listener only updates the UI. Auth API calls must run outside the auth callback lock.
    const authSubscription = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") showRecovery(session);
    });
    window.addEventListener("pagehide", () => authSubscription?.data?.subscription?.unsubscribe(), {once: true});

    if (callbackError) {
      clearCallbackUrl();
      requestMode("This password reset link is invalid or has expired. Request a new link below.");
    } else if (callbackAttempt && !recoveryReady) {
      requestForm.hidden = true;
      newLink.hidden = false;
      message("Checking your reset link…");
      // A normal signed-in session is not sufficient: the SDK must emit PASSWORD_RECOVERY.
      // getSession waits for URL processing, so the recovery event can run before this settles.
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("recovery_timeout")), 15000);
      });
      Promise.race([client.auth.getSession(), timeout]).then(({error}) => {
        if (callbackActive && !recoveryReady) requestMode(error
          ? "We couldn’t check this reset link. Request a new link below."
          : "This password reset link is invalid or has expired. Request a new link below.");
      }).catch(() => {
        if (callbackActive && !recoveryReady) requestMode("We couldn’t check this reset link. Request a new link below.");
      }).finally(() => {
        window.clearTimeout(timer);
        clearCallbackUrl();
      });
    }

    requestForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !requestForm.reportValidity()) return;
      setBusy(true, "request");
      message("");
      try {
        const redirectTo = new URL("reset-password.html", incoming).href.split(/[?#]/)[0];
        const {error} = await client.auth.resetPasswordForEmail(email.value.trim(), {redirectTo});
        if (error) throw error;
        message("If an account matches that email address, you’ll receive a password reset link. Check your inbox and spam folder.", "success");
      } catch (error) {
        const limited = error?.status === 429 || /rate.limit|over_email_send_rate_limit/.test(error?.code || "");
        message(limited
          ? "Too many requests. Please wait a few minutes before requesting another link."
          : "We couldn’t send a reset link. Please try again. If this continues, contact the store.", "error");
      } finally {
        setBusy(false, "request");
      }
    });

    function clearFieldMessage() {
      confirmation.setCustomValidity("");
      fieldMessage.textContent = "";
      confirmation.removeAttribute("aria-invalid");
    }
    password.addEventListener("input", clearFieldMessage);
    confirmation.addEventListener("input", clearFieldMessage);

    passwordForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !recoveryReady) return;
      clearFieldMessage();
      if (!passwordForm.reportValidity()) return;
      if (password.value !== confirmation.value) {
        confirmation.setCustomValidity("Enter the same password in both fields.");
        confirmation.setAttribute("aria-invalid", "true");
        fieldMessage.textContent = "The passwords don’t match. Enter the same password in both fields.";
        confirmation.reportValidity();
        confirmation.focus();
        return;
      }
      setBusy(true, "password");
      message("");
      try {
        const {error} = await client.auth.updateUser({password: password.value});
        if (error) throw error;
        recoveryReady = false;
        callbackActive = false;
        password.value = "";
        confirmation.value = "";
        passwordForm.hidden = true;
        newLink.hidden = true;
        title.textContent = "Password updated";
        intro.textContent = "Your new password is ready to use.";
        message("Your password has been updated. You can return to the shop.", "success");
      } catch (error) {
        if (error?.status === 401 || error?.status === 403 || /session_not_found|refresh_token_not_found|bad_jwt/.test(error?.code || "")) {
          password.value = "";
          confirmation.value = "";
          requestMode("This password reset link has expired. Request a new link below.");
        } else {
          const weak = /weak_password|same_password/.test(error?.code || "");
          message(weak
            ? "Choose a stronger password that is different from your previous password, then try again."
            : "We couldn’t update your password. Your entries are still here; please try again.", "error");
        }
      } finally {
        setBusy(false, "password");
      }
    });

    newLink.addEventListener("click", () => {
      if (busy) return;
      callbackActive = false;
      password.value = "";
      confirmation.value = "";
      clearFieldMessage();
      requestMode();
      message("");
      email.focus();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
