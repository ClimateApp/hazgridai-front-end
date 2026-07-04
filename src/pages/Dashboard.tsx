import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface UserRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  roles: string[];
  conversation_count: number;
  time_spent_ms: number;
}

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `${hrs}h ${rem}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }

    const load = async () => {
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (!roleData) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setIsAdmin(true);

      const [{ data: profiles }, { data: roles }, { data: convs }, { data: msgs }] = await Promise.all([
        supabase.from("profiles").select("user_id, email, display_name, created_at").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("conversations").select("user_id"),
        supabase.from("messages").select("user_id, conversation_id, created_at"),
      ]);

      const roleMap = new Map<string, string[]>();
      (roles || []).forEach((r: any) => {
        roleMap.set(r.user_id, [...(roleMap.get(r.user_id) || []), r.role]);
      });
      const convCount = new Map<string, number>();
      (convs || []).forEach((c: any) => {
        convCount.set(c.user_id, (convCount.get(c.user_id) || 0) + 1);
      });

      // Estimate time spent: per conversation, (max-min message timestamp) + 30s per message for engagement.
      const convStats = new Map<string, { user_id: string; min: number; max: number; count: number }>();
      (msgs || []).forEach((m: any) => {
        const t = new Date(m.created_at).getTime();
        const s = convStats.get(m.conversation_id);
        if (!s) convStats.set(m.conversation_id, { user_id: m.user_id, min: t, max: t, count: 1 });
        else {
          s.min = Math.min(s.min, t);
          s.max = Math.max(s.max, t);
          s.count += 1;
        }
      });
      const timeMap = new Map<string, number>();
      convStats.forEach((s) => {
        // Cap any single inactive gap by capping per-conversation span at 2h.
        const span = Math.min(s.max - s.min, 2 * 60 * 60 * 1000);
        const engagement = s.count * 30 * 1000;
        timeMap.set(s.user_id, (timeMap.get(s.user_id) || 0) + span + engagement);
      });

      setUsers(
        (profiles || []).map((p: any) => ({
          ...p,
          roles: roleMap.get(p.user_id) || [],
          conversation_count: convCount.get(p.user_id) || 0,
          time_spent_ms: timeMap.get(p.user_id) || 0,
        }))
      );
      setLoading(false);
    };

    load();
  }, [user, authLoading, navigate]);

  if (authLoading || loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (isAdmin === false) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            You don't have permission to view this page. Admin access required.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">{users.length} total registered users</p>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead className="text-right">Conversations</TableHead>
                  <TableHead className="text-right">Time spent</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.user_id}>
                    <TableCell className="font-medium">{u.display_name || "—"}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{u.conversation_count}</TableCell>
                    <TableCell className="text-right">{formatDuration(u.time_spent_ms)}</TableCell>
                    <TableCell>{format(new Date(u.created_at), "MMM d, yyyy")}</TableCell>
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
