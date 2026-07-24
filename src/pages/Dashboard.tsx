import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { api, type AuthUser } from "@/lib/backend";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, KeyRound, Trash2, ShieldCheck, ArrowLeft } from "lucide-react";

type Row = AuthUser & { conversation_count: number; message_count: number };

/** Admin console: provision accounts, reset passwords, manage roles. */
export default function Dashboard() {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [users, setUsers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");

  const reload = async () => {
    try {
      setUsers(await api.listUsers());
    } catch (e: any) {
      toast({ title: e.message || "Could not load users", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, isAdmin]);

  const suggestPassword = () => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
    const arr = new Uint32Array(14);
    crypto.getRandomValues(arr);
    setNewPassword(Array.from(arr, (n) => chars[n % chars.length]).join(""));
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || newPassword.length < 8) {
      toast({ title: "Email and a password of 8+ characters are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await api.createUser(newEmail.trim(), newPassword, newRole);
      toast({
        title: `Account created for ${newEmail.trim()}`,
        description: "Share the password with them — they'll be asked to change it at first sign-in.",
      });
      setNewEmail("");
      setNewPassword("");
      setNewRole("user");
      await reload();
    } catch (e: any) {
      toast({ title: e.message || "Could not create user", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (u: Row) => {
    const pw = window.prompt(`New temporary password for ${u.email} (min 8 chars):`);
    if (!pw) return;
    if (pw.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    try {
      await api.resetPassword(u.id, pw);
      toast({ title: `Password reset for ${u.email}`, description: "They must change it at next sign-in." });
      await reload();
    } catch (e: any) {
      toast({ title: e.message || "Reset failed", variant: "destructive" });
    }
  };

  const toggleRole = async (u: Row) => {
    try {
      await api.setRole(u.id, u.role === "admin" ? "user" : "admin");
      await reload();
    } catch (e: any) {
      toast({ title: e.message || "Could not change role", variant: "destructive" });
    }
  };

  const removeUser = async (u: Row) => {
    if (!window.confirm(`Delete ${u.email}? Their conversations and messages are deleted too.`)) return;
    try {
      await api.deleteUser(u.id);
      toast({ title: `Deleted ${u.email}` });
      await reload();
    } catch (e: any) {
      toast({ title: e.message || "Delete failed", variant: "destructive" });
    }
  };

  if (authLoading || loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-4">
            <p>You don't have permission to view this page. Admin access required.</p>
            <Button variant="outline" onClick={() => navigate("/")}>Back to HazGrid ai</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Admin console</h1>
            <p className="text-sm text-muted-foreground">
              Signed in as {user?.email} · {users.length} account{users.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/")} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to app
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Create an account
            </CardTitle>
            <CardDescription>
              Set an initial password and share it with the user — they'll be required to choose
              their own at first sign-in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createUser} className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={newEmail} placeholder="person@company.com"
                       onChange={(e) => setNewEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">Initial password</Label>
                <div className="flex gap-2">
                  <Input id="pw" value={newPassword} placeholder="min 8 characters"
                         onChange={(e) => setNewPassword(e.target.value)} />
                  <Button type="button" variant="outline" onClick={suggestPassword} title="Generate">
                    <KeyRound className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <select id="role" value={newRole} onChange={(e) => setNewRole(e.target.value as any)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Chats</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.must_change_password ? (
                        <span className="text-xs text-amber-600">must set password</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">active</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.conversation_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.message_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => resetPassword(u)} title="Reset password">
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleRole(u)}
                              title={u.role === "admin" ? "Demote to user" : "Promote to admin"}
                              disabled={u.id === user?.id}>
                        <ShieldCheck className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeUser(u)} title="Delete"
                              disabled={u.id === user?.id}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
