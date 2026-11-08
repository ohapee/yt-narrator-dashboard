import {jobRequest} from "./job-client.js";
import { HttpError, readJson } from "./http.js";

const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
export async function digest(value) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function sign(data, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}
export async function authenticated(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const bearer = request.headers.get("Authorization") || "";
  if (bearer.startsWith("Bearer ") && equal(await digest(bearer.slice(7)), await digest(env.ADMIN_TOKEN))) return true;
  const value = request.headers.get("Cookie")?.match(/(?:^|;\s*)yt_session=([^;]+)/)?.[1];
  if (!value) return false;
  const [expires, nonce, signature] = value.split(".");
  return Number(expires) > Date.now() && Number(expires) < Date.now() + 86400000 && !!nonce && !!signature && equal(await sign(`${expires}.${nonce}`, env.ADMIN_TOKEN), signature);
}
export async function requireAuthentication(request, env, bodyLimit = 262144) {
  if (!await authenticated(request, env)) throw new HttpError(401, "ログインしてください");
  const origin = request.headers.get("Origin");
  if (!["GET", "HEAD"].includes(request.method) && origin && origin !== new URL(request.url).origin) throw new HttpError(403, "操作元が一致しません");
  if (Number(request.headers.get("Content-Length")) > bodyLimit) throw new HttpError(413, "リクエストが大きすぎます");
}
export async function authRoute(request, env) {
  const path = new URL(request.url).pathname;
  const headers = {"Cache-Control": "no-store"};
  if (path === "/api/auth/status") return Response.json({authenticated: await authenticated(request, env)}, {headers});
  if (request.method !== "POST") throw new HttpError(405, "POSTを使用してください");
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "操作元が一致しません");
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  if (path === "/api/auth/logout") return Response.json({success: true}, {headers: {...headers, "Set-Cookie": `yt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`}});
  if (path !== "/api/auth/login") throw new HttpError(404, "見つかりません");
  if (!env.ADMIN_TOKEN) throw new HttpError(503, "管理者パスワードが未設定です");
  const body = await readJson(request, 2048);
  const valid = typeof body.password === "string" && body.password.length <= 200 && equal(await digest(body.password), await digest(env.ADMIN_TOKEN));
  const ip = await digest((request.headers.get("CF-Connecting-IP") || "local") + env.ADMIN_TOKEN);
  if (env.JOBS) {
    try { await jobRequest(env, "/login", {ip, valid}); }
    catch (error) { if (error.status === 429) throw new HttpError(429, "ログイン試行が多すぎます。15分後に再試行してください"); throw error; }
  }
  if (!valid) throw new HttpError(401, "パスワードが違います");
  const data = `${Date.now() + 43200000}.${crypto.randomUUID()}`;
  return Response.json({success: true}, {headers: {...headers, "Set-Cookie": `yt_session=${data}.${await sign(data, env.ADMIN_TOKEN)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`}});
}
