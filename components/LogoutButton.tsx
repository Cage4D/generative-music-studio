"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import ROUTES from "@/constants/routes";
import { signOut } from "@/lib/actions/auth.action";

export default function LogoutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    const result = await signOut();
    if (result.success) {
      toast.success("Signed out successfully.");
      router.push(ROUTES.HOME);
      router.refresh();
    } else {
      toast.error(result.error?.message ?? "Something went wrong.");
    }
  };

  return (
    <DropdownMenuItem variant="destructive" onSelect={handleSignOut}>
      <LogOut />
      Sign out
    </DropdownMenuItem>
  );
}