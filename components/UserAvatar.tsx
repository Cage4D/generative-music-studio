import Image from "next/image";
import Link from "next/link";

import { cn, getInitials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ROUTES from "@/constants/routes";

interface UserAvatarProps {
  id?: string;
  name: string;
  imageUrl?: string | null;
  className?: string;
  size?: number;
  href?: string | null;
  fallbackClassName?: string;
}

export default function UserAvatar({
  id,
  name,
  imageUrl,
  className = "size-9",
  size = 36,
  href,
  fallbackClassName = "",
}: UserAvatarProps) {
  const targetHref = href ?? (id ? ROUTES.PROFILE(id) : null);

  const avatar = (
    <Avatar className={className}>
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={name}
          className="size-full rounded-full object-cover"
          width={size}
          height={size}
          quality={100}
        />
      ) : (
        <AvatarFallback
          className={cn(
            "primary-gradient font-space-grotesk font-bold tracking-wider text-white",
            fallbackClassName,
          )}
        >
          {getInitials(name)}
        </AvatarFallback>
      )}
    </Avatar>
  );

  return targetHref ? <Link href={targetHref}>{avatar}</Link> : avatar;
}