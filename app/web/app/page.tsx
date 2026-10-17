import { Suspense } from "react";
import { Studio } from "@/components/studio/Studio";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Studio />
    </Suspense>
  );
}
