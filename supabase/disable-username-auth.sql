-- Remove the obsolete username/password login infrastructure.
-- Existing public.profiles rows are deliberately retained so this cleanup
-- does not delete account metadata. The app no longer reads that table.

drop trigger if exists on_auth_user_created_celeste_profile on auth.users;
drop function if exists public.create_celeste_profile_for_auth_user();

drop function if exists public.consume_username_login_limits(text, text);
drop function if exists private.consume_username_login_limit(text, integer, interval);
drop table if exists private.username_login_limits;
