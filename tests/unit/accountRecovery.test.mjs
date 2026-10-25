import {describe, it, expect, vi} from "vitest";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../account-recovery.js", import.meta.url), "utf8");
const session = {access_token:"test-token",user:{id:"test-customer"}};

class Element {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.valid = true;
    this.focused = false;
  }
  addEventListener(event, callback) {this.listeners[event] = callback;}
  setAttribute(name, value) {this.attributes[name] = value;}
  removeAttribute(name) {delete this.attributes[name];}
  setCustomValidity(message) {this.validationMessage = message;}
  reportValidity() {return this.valid && !this.validationMessage;}
  focus() {this.focused = true;}
  async submit() {await this.listeners.submit({preventDefault() {}});}
  click() {this.listeners.click({preventDefault() {}});}
}

function setup({url="https://rainbowgoldcovering.com/reset-password.html",initialEvent,authOverrides={},available=true}={}) {
  const ids = ["recoveryRequestForm","recoveryPasswordForm","recoveryTitle","recoveryIntro",
    "recoveryStatus","recoveryEmail","recoveryPassword","recoveryPasswordConfirm",
    "recoveryFieldMessage","recoveryRequestSubmit","recoveryPasswordSubmit","recoveryNewLink"];
  const elements = Object.fromEntries(ids.map(id => [id,new Element()]));
  elements.recoveryPasswordForm.hidden = true;
  elements.recoveryNewLink.hidden = true;
  let listener;
  const auth = {
    onAuthStateChange:vi.fn(callback => {
      listener = callback;
      if (initialEvent) callback(initialEvent, session);
      return {data:{subscription:{unsubscribe:vi.fn()}}};
    }),
    getSession:vi.fn(async () => ({data:{session},error:null})),
    resetPasswordForEmail:vi.fn(async () => ({data:{},error:null})),
    updateUser:vi.fn(async () => ({data:{user:session.user},error:null})),
    ...authOverrides
  };
  const window = {
    location:{href:url},history:{replaceState:vi.fn()},
    RainbowSupabase:{getClient:vi.fn(() => available ? {auth} : null)},
    addEventListener:vi.fn(),setTimeout:vi.fn(() => 1),clearTimeout:vi.fn()
  };
  const document = {readyState:"complete",getElementById:id => elements[id]};
  vm.runInNewContext(source,{window,document,URL,URLSearchParams,Promise});
  return {elements,auth,window,emit:(event,recoverySession=session) => listener(event,recoverySession)};
}

const flush = async () => {await Promise.resolve();await Promise.resolve();await Promise.resolve();};

