export function SetupNotice() {
  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold">초기 설정이 필요합니다</p>
      <p className="text-muted-foreground">
        데이터베이스(Supabase) 연결 정보가 없습니다. 프로젝트 폴더의 <code>.env.example</code> 을{" "}
        <code>.env.local</code> 로 복사한 뒤 값을 채우고 서버를 다시 시작하세요.
      </p>
      <p className="text-muted-foreground">자세한 방법은 README.md 의 「처음 설치하기」를 참고하세요.</p>
    </div>
  );
}
