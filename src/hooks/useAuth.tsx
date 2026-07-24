import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, tokenStore, type AuthUser } from "@/lib/backend";

/**
 * Auth against the self-hosted auth-service (Supabase removed).
 * There is no self-signup: admins provision accounts, and users whose account is
 * flagged `must_change_password` are forced through a password change on first login.
 */
interface AuthContextType {
  user: AuthUser | null;
  session: { access_token: string } | null; // kept for components reading access_token
  loading: boolean;
  isAdmin: boolean;
  mustChangePassword: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<{ error: Error | null }>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const u = await api.me();
    setUser(u);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      setUser(await api.login(email, password));
      return { error: null };
    } catch (e: any) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  };

  const signOut = async () => {
    api.logout();
    setUser(null);
  };

  const changePassword = async (current: string, next: string) => {
    try {
      setUser(await api.changePassword(current, next));
      return { error: null };
    } catch (e: any) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  };

  const token = tokenStore.get();
  return (
    <AuthContext.Provider
      value={{
        user,
        session: user && token ? { access_token: token } : null,
        loading,
        isAdmin: user?.role === "admin",
        mustChangePassword: !!user?.must_change_password,
        signIn,
        signOut,
        changePassword,
        refresh: load,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
