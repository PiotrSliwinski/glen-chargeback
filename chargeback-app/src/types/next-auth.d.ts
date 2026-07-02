import type { Role } from "@/lib/rbac";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      role: Role | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role | null;
  }
}
