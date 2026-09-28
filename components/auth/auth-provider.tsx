"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { PERMISSIONS, type Permission } from "@/lib/rbac/permissions";
import type { Database } from "@/lib/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Role = Database["public"]["Tables"]["roles"]["Row"];

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: string[];
  permissions: Permission[];
  loading: boolean;
  signingOut: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  profile: null,
  roles: [],
  permissions: [],
  loading: true,
  signingOut: false,
  signOut: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const loadRequestIdRef = useRef(0);

  const loadUserData = useCallback(async (userId: string) => {
    const requestId = ++loadRequestIdRef.current;
    try {
      const [{ data: profileData }, { data: userRolesData }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase
          .from("user_roles")
          .select("role_id, roles!inner(code)")
          .eq("user_id", userId),
      ]);

      if (requestId !== loadRequestIdRef.current) return;

      setProfile(profileData as Profile | null);

      const roleCodes = (userRolesData as unknown as { roles: { code: string } }[])?.map(
        (ur) => ur.roles.code
      ) ?? [];
      setRoles(roleCodes);

      if (roleCodes.includes("super_admin")) {
        setPermissions([...PERMISSIONS]);
        return;
      }

      if (roleCodes.length > 0) {
        const { data: rolePerms } = await supabase
          .from("role_permissions")
          .select("permission_id, permissions!inner(code)")
          .in(
            "role_id",
            (userRolesData as unknown as { role_id: string }[])?.map((ur) => ur.role_id) ?? []
          );

        if (requestId !== loadRequestIdRef.current) return;

        const permCodes = (rolePerms as unknown as { permissions: { code: string } }[])?.map(
          (rp) => rp.permissions.code as Permission
        ) ?? [];
        setPermissions(permCodes);
      } else {
        setPermissions([]);
      }
    } catch {
      // Don't clear state on transient errors — keep existing data
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Initial session load — fire-and-forget the async work so the
    // .then() callback itself stays synchronous and can't deadlock.
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadUserData(s.user.id).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    // onAuthStateChange callback MUST be synchronous — Supabase explicitly
    // warns that an async callback can deadlock, leaving loading: true
    // forever. We schedule async work outside the callback instead.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      if (signingOutRef.current && event !== "SIGNED_OUT") return;

      // Skip INITIAL_SESSION — getSession() already handles the initial load.
      if (event === "INITIAL_SESSION") return;

      // TOKEN_REFRESHED: the client already updated its token. Our React
      // state is unchanged — updating here would trigger re-renders and
      // cause the "Chargement…" screen when returning to a browser tab.
      if (event === "TOKEN_REFRESHED") return;

      setSession(s);
      setUser(s?.user ?? null);

      if (event === "SIGNED_OUT" || !s?.user) {
        setProfile(null);
        setRoles([]);
        setPermissions([]);
        setLoading(false);
        return;
      }

      // Only refetch profile/roles on actual sign-in.
      if (event === "SIGNED_IN") {
        setLoading(true);
        loadUserData(s.user.id).finally(() => {
          if (mounted) setLoading(false);
        });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserData]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    signingOutRef.current = true;
    try {
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      // ignore errors — proceed with local cleanup
    }
    setSession(null);
    setUser(null);
    setProfile(null);
    setRoles([]);
    setPermissions([]);

    const domain = window.location.hostname;
    document.cookie.split(";").forEach((c) => {
      const name = c.split("=")[0].trim();
      if (!name || !name.startsWith("sb-")) return;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${domain}`;
    });

    window.location.replace("/auth/login?t=" + Date.now());
  }, []);

  const refresh = useCallback(async () => {
    if (user) {
      await loadUserData(user.id);
    }
  }, [user, loadUserData]);

  return (
    <AuthContext.Provider
      value={{ session, user, profile, roles, permissions, loading, signingOut, signOut, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
