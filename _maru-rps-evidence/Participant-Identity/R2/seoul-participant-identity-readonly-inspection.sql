-- MARU RPS KR / Seoul read-only schema and security inspection.
-- Target project: sannrfmhevebqgfdqcps (Seoul / ap-northeast-2).
-- This file intentionally contains catalog SELECTs only. Do not run against cmfx...

SELECT current_database() AS current_database,
       current_user AS current_user,
       current_schema() AS current_schema,
       version() AS postgres_version,
       current_setting('search_path') AS search_path,
       current_setting('row_security', true) AS row_security_setting;

SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       c.relrowsecurity AS row_security_enabled,
       c.relforcerowsecurity AS row_security_forced,
       pg_get_userbyid(c.relowner) AS table_owner,
       c.relkind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('rooms', 'participants')
ORDER BY c.relname;

SELECT c.table_schema,
       c.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.udt_schema,
       c.udt_name,
       c.character_maximum_length,
       c.numeric_precision,
       c.numeric_scale,
       c.is_nullable,
       c.column_default,
       c.is_identity,
       c.identity_generation,
       c.is_generated,
       c.generation_expression
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('rooms', 'participants')
ORDER BY c.table_name, c.ordinal_position;

SELECT n.nspname AS table_schema,
       t.relname AS table_name,
       con.conname AS constraint_name,
       CASE con.contype
         WHEN 'p' THEN 'PRIMARY KEY'
         WHEN 'f' THEN 'FOREIGN KEY'
         WHEN 'u' THEN 'UNIQUE'
         WHEN 'c' THEN 'CHECK'
         WHEN 'x' THEN 'EXCLUSION'
         ELSE con.contype::text
       END AS constraint_type,
       con.condeferrable,
       con.condeferred,
       pg_get_constraintdef(con.oid, true) AS constraint_definition,
       rn.nspname AS referenced_schema,
       rt.relname AS referenced_table,
       rc.relname AS referenced_constraint,
       CASE con.confupdtype
         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE NULL END AS on_update,
       CASE con.confdeltype
         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE NULL END AS on_delete
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class t ON t.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.conindid
LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
LEFT JOIN pg_catalog.pg_class rt ON rt.oid = con.confrelid
WHERE n.nspname = 'public'
  AND t.relname IN ('rooms', 'participants')
ORDER BY t.relname, con.conname;

SELECT schemaname AS table_schema,
       tablename AS table_name,
       indexname AS index_name,
       indexdef AS index_definition,
       (indexdef ILIKE '%UNIQUE INDEX%') AS is_unique,
       (indexdef ILIKE '% PRIMARY %') AS is_primary,
       pg_get_expr(i.indpred, i.indrelid) AS partial_predicate
FROM pg_catalog.pg_indexes x
JOIN pg_catalog.pg_class t ON t.relname = x.tablename
JOIN pg_catalog.pg_namespace n ON n.nspname = x.schemaname AND t.relnamespace = n.oid
JOIN pg_catalog.pg_index i ON i.indexrelid = (x.indexname::regclass)
WHERE x.schemaname = 'public'
  AND x.tablename IN ('rooms', 'participants')
ORDER BY x.tablename, x.indexname;

SELECT n.nspname AS table_schema,
       t.relname AS table_name,
       tr.tgname AS trigger_name,
       CASE tr.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled'
         WHEN 'R' THEN 'replica' WHEN 'A' THEN 'always' ELSE tr.tgenabled::text END AS enabled_state,
       pg_get_triggerdef(tr.oid, true) AS trigger_definition,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments
FROM pg_catalog.pg_trigger tr
JOIN pg_catalog.pg_class t ON t.oid = tr.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = tr.tgfoid
WHERE NOT tr.tgisinternal
  AND n.nspname = 'public'
  AND t.relname IN ('rooms', 'participants')
ORDER BY t.relname, tr.tgname;

SELECT schemaname AS table_schema,
       tablename AS table_name,
       policyname AS policy_name,
       cmd AS command,
       roles,
       permissive,
       qual AS using_expression,
       with_check AS with_check_expression
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('rooms', 'participants')
ORDER BY tablename, policyname;

SELECT grantor,
       grantee,
       table_schema,
       table_name,
       privilege_type,
       is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('rooms', 'participants')
ORDER BY table_name, grantee, privilege_type;

SELECT grantor,
       grantee,
       table_schema,
       table_name,
       column_name,
       privilege_type,
       is_grantable
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
  AND table_name IN ('rooms', 'participants')
ORDER BY table_name, grantee, column_name, privilege_type;

SELECT n.nspname AS function_schema,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_result(p.oid) AS result_type,
       CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
       pg_get_userbyid(p.proowner) AS function_owner,
       p.proconfig AS configured_parameters,
       pg_get_functiondef(p.oid) AS function_definition,
       COALESCE(array_to_string(p.proacl, E'\n'), '') AS function_acl
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND (pg_get_functiondef(p.oid) ILIKE ANY (ARRAY[
    '%participants%', '%rooms%', '%host%', '%leave%', '%join%',
    '%reconnect%', '%cleanup%', '%owner%'
  ]))
ORDER BY n.nspname, p.proname, identity_arguments;

SELECT defaclrole::regrole AS object_owner,
       defaclnamespace::regnamespace AS object_schema,
       CASE defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence'
         WHEN 'f' THEN 'function' WHEN 'T' THEN 'type' WHEN 'n' THEN 'schema'
         ELSE defaclobjtype::text END AS object_type,
       defaclacl AS default_acl
FROM pg_catalog.pg_default_acl
WHERE defaclacl::text ~ '(anon|authenticated|PUBLIC)'
ORDER BY object_owner, object_schema::text, object_type;
