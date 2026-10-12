export function SetupNotice() {
  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold">초기 설정이 필요합니다</p>
      <p className="text-muted-foreground">
        데이터베이스(Supabase) 연결 정보(열쇠)가 없어서 장부를 불러올 수 없습니다.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>
          <b>인터넷 사이트</b>: Netlify → <b>환경 변수</b>에 <code>NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>, <code>SUPABASE_SECRET_KEY</code> 3개를 넣고 다시 배포하세요.
        </li>
        <li>
          <b>내 컴퓨터</b>: 프로젝트 폴더의 <code>.env.local</code> 에 값을 넣고 서버를 다시 시작하세요.
        </li>
      </ul>
      <p className="text-muted-foreground">자세한 방법은 README.md 를 참고하세요.</p>
    </div>
  );
}
