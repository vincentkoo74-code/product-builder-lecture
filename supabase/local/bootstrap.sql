-- MARU RPS V1.0_JP — 로컬 E2E 플랫폼 재현 (Supabase 관리 영역)
--
-- 이 파일은 **검증 대상이 아니라 환경**이다. Supabase 가 프로젝트 생성 시 만들어 두는 것들
-- (롤, auth 스키마, JWT 클레임 shim, realtime publication)을 로컬에서 재현한다.
-- auth.* 함수 정의는 라이브 Tokyo 에서 pg_get_functiondef 로 읽어온 것 그대로다.
--
-- ⚠️ 비밀값 없음. authenticator 의 비밀번호는 부트스트랩 스크립트가 **실행 시점에 생성**해
--    별도로 설정한다(이 파일에 하드코딩하지 않는다).
-- ⚠️ 프로덕션에 실행하지 않는다. 로컬 테스트 데이터베이스 전용.
-- Supabase 플랫폼이 프로젝트 생성 시 만들어 두는 것들의 재현(검증 대상이 아니라 "환경").
-- 함수 정의는 라이브 Tokyo 에서 pg_get_functiondef 로 읽어온 것 그대로다.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  created_at timestamptz not null default now()
);
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
   (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $f$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
   (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
do $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- realtime publication 은 이미 있으면 건너뛴다(재실행 안전).
