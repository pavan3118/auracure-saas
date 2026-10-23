import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, setToken, type AuthResult, type Me } from "./api";
interface Auth {
  result: AuthResult | null;
  me: Me | null;
  loading: boolean;
  accept: (r: AuthResult) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<AuthResult | null>(null),
    [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true);
  async function accept(r: AuthResult) {
    setToken(r.access_token);
    setResult(r);
    if (r.purpose === "access") setMe(await api<Me>("GET", "/me"));
    else setMe(null);
  }
  async function reload() {
    setMe(await api<Me>("GET", "/me"));
  }
  async function logout() {
    try {
      await api("POST", "/auth/logout", {});
    } finally {
      setToken("");
      setResult(null);
      setMe(null);
    }
  }
  useEffect(() => {
    let active = true;
    api<AuthResult>("POST", "/auth/refresh", {})
      .then(async (r) => {
        if (active) await accept(r);
      })
      .catch(() => {
        if (active) {
          setToken("");
          setMe(null);
          setResult(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (result?.purpose !== "access") return;
    const timer = window.setTimeout(
      () => {
        void api<AuthResult>("POST", "/auth/refresh", {})
          .then(accept)
          .catch(() => {
            setToken("");
            setMe(null);
            setResult(null);
          });
      },
      14 * 60 * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [result?.access_token, result?.purpose]);
  return (
    <Context.Provider value={{ result, me, loading, accept, logout, reload }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const a = useContext(Context);
  if (!a) throw new Error("AuthProvider missing");
  return a;
}
