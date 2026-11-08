export function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app-shell").classList.add("hidden");
}
export async function apiFetch(url, options = {}) {
  const timeout = String(url).includes("/tts") ? 150000 : 60000;
  const response = await fetch(url, {...options, signal: options.signal || AbortSignal.timeout(timeout)});
  if (response.status === 401) showLogin();
  return response;
}
export async function initializeSession(ready) {
  const reveal = async () => {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
    await ready();
  };
  document.getElementById("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const response = await apiFetch("/api/auth/login", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({password: document.getElementById("login-password").value})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ログインできませんでした");
      document.getElementById("login-password").value = "";
      document.getElementById("login-error").textContent = "";
      await reveal();
    } catch (error) { document.getElementById("login-error").textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await apiFetch("/api/auth/logout", {method: "POST"});
    location.reload();
  });
  try {
    const response = await apiFetch("/api/auth/status");
    if ((await response.json()).authenticated) await reveal();
    else showLogin();
  } catch (_) { showLogin(); document.getElementById("login-error").textContent = "サーバーに接続できません"; }
}
