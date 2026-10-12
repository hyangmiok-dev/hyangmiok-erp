-- =====================================================================
-- 최초 대표 계정 지정 (설치 후 딱 한 번 실행)
-- ---------------------------------------------------------------------
-- 1) Supabase 대시보드 → Authentication → Users → "Add user" 로 대표 이메일/비밀번호 생성
--    ("Auto Confirm User" 체크)
-- 2) 아래 이메일을 대표 이메일로 바꾼 뒤 SQL Editor 에서 실행
-- 이후 다른 계정은 웹 화면의 [계정 관리]에서 만듭니다.
-- =====================================================================
update public.profiles
set role = 'owner',
    is_active = true,
    full_name = '대표'          -- 원하는 표시 이름으로 변경
where id = (select id from auth.users where email = 'owner@example.com');

-- 확인: 1행이 owner / true 로 나와야 합니다.
select p.full_name, p.role, p.is_active, u.email
from public.profiles p join auth.users u on u.id = p.id
where p.role = 'owner';