describe("customer password recovery", () => {
  it("does not unlock password changes for an ordinary existing sign-in session", async () => {
    const {elements,auth,emit} = setup();
    emit("INITIAL_SESSION");
    emit("SIGNED_IN");
    expect(elements.recoveryPasswordForm.hidden).toBe(true);
    await elements.recoveryPasswordForm.submit();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("sends one reset request with the exact same-origin callback and neutral success", async () => {
    let finish;
    const pending = new Promise(resolve => {finish=resolve;});
    const {elements,auth} = setup({authOverrides:{resetPasswordForEmail:vi.fn(() => pending)}});
    elements.recoveryEmail.value = " qa@example.invalid ";
    const first = elements.recoveryRequestForm.submit();
    await elements.recoveryRequestForm.submit();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("qa@example.invalid",{
      redirectTo:"https://rainbowgoldcovering.com/reset-password.html"
    });
    expect(elements.recoveryRequestSubmit.disabled).toBe(true);
    finish({error:null});
    await first;
    expect(elements.recoveryRequestSubmit.disabled).toBe(false);
    expect(elements.recoveryStatus.textContent).toContain("If an account matches");
    expect(elements.recoveryStatus.dataset.tone).toBe("success");
  });

  it("keeps an email on failure and permits a retry without leaking an account lookup", async () => {
    const send = vi.fn().mockResolvedValueOnce({error:{status:429}}).mockResolvedValueOnce({error:null});
    const {elements} = setup({authOverrides:{resetPasswordForEmail:send}});
    elements.recoveryEmail.value = "qa@example.invalid";
    await elements.recoveryRequestForm.submit();
    expect(elements.recoveryStatus.textContent).toContain("Too many requests");
    expect(elements.recoveryEmail.value).toBe("qa@example.invalid");
    expect(elements.recoveryRequestSubmit.disabled).toBe(false);
    await elements.recoveryRequestForm.submit();
    expect(elements.recoveryStatus.textContent).toContain("If an account matches");
  });

  it("leaves malformed or empty email validation to the required email field", async () => {
    const {elements,auth} = setup();
    elements.recoveryRequestForm.valid = false;
    await elements.recoveryRequestForm.submit();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("shows an expired-link recovery action and removes callback details from the URL", () => {
    const {elements,window,auth} = setup({url:"https://rainbowgoldcovering.com/reset-password.html#error=access_denied&error_code=otp_expired"});
    expect(elements.recoveryStatus.textContent).toContain("invalid or has expired");
    expect(elements.recoveryRequestForm.hidden).toBe(false);
    expect(elements.recoveryPasswordForm.hidden).toBe(true);
    expect(window.history.replaceState).toHaveBeenCalledWith(null,"","/reset-password.html");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("does not trust a forged recovery fragment paired with an ordinary session", async () => {
    const {elements,auth} = setup({url:"https://rainbowgoldcovering.com/reset-password.html#type=recovery",initialEvent:"INITIAL_SESSION"});
    await flush();
    expect(elements.recoveryPasswordForm.hidden).toBe(true);
    expect(elements.recoveryStatus.textContent).toContain("invalid or has expired");
    await elements.recoveryPasswordForm.submit();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("only updates matching valid entries after a genuine PASSWORD_RECOVERY event", async () => {
    const {elements,auth,emit,window} = setup({url:"https://rainbowgoldcovering.com/reset-password.html#type=recovery&access_token=test"});
    emit("PASSWORD_RECOVERY");
    await flush();
    expect(elements.recoveryPasswordForm.hidden).toBe(false);
    expect(elements.recoveryRequestForm.hidden).toBe(true);
    expect(elements.recoveryPassword.focused).toBe(true);
    expect(elements.recoveryStatus.textContent).toBe("");
    expect(window.history.replaceState).toHaveBeenCalled();
    elements.recoveryPassword.value = "Test-only-password";
    elements.recoveryPasswordConfirm.value = "Different-password";
    await elements.recoveryPasswordForm.submit();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(elements.recoveryFieldMessage.textContent).toContain("don’t match");
    expect(elements.recoveryPasswordConfirm.attributes["aria-invalid"]).toBe("true");
    elements.recoveryPasswordConfirm.value = "Test-only-password";
    await elements.recoveryPasswordForm.submit();
    expect(auth.updateUser).toHaveBeenCalledWith({password:"Test-only-password"});
    expect(elements.recoveryStatus.textContent).toContain("has been updated");
    expect(elements.recoveryPasswordForm.hidden).toBe(true);
    expect(elements.recoveryPassword.value).toBe("");
    expect(elements.recoveryPasswordConfirm.value).toBe("");
  });

  it("does not overwrite a valid synchronous recovery event with a checking spinner", async () => {
    const {elements} = setup({url:"https://rainbowgoldcovering.com/reset-password.html#type=recovery&access_token=test",initialEvent:"PASSWORD_RECOVERY"});
    await flush();
    expect(elements.recoveryPasswordForm.hidden).toBe(false);
    expect(elements.recoveryStatus.textContent).toBe("");
  });

  it("retains password entries on a retryable service failure", async () => {
    const {elements,emit} = setup({authOverrides:{updateUser:vi.fn(async () => ({error:{status:503}}))}});
    emit("PASSWORD_RECOVERY");
    elements.recoveryPassword.value = "Test-only-password";
    elements.recoveryPasswordConfirm.value = "Test-only-password";
    await elements.recoveryPasswordForm.submit();
    expect(elements.recoveryStatus.textContent).toContain("Your entries are still here");
    expect(elements.recoveryPassword.value).toBe("Test-only-password");
    expect(elements.recoveryPasswordSubmit.disabled).toBe(false);
  });

  it("blocks duplicate password submissions while an update is pending", async () => {
    let finish;
    const pending = new Promise(resolve => {finish=resolve;});
    const {elements,auth,emit} = setup({authOverrides:{updateUser:vi.fn(() => pending)}});
    emit("PASSWORD_RECOVERY");
    elements.recoveryPassword.value = "Test-only-password";
    elements.recoveryPasswordConfirm.value = "Test-only-password";
    const first = elements.recoveryPasswordForm.submit();
    await elements.recoveryPasswordForm.submit();
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(elements.recoveryPasswordSubmit.disabled).toBe(true);
    finish({error:null});
    await first;
    expect(elements.recoveryPasswordSubmit.disabled).toBe(false);
  });

  it("does not let a late callback replace a manually requested fresh-link form", async () => {
    let finish;
    const pending = new Promise(resolve => {finish=resolve;});
    const {elements,emit} = setup({url:"https://rainbowgoldcovering.com/reset-password.html#type=recovery",authOverrides:{getSession:vi.fn(() => pending)}});
    elements.recoveryNewLink.click();
    emit("PASSWORD_RECOVERY");
    finish({data:{session},error:null});
    await flush();
    expect(elements.recoveryPasswordForm.hidden).toBe(true);
    expect(elements.recoveryRequestForm.hidden).toBe(false);
    expect(elements.recoveryStatus.textContent).toBe("");
  });

  it("disables password updates and offers a fresh link after session expiration", async () => {
    const {elements,auth,emit} = setup({authOverrides:{updateUser:vi.fn(async () => ({error:{status:401}}))}});
    emit("PASSWORD_RECOVERY");
    elements.recoveryPassword.value = "Test-only-password";
    elements.recoveryPasswordConfirm.value = "Test-only-password";
    await elements.recoveryPasswordForm.submit();
    expect(elements.recoveryStatus.textContent).toContain("link has expired");
    expect(elements.recoveryRequestForm.hidden).toBe(false);
    expect(elements.recoveryPasswordForm.hidden).toBe(true);
    await elements.recoveryPasswordForm.submit();
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("keeps the request UI readable when the account client is unavailable", () => {
    const {elements} = setup({available:false});
    expect(elements.recoveryRequestSubmit.disabled).toBe(true);
    expect(elements.recoveryStatus.textContent).toContain("temporarily unavailable");
  });
});
