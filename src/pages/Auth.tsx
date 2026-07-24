import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Loader2, Mail, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import hazgridLogo from "@/assets/hazgrid-logo.svg";

/**
 * Sign-in for HazGrid ai. Accounts are provisioned by an administrator — there is no
 * public sign-up. Accounts flagged `must_change_password` are forced to set their own
 * password here before continuing.
 */
const Auth = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { signIn, signOut, changePassword, user, loading, mustChangePassword } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Signed in and password is current -> straight to the app.
  useEffect(() => {
    if (!loading && user && !mustChangePassword) navigate("/", { replace: true });
  }, [user, loading, mustChangePassword, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      setError(error.message || "Sign-in failed");
      return;
    }
    setPassword("");
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The two passwords don't match.");
      return;
    }
    setSubmitting(true);
    const { error } = await changePassword(password || "", newPassword);
    setSubmitting(false);
    if (error) {
      setError(error.message || "Could not update password");
      return;
    }
    toast({ title: "Password updated" });
    navigate("/", { replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  // ---- forced password change (first login after an admin provisions the account) ----
  if (user && mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-primary-foreground" />
            </div>
            <CardTitle>Choose a new password</CardTitle>
            <CardDescription>
              Your account was set up with a temporary password. Please set your own before
              continuing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current">Temporary password</Label>
                <Input
                  id="current"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="the password you were given"
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">New password</Label>
                <Input
                  id="new"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="at least 8 characters"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update password"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={async () => {
                  await signOut();
                  setPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
              >
                Sign in as someone else
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ------------------------------- sign in -------------------------------
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img src={hazgridLogo} alt="HazGrid ai" className="mx-auto h-14 w-auto mb-2" />
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Access live wildfire and flood simulations.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="pl-9"
                  autoComplete="username"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9"
                  autoComplete="current-password"
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={() => navigate("/")}>
              Continue as guest
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              Accounts are issued by HazGrid ai. Contact your administrator for access.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
