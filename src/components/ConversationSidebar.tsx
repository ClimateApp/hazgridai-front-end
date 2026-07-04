import { useState, useEffect, useRef } from "react";
import { MessageSquare, Trash2, Plus, Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Conversation {
  id: string;
  title: string | null;
  updated_at: string;
}

interface ConversationSidebarProps {
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  refreshTrigger?: number;
  conversationType?: string;
  limit?: number;
}

export function ConversationSidebar({
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  refreshTrigger,
  conversationType = "flood",
  limit,
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const loadConversations = async () => {
    if (!user) return;
    try {
      let q = supabase
        .from("conversations")
        .select("id, title, updated_at")
        .eq("user_id", user.id)
        .eq("conversation_type", conversationType)
        .order("updated_at", { ascending: false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) {
        console.error("Error loading conversations:", error);
        return;
      }
      setConversations(data || []);
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refreshTrigger, conversationType, limit]);

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) {
      console.error("Error deleting conversation:", error);
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === currentConversationId) onNewConversation();
  };

  const startEditing = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title || "");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
  };

  const saveTitle = async (id: string) => {
    const newTitle = editTitle.trim() || "Untitled conversation";
    const { error } = await supabase
      .from("conversations")
      .update({ title: newTitle })
      .eq("id", id);
    if (error) {
      console.error("Error updating title:", error);
      return;
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
    );
    setEditingId(null);
    setEditTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTitle(id);
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="p-3">
        {!isCollapsed ? (
          <Button
            onClick={onNewConversation}
            className="w-full justify-start gap-2"
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        ) : (
          <Button onClick={onNewConversation} size="icon" variant="outline" className="w-full">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!isCollapsed && <SidebarGroupLabel>Conversations</SidebarGroupLabel>}
          <SidebarGroupContent>
            <ScrollArea className="h-[calc(100vh-140px)] w-full">
              <ul className="flex w-full min-w-0 flex-col gap-1 px-2 overflow-hidden">
                {isLoading ? (
                  <li className="px-1 py-2 text-sm text-muted-foreground">Loading...</li>
                ) : conversations.length === 0 ? (
                  <li className="px-1 py-2 text-sm text-muted-foreground">
                    {isCollapsed ? "" : "No conversations yet"}
                  </li>
                ) : (
                  conversations.map((conv) => {
                    const isActive = conv.id === currentConversationId;
                    const isEditing = editingId === conv.id;
                    return (
                      <li key={conv.id} className="w-full">
                        <div
                          className={cn(
                            "grid w-full items-center gap-1 rounded-md p-1.5 text-sm",
                            isCollapsed ? "grid-cols-1 justify-center" : "grid-cols-[minmax(0,1fr)_auto]",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "hover:bg-sidebar-accent/60"
                          )}
                        >
                          {isEditing && !isCollapsed ? (
                            <>
                              <Input
                                ref={inputRef}
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, conv.id)}
                                className="h-7 text-sm py-0 px-2 flex-1 min-w-0"
                                placeholder="Conversation title"
                              />
                              <button
                                type="button"
                                onClick={() => saveTitle(conv.id)}
                                aria-label="Save"
                                className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded hover:bg-primary/10"
                              >
                                <Check className="h-4 w-4 text-primary" />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditing}
                                aria-label="Cancel"
                                className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded hover:bg-muted"
                              >
                                <X className="h-4 w-4 text-muted-foreground" />
                              </button>
                            </>
                          ) : (
                            <>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => onSelectConversation(conv.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    onSelectConversation(conv.id);
                                  }
                                }}
                                className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer overflow-hidden text-left"
                                title={conv.title || "Untitled"}
                              >
                                <MessageSquare className="h-4 w-4 shrink-0" />
                                {!isCollapsed && (
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm">
                                      {conv.title || "Untitled conversation"}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                      {formatDistanceToNow(new Date(conv.updated_at), {
                                        addSuffix: true,
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                              {!isCollapsed && (
                                <div className="flex shrink-0 items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEditing(conv);
                                    }}
                                    aria-label="Rename"
                                    title="Rename"
                                    className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-blue-600"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPendingDeleteId(conv.id);
                                    }}
                                    aria-label="Delete"
                                    title="Delete"
                                    className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-destructive/10 text-red-600"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <AlertDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation and all its messages. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) handleDelete(pendingDeleteId);
                setPendingDeleteId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  );
}
