-- MARU RPS KR / Seoul consolidated read-only schema and security inspection.
-- Target project: sannrfmhevebqgfdqcps (Seoul / ap-northeast-2).
-- One final result set: section_name, item_no, result_json.

WITH
context AS (
  SELECT 1 AS item_no, jsonb_build_object(
    'current_database', current_database(),
    'current_user', current_user,
    'current_schema', current_schema(),
    'postgres_version', version(),
    'search_path', current_setting('search_path'),
    'row_security_setting', current_setting('row_security', true),
    'target_project_ref', 'sannrfmhevebqgfdqcps',
    'target_region', 'ap-northeast-2'
  ) AS result_json
),
table_state AS (
  SELECT row_number() OVER (ORDER BY c.relname)::int AS item_no,
         jsonb_build_object(
           'schema', n.nspname,
           'table', c.relname,
           'row_security_enabled', c.relrowsecurity,
           'row_security_forced', c.relforcerowsecurity,
           'table_owner', pg_get_userbyid(c.relowner),
           'relkind', c.relkind
         ) AS result_json
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('rooms', 'participants')
),
columns AS (
  SELECT row_number() OVER (ORDER BY c.table_name, c.ordinal_position)::int AS item_no,
         jsonb_build_object(
           'schema', c.table_schema,
           'table', c.table_name,
           'ordinal_position', c.ordinal_position,
           'column', c.column_name,
           'data_type', c.data_type,
           'udt_schema', c.udt_schema,
           'udt_name', c.udt_name,
           'character_maximum_length', c.character_maximum_length,
           'numeric_precision', c.numeric_precision,
           'numeric_scale', c.numeric_scale,
           'is_nullable', c.is_nullable,
           'default_expression', c.column_default,
           'is_identity', c.is_identity,
           'identity_generation', c.identity_generation,
           'is_generated', c.is_generated,
           'generation_expression', c.generation_expression
         ) AS result_json
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name IN ('rooms', 'participants')
),
constraints AS (
  SELECT row_number() OVER (ORDER BY n.nspname, t.relname, con.conname)::int AS item_no,
         jsonb_build_object(
           'schema', n.nspname,
           'table', t.relname,
           'constraint_name', con.conname,
           'constraint_type', con.contype,
           'deferrable', con.condeferrable,
           'deferred', con.condeferred,
           'definition', pg_get_constraintdef(con.oid, true),
           'referenced_schema', rn.nspname,
           'referenced_table', rt.relname,
           'referenced_constraint', rc.relname,
           'on_update', CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE NULL END,
           'on_delete', CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE NULL END
         ) AS result_json
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class t ON t.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.conindid
  LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
  LEFT JOIN pg_catalog.pg_class rt ON rt.oid = con.confrelid
  WHERE n.nspname = 'public' AND t.relname IN ('rooms', 'participants')
),
indexes AS (
  SELECT row_number() OVER (ORDER BY x.tablename, x.indexname)::int AS item_no,
         jsonb_build_object(
           'schema', x.schemaname,
           'table', x.tablename,
           'index_name', x.indexname,
           'is_unique', i.indisunique,
           'is_primary', i.indisprimary,
           'partial_predicate', pg_get_expr(i.indpred, i.indrelid),
           'definition', x.indexdef
         ) AS result_json
  FROM pg_catalog.pg_indexes x
  JOIN pg_catalog.pg_class t ON t.relname = x.tablename
  JOIN pg_catalog.pg_namespace n ON n.nspname = x.schemaname AND t.relnamespace = n.oid
  JOIN pg_catalog.pg_class idx ON idx.relname = x.indexname AND idx.relnamespace = n.oid
  JOIN pg_catalog.pg_index i ON i.indexrelid = idx.oid
  WHERE x.schemaname = 'public' AND x.tablename IN ('rooms', 'participants')
),
triggers AS (
  SELECT row_number() OVER (ORDER BY t.relname, tr.tgname)::int AS item_no,
         jsonb_build_object(
           'schema', n.nspname,
           'table', t.relname,
           'trigger_name', tr.tgname,
           'enabled_state', CASE tr.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled' WHEN 'R' THEN 'replica' WHEN 'A' THEN 'always' ELSE tr.tgenabled::text END,
           'trigger_definition', pg_get_triggerdef(tr.oid, true),
           'function_schema', pn.nspname,
           'function_name', p.proname,
           'identity_arguments', pg_get_function_identity_arguments(p.oid)
         ) AS result_json
  FROM pg_catalog.pg_trigger tr
  JOIN pg_catalog.pg_class t ON t.oid = tr.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_catalog.pg_proc p ON p.oid = tr.tgfoid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
  WHERE NOT tr.tgisinternal AND n.nspname = 'public' AND t.relname IN ('rooms', 'participants')
),
policies AS (
  SELECT row_number() OVER (ORDER BY p.tablename, p.policyname)::int AS item_no,
         jsonb_build_object(
           'schema', p.schemaname,
           'table', p.tablename,
           'policy_name', p.policyname,
           'command', p.cmd,
           'roles', p.roles,
           'permissive', p.permissive,
           'using_expression', p.qual,
           'with_check_expression', p.with_check
         ) AS result_json
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename IN ('rooms', 'participants')
),
table_grants AS (
  SELECT row_number() OVER (ORDER BY table_name, grantee, privilege_type)::int AS item_no,
         jsonb_build_object(
           'grantor', grantor, 'grantee', grantee, 'schema', table_schema,
           'table', table_name, 'privilege_type', privilege_type, 'is_grantable', is_grantable
         ) AS result_json
  FROM information_schema.table_privileges
  WHERE table_schema = 'public' AND table_name IN ('rooms', 'participants')
),
column_grants AS (
  SELECT row_number() OVER (ORDER BY table_name, grantee, column_name, privilege_type)::int AS item_no,
         jsonb_build_object(
           'grantor', grantor, 'grantee', grantee, 'schema', table_schema,
           'table', table_name, 'column', column_name, 'privilege_type', privilege_type, 'is_grantable', is_grantable
         ) AS result_json
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name IN ('rooms', 'participants')
),
relevant_functions AS (
  SELECT row_number() OVER (ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))::int AS item_no,
         jsonb_build_object(
           'schema', n.nspname,
           'function_name', p.proname,
           'identity_arguments', pg_get_function_identity_arguments(p.oid),
           'result_type', pg_get_function_result(p.oid),
           'security_mode', CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END,
           'owner', pg_get_userbyid(p.proowner),
           'configured_parameters', p.proconfig,
           'definition', pg_get_functiondef(p.oid),
           'acl', p.proacl
         ) AS result_json
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND pg_get_functiondef(p.oid) ILIKE ANY (ARRAY[
      '%participants%', '%rooms%', '%host%', '%leave%', '%join%', '%reconnect%', '%cleanup%', '%owner%'
    ])
),
default_privileges AS (
  SELECT row_number() OVER (ORDER BY 1, 2, 3)::int AS item_no,
         jsonb_build_object(
           'object_owner', defaclrole::regrole::text,
           'object_schema', defaclnamespace::regnamespace::text,
           'object_type', CASE defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' WHEN 'f' THEN 'function' WHEN 'T' THEN 'type' WHEN 'n' THEN 'schema' ELSE defaclobjtype::text END,
           'default_acl', defaclacl
         ) AS result_json
  FROM pg_catalog.pg_default_acl
  WHERE defaclacl::text ~ '(anon|authenticated|PUBLIC)'
),
function_grants AS (
  SELECT row_number() OVER (ORDER BY routine_schema, routine_name, specific_name, grantee, privilege_type)::int AS item_no,
         jsonb_build_object(
           'schema', routine_schema, 'function_name', routine_name,
           'specific_name', specific_name, 'grantee', grantee,
           'privilege_type', privilege_type, 'is_grantable', is_grantable
         ) AS result_json
  FROM information_schema.routine_privileges
  WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
    AND (routine_name ILIKE ANY (ARRAY['%participant%', '%room%', '%host%', '%leave%', '%join%', '%reconnect%', '%cleanup%', '%owner%']))
)
SELECT 'session/project context' AS section_name, item_no, result_json FROM context
UNION ALL SELECT 'rooms/participants exact column types', item_no, result_json FROM columns
UNION ALL SELECT 'table row security state', item_no, result_json FROM table_state
UNION ALL SELECT 'constraints', item_no, result_json FROM constraints
UNION ALL SELECT 'indexes', item_no, result_json FROM indexes
UNION ALL SELECT 'triggers', item_no, result_json FROM triggers
UNION ALL SELECT 'RLS policies', item_no, result_json FROM policies
UNION ALL SELECT 'table grants', item_no, result_json FROM table_grants
UNION ALL SELECT 'column grants', item_no, result_json FROM column_grants
UNION ALL SELECT 'relevant functions/RPCs', item_no, result_json FROM relevant_functions
UNION ALL SELECT 'function grants', item_no, result_json FROM function_grants
UNION ALL SELECT 'default privileges', item_no, result_json FROM default_privileges
ORDER BY section_name, item_no;
