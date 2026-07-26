import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "./crypto";

const AUTHORIZE_URL = "https://auth.worksmobile.com/oauth2/v2.0/authorize";
const TOKEN_URL = "https://auth.worksmobile.com/oauth2/v2.0/token";
const API_BASE = "https://www.worksapis.com/v1.0";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: string | number;
  scope?: string;
  token_type: string;
};

export type WorksDriveFile = {
  fileId: string;
  parentFileId?: string;
  fileName: string;
  fileSize?: number;
  filePath?: string;
  fileType: string;
  modifiedTime?: string;
  fileExtension?: string;
};

function credentials() {
  const clientId = process.env.NAVER_WORKS_CLIENT_ID;
  const clientSecret = process.env.NAVER_WORKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("NAVER WORKS OAuth 환경변수가 설정되지 않았습니다.");
  return { clientId, clientSecret };
}

export function oauthRedirectUri() {
  return process.env.NAVER_WORKS_REDIRECT_URI
    || `${process.env.NEXT_PUBLIC_SITE_URL || "https://woolim-site.vercel.app"}/api/admin/naver-works/callback`;
}

export function authorizationUrl(state: string) {
  const { clientId } = credentials();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", oauthRedirectUri());
  url.searchParams.set("scope", "file.read");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: URLSearchParams) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || `토큰 요청 실패: ${response.status}`);
  return payload as TokenResponse;
}

export async function exchangeAuthorizationCode(code: string, connectedBy: string) {
  const { clientId, clientSecret } = credentials();
  const token = await tokenRequest(new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: oauthRedirectUri(),
  }));
  if (!token.refresh_token) throw new Error("Refresh Token이 발급되지 않았습니다.");
  const expiresAt = new Date(Date.now() + Number(token.expires_in) * 1000);
  const { error } = await createAdminClient().from("naver_works_connections").upsert({
    id: "primary",
    status: "connected",
    access_token_encrypted: encryptToken(token.access_token),
    refresh_token_encrypted: encryptToken(token.refresh_token),
    token_expires_at: expiresAt.toISOString(),
    scopes: (token.scope || "file.read").split(/[,\s]+/).filter(Boolean),
    connected_by: connectedBy,
    connected_at: new Date().toISOString(),
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

async function refreshConnection(refreshTokenEncrypted: string) {
  const { clientId, clientSecret } = credentials();
  const token = await tokenRequest(new URLSearchParams({
    refresh_token: decryptToken(refreshTokenEncrypted),
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
  }));
  const expiresAt = new Date(Date.now() + Number(token.expires_in) * 1000);
  const patch: Record<string, unknown> = {
    status: "connected",
    access_token_encrypted: encryptToken(token.access_token),
    token_expires_at: expiresAt.toISOString(),
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  if (token.refresh_token) patch.refresh_token_encrypted = encryptToken(token.refresh_token);
  const { error } = await createAdminClient().from("naver_works_connections").update(patch).eq("id", "primary");
  if (error) throw new Error(error.message);
  return token.access_token;
}

export async function accessToken() {
  const admin = createAdminClient();
  const { data, error } = await admin.from("naver_works_connections")
    .select("status,access_token_encrypted,refresh_token_encrypted,token_expires_at")
    .eq("id", "primary").single();
  if (error) throw new Error(error.message);
  if (!data?.access_token_encrypted || !data.refresh_token_encrypted) throw new Error("NAVER WORKS Drive가 연결되지 않았습니다.");
  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 5 * 60 * 1000) return decryptToken(data.access_token_encrypted);
  try {
    return await refreshConnection(data.refresh_token_encrypted);
  } catch (refreshError) {
    await admin.from("naver_works_connections").update({
      status: "expired",
      last_error: refreshError instanceof Error ? refreshError.message : "토큰 갱신 실패",
      updated_at: new Date().toISOString(),
    }).eq("id", "primary");
    throw refreshError;
  }
}

export async function worksApi<T>(path: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`NAVER WORKS API 오류: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export async function listDriveRoot(cursor?: string) {
  const query = new URLSearchParams({ count: "200", orderBy: "modifiedTime desc" });
  if (cursor) query.set("cursor", cursor);
  return worksApi<{ files: WorksDriveFile[]; responseMetaData?: { nextCursor?: string } }>(
    `/users/me/drive/files?${query}`,
  );
}

export async function listDriveChildren(fileId: string, cursor?: string) {
  const query = new URLSearchParams({ count: "200", orderBy: "modifiedTime desc" });
  if (cursor) query.set("cursor", cursor);
  return worksApi<{ files: WorksDriveFile[]; responseMetaData?: { nextCursor?: string } }>(
    `/users/me/drive/files/${encodeURIComponent(fileId)}/children?${query}`,
  );
}

export function driveFileFingerprint(file: WorksDriveFile) {
  return createHash("sha256")
    .update([file.fileId, file.fileName, file.fileSize || 0, file.modifiedTime || ""].join("|"))
    .digest("hex");
}

export function supportedPortfolioFile(file: WorksDriveFile) {
  return /\.(ppt|pptx|pdf)$/i.test(file.fileName);
}
