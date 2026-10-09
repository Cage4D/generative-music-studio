import Link from "next/link";
import { redirect } from "next/navigation";

import UserAvatar from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/actions/auth.action";
import ROUTES from "@/constants/routes";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const result = await getCurrentUser();

  if (!result.success || !result.data) {
    redirect(ROUTES.SIGN_IN);
  }

  const user = result.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="h1-bold text-dark100_light900">Dashboard</h1>
        <p className="paragraph-regular text-dark500_light700">
          This route is protected by <code>proxy.ts</code> and re-checked on the
          server.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="light-border background-light900_dark200 shadow-light100_dark100 border">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>The session user resolved on the server.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <UserAvatar name={user.name} imageUrl={user.image} className="size-12" size={48} />
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="base-semibold text-dark200_light900">{user.name}</span>
                <Badge variant="outline">{user.username}</Badge>
              </div>
              <span className="body-regular text-dark500_light700">{user.email}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="light-border background-light900_dark200 shadow-light100_dark100 border">
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>Where to go from here.</CardDescription>
          </CardHeader>
          <CardContent className="body-regular text-dark500_light700 flex flex-col gap-2">
            <p>
              1. Define your tables in{" "}
              <code className="small-medium">db/schema/</code> and run{" "}
              <code className="small-medium">npm run db:generate</code> then{" "}
              <code className="small-medium">npm run db:migrate</code>.
            </p>
            <p>
              2. Add server actions under{" "}
              <code className="small-medium">lib/actions/</code> using the{" "}
              <code className="small-medium">action()</code> handler for
              validation + authorization.
            </p>
            <p>
              3. Protect more routes by extending the matcher in{" "}
              <code className="small-medium">proxy.ts</code>.
            </p>
            <p>
              See the <Link href={ROUTES.HOME} className="underline">README</Link> for
              the full map.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}