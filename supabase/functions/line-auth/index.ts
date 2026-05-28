// Edge Function: LINE OAuth → Supabase Auth bridge
//
// Flow:
//  1. 클라이언트가 LINE OAuth 후 받은 `code` 를 이 함수로 POST
//  2. LINE 토큰 교환 (code → access_token)
//  3. LINE user info 조회 (display name, picture, email if 권한 승인)
//  4. Supabase Admin API로 user 생성 또는 업데이트 (email 또는 LINE userId 기준)
//  5. magic link 발급 → token_hash 를 클라이언트로 반환
//  6. 클라이언트가 supabase.auth.verifyOtp({token_hash}) 로 세션 활성화
//
// 필요한 환경 변수 (Supabase Dashboard → Edge Functions → Secrets):
//  - LINE_CHANNEL_ID        (LINE Login Channel ID)
//  - LINE_CHANNEL_SECRET    (LINE Login Channel Secret)
//  - SUPABASE_URL           (자동 주입)
//  - SUPABASE_SERVICE_ROLE_KEY (자동 주입)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { code, redirect_uri } = body ?? {};

    if (!code) return json({ success: false, error: "missing code" }, 400);

    const LINE_CHANNEL_ID = Deno.env.get("LINE_CHANNEL_ID");
    const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LINE_CHANNEL_ID || !LINE_CHANNEL_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ success: false, error: "server not configured" }, 500);
    }

    // === 1. Exchange code for access_token + id_token ===
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect_uri || "",
        client_id: LINE_CHANNEL_ID,
        client_secret: LINE_CHANNEL_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return json({ success: false, error: "line token exchange failed", line: tokenData }, 400);
    }

    // === 2. Fetch user profile ===
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profile?.userId) {
      return json({ success: false, error: "line profile fetch failed", line: profile }, 400);
    }

    const lineUserId = profile.userId;
    const displayName = profile.displayName || `line_${lineUserId.slice(-8)}`;
    const pictureUrl = profile.pictureUrl || null;

    // 이메일은 id_token (OIDC) 안에 있음 (권한 승인 시)
    let email: string | undefined;
    if (tokenData.id_token) {
      // id_token payload 디코딩 (signature 검증 생략 — 우리가 직접 받은 응답이므로)
      try {
        const payload = JSON.parse(
          atob(tokenData.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
        );
        if (payload.email) email = payload.email;
      } catch {}
    }
    if (!email) {
      // 이메일 권한 미승인 또는 사용자가 거부 → 합성 이메일
      email = `line_${lineUserId}@maru-rps.local`;
    }

    // === 3. Create or update user in Supabase ===
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const userMeta = {
      provider: "line",
      line_user_id: lineUserId,
      nickname: displayName,
      full_name: displayName,
      avatar_url: pictureUrl,
    };

    let userId: string | undefined;
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: userMeta,
    });
    if (createErr) {
      const isAlready = /already.*(registered|exists)|email.*already/i.test(createErr.message || "");
      if (!isAlready) {
        return json({ success: false, error: "createUser failed: " + createErr.message }, 500);
      }
    }
    userId = created?.user?.id;

    if (!userId) {
      const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list.users.find((u: any) => u.email === email);
      if (existing) {
        userId = existing.id;
        await supabase.auth.admin.updateUserById(existing.id, { user_metadata: userMeta });
      }
    }

    if (!userId) {
      return json({ success: false, error: "user creation/lookup failed" }, 500);
    }

    // === 4. Generate magic link → token_hash ===
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) {
      return json({ success: false, error: "generateLink failed: " + linkErr.message }, 500);
    }

    return json({
      success: true,
      email,
      nickname: displayName,
      avatar_url: pictureUrl,
      token_hash: (linkData as any)?.properties?.hashed_token
        ?? (linkData as any)?.hashed_token,
      action_link: (linkData as any)?.action_link,
    });
  } catch (e: any) {
    return json({ success: false, error: e?.message || String(e) }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
