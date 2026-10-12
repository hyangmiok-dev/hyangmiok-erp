import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-sm font-medium text-muted-foreground">403</p>
      <h1 className="mt-2 text-xl font-bold">이 화면을 볼 권한이 없습니다</h1>
      <p className="mt-2 text-sm text-muted-foreground">필요하면 대표(관리자)에게 권한을 요청하세요.</p>
      <Link href="/" className={buttonVariants({ className: "mt-6" })}>
        홈으로
      </Link>
    </div>
  );
}
