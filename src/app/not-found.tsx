import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl font-bold">페이지를 찾을 수 없습니다</h1>
      <Link href="/" className={buttonVariants({ className: "mt-6" })}>
        홈으로
      </Link>
    </div>
  );
}
