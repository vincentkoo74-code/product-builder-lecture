// Edge Function: Kakao OAuth → Supabase Auth bridge
//
// Flow:
//  1. 클라이언트가 카카오 OAuth 후 받은 `code` 를 이 함수로 POST
//  2. 카카오 토큰 교환 (code → access_token)
//  3. 카카오 user info 조회 (nickname, profile, email if 비즈앱)
//  4. Supabase Admin API로 user 생성 또는 업데이트 (email 기준)
//  5. magic link 발급 → token_hash 를 클라이언트로 반환
//  6. 클라이언트가 supabase.auth.verifyOtp({token_hash}) 로 세션 활성화
//
// 필요한 환경 변수 (Supabase Dashboard → Edge Functions → Secrets):
//  - KAKAO_REST_API_KEY     (카카오 REST API 키, Client ID 역할)
//  - KAKAO_CLIENT_SECRET    (선택, 사용 안 하면 생략 가능)
//  - SUPABASE_URL           (자동 주입됨)
//  - SUPABASE_SERVICE_ROLE_KEY (자동 주입됨)

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

    if (!code) {
      return json({ success: false, error: "missing code" }, 400);
    }

    const KAKAO_REST_API_KEY = Deno.env.get("KAKAO_REST_API_KEY");
    const KAKAO_CLIENT_SECRET = Deno.env.get("KAKAO_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!KAKAO_REST_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ success: false, error: "server not configured" }, 500);
    }

    // === 1. Exchange code for access_token ===
    const tokenParams: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: KAKAO_REST_API_KEY,
      redirect_uri: redirect_uri || "",
      code,
    };
    if (KAKAO_CLIENT_SECRET) tokenParams.client_secret = KAKAO_CLIENT_SECRET;

    let tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });
    let tokenData = await tokenRes.json();

    // Some Kakao apps have "Client Secret" disabled. If a stale secret is set in
    // Supabase, Kakao returns KOE010. Retry without the secret before failing.
    if (!tokenData.access_token && KAKAO_CLIENT_SECRET) {
      const isBadClientSecret =
        tokenData?.error === "invalid_client" || tokenData?.error_code === "KOE010";
      if (isBadClientSecret) {
        delete tokenParams.client_secret;
        tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(tokenParams),
        });
        tokenData = await tokenRes.json();
      }
    }
    if (!tokenData.access_token) {
      return json({
        success: false,
        error: "kakao token exchange failed",
        kakao: tokenData,
      }, 400);
    }

    // === 2. Fetch user info ===
    const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const kakaoUser = await userRes.json();
    if (!kakaoUser?.id) {
      return json({ success: false, error: "kakao user info failed", kakao: kakaoUser }, 400);
    }

    const kakaoId = String(kakaoUser.id);
    const profile = kakaoUser.kakao_account?.profile ?? {};
    const nickname = profile.nickname || `kakao_${kakaoId}`;
    const profileImage = profile.profile_image_url || null;
    // 비즈앱 인증 안 된 경우 이메일 못 받음 → 합성 이메일 사용
    const email = kakaoUser.kakao_account?.email
      || `kakao_${kakaoId}@maru-rps.local`;

    // === 3. Create or update user in Supabase ===
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userId: string | undefined;
    const userMeta = {
      provider: "kakao",
      kakao_id: kakaoId,
      nickname,
      full_name: nickname,
      avatar_url: profileImage,
    };

    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u: any) => u.email === email);

    if (existing) {
      userId = existing.id;
      await supabase.auth.admin.updateUserById(existing.id, { user_metadata: userMeta });
    } else {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: userMeta,
      });
      if (createErr) {
        return json({ success: false, error: "createUser failed: " + createErr.message }, 500);
      }
      userId = created?.user?.id;
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
      nickname,
      avatar_url: profileImage,
      // 클라이언트가 verifyOtp 호출에 사용
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
