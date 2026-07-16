import { useEffect, useMemo, useState } from "react";
import { Globe, Plus, Trash2, FolderPlus, ExternalLink, ChevronRight, ChevronDown, Pencil, X, Cloud, CloudOff, Check, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Bookmark = { id: string; name: string; url: string };
type Folder = { id: string; name: string; bookmarks: Bookmark[] };

const STORAGE_KEY = "online-service-bookmarks:v1";

function loadLocal(): Folder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveLocal(folders: Folder[]) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(folders)); } catch { /* ignore */ }
}
function newId() { return Math.random().toString(36).slice(2, 10); }
function normalizeUrl(u: string) {
  const t = u.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function OnlineServiceHeaderButton() {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newFolderName, setNewFolderName] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editingBookmark, setEditingBookmark] = useState<string | null>(null);
  const [editBmName, setEditBmName] = useState("");
  const [editBmUrl, setEditBmUrl] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFolders(loadLocal());
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess.session?.user?.id ?? null;
        setUserId(uid);
        if (!uid) { setCloudReady(false); return; }
        const { data, error } = await supabase
          .from("user_online_service" as never)
          .select("data")
          .eq("scope", "shared")
          .maybeSingle();
        if (error) throw error;
        const remote = (data as { data?: Folder[] } | null)?.data;
        if (Array.isArray(remote)) {
          setFolders(remote);
          saveLocal(remote);
        } else {
          const local = loadLocal();
          if (local.length > 0) {
            await supabase.from("user_online_service" as never).upsert({ scope: "shared", user_id: uid, data: local, updated_at: new Date().toISOString() } as never, { onConflict: "scope" } as never);
          }
        }
        setCloudReady(true);
        channel = supabase
          .channel("shared_online_service")
          .on("postgres_changes", { event: "*", schema: "public", table: "user_online_service" }, (payload) => {
            const row = (payload.new ?? payload.old) as { data?: Folder[] } | null;
            if (row && Array.isArray(row.data)) {
              setFolders(row.data);
              saveLocal(row.data);
            }
          })
          .subscribe();
      } catch (e) {
        console.error("[OnlineService] cloud load failed", e);
        setCloudReady(false);
      }
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [open]);

  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (cloudReady) setDirty(true); }, [folders, cloudReady]);
  useEffect(() => {
    if (!open || !cloudReady || !userId || !dirty) return;
    const t = window.setTimeout(async () => {
      try {
        await supabase.from("user_online_service" as never).upsert({
          scope: "shared", user_id: userId, data: folders, updated_at: new Date().toISOString(),
        } as never, { onConflict: "scope" } as never);
        setDirty(false);
      } catch (e) {
        console.error("[OnlineService] cloud save failed", e);
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [folders, cloudReady, userId, open, dirty]);

  const persist = (next: Folder[]) => {
    setFolders(next);
    saveLocal(next);
  };

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) { toast.error("ফোল্ডারের নাম দিন"); return; }
    const nf = { id: newId(), name, bookmarks: [] };
    persist([...folders, nf]);
    setNewFolderName("");
    toast.success("ফোল্ডার তৈরি হয়েছে");
  };

  const removeFolder = (id: string) => {
    if (!confirm("এই ফোল্ডারটি এবং এর সকল বুকমার্ক মুছে ফেলবেন?")) return;
    persist(folders.filter((f) => f.id !== id));
  };

  const renameFolder = (id: string) => {
    const name = editFolderName.trim();
    if (!name) return;
    persist(folders.map((f) => (f.id === id ? { ...f, name } : f)));
    setEditingFolder(null);
    setEditFolderName("");
  };

  const addBookmark = (folderId: string) => {
    const name = linkName.trim();
    const url = normalizeUrl(linkUrl);
    if (!name || !url) { toast.error("নাম ও URL দিন"); return; }
    persist(folders.map((f) => f.id === folderId ? { ...f, bookmarks: [...f.bookmarks, { id: newId(), name, url }] } : f));
    setLinkName(""); setLinkUrl(""); setAddingTo(null);
    toast.success("লিংক সেভ হয়েছে");
  };

  const startEditBookmark = (b: Bookmark) => {
    setEditingBookmark(b.id);
    setEditBmName(b.name);
    setEditBmUrl(b.url);
  };

  const saveEditBookmark = (folderId: string, bmId: string) => {
    const name = editBmName.trim();
    const url = normalizeUrl(editBmUrl);
    if (!name || !url) { toast.error("নাম ও URL দিন"); return; }
    persist(folders.map((f) => f.id === folderId
      ? { ...f, bookmarks: f.bookmarks.map((b) => b.id === bmId ? { ...b, name, url } : b) }
      : f));
    setEditingBookmark(null);
    setEditBmName(""); setEditBmUrl("");
    toast.success("লিংক আপডেট হয়েছে");
  };

  const removeBookmark = (folderId: string, bmId: string) => {
    persist(folders.map((f) => f.id === folderId ? { ...f, bookmarks: f.bookmarks.filter((b) => b.id !== bmId) } : f));
  };

  const totalCount = useMemo(() => folders.reduce((s, f) => s + f.bookmarks.length, 0), [folders]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Online Service" title="Online Service">
          <Globe className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-4">
        <SheetHeader className="pr-8">
          <SheetTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-sky-400" />
            Online Service
            <span className="ml-auto text-[10px] flex items-center gap-1 text-muted-foreground font-normal">
              {cloudReady ? (<><Cloud className="h-3 w-3 text-emerald-500" /> সবাই দেখবে</>) : (<><CloudOff className="h-3 w-3 text-amber-500" /> শুধু এই ডিভাইসে</>)}
            </span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            {folders.length} ফোল্ডার · {totalCount} লিংক — সকল ব্যবহারকারীর জন্য শেয়ার করা
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-border p-3 bg-muted/20 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">নতুন ফোল্ডার</label>
            <Input
              placeholder="ফোল্ডারের নাম লিখুন"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFolder(); } }}
            />
            <Button onClick={addFolder} size="sm" className="w-full" type="button">
              <FolderPlus className="h-4 w-4 mr-1" /> ফোল্ডার তৈরি করুন
            </Button>
          </div>

          {folders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              এখনো কোনো ফোল্ডার নেই। উপরে থেকে নতুন ফোল্ডার তৈরি করুন।
            </p>
          ) : (
            <div className="space-y-2">
              {folders.map((f) => {
                const isOpen = expanded[f.id] ?? false;
                return (
                  <div key={f.id} className="border border-border rounded-md group/folder">
                    <div className="flex items-center gap-1 p-1 bg-muted/30">
                      {editingFolder === f.id ? (
                        <>
                          <Input
                            className="h-8 flex-1"
                            value={editFolderName}
                            onChange={(e) => setEditFolderName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); renameFolder(f.id); } }}
                            autoFocus
                          />
                          <Button type="button" size="sm" variant="secondary" className="h-8 px-2" onClick={() => renameFolder(f.id)}>OK</Button>
                          <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setEditingFolder(null); setEditFolderName(""); }}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setExpanded((s) => ({ ...s, [f.id]: !isOpen }))}
                            className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-muted text-left"
                            title="ক্লিক করুন খুলতে/বন্ধ করতে"
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                            <span className="text-sm font-medium truncate">
                              {f.name} <span className="text-xs text-muted-foreground">({f.bookmarks.length})</span>
                            </span>
                          </button>
                          {/* Actions collapsed inside a small 3-dot menu */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="p-1.5 hover:bg-muted rounded" title="আরও অপশন" aria-label="More options">
                                <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-auto p-1 flex items-center gap-0.5">
                              <button type="button" onClick={() => { setEditingFolder(f.id); setEditFolderName(f.name); }} className="p-1.5 hover:bg-muted rounded" title="নাম পরিবর্তন">
                                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                              <button type="button" onClick={() => { setExpanded((s) => ({ ...s, [f.id]: true })); setAddingTo(addingTo === f.id ? null : f.id); }} className="p-1.5 hover:bg-muted rounded" title="লিংক যোগ">
                                <Plus className="h-3.5 w-3.5 text-emerald-500" />
                              </button>
                              <button type="button" onClick={() => removeFolder(f.id)} className="p-1.5 hover:bg-muted rounded" title="ফোল্ডার মুছুন">
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </button>
                            </PopoverContent>
                          </Popover>
                        </>
                      )}
                    </div>

                    {isOpen && (
                      <div className="p-2 space-y-1">
                        {addingTo === f.id && (
                          <div className="p-2 border border-dashed border-border rounded-md space-y-2 mb-2 bg-muted/20">
                            <Input placeholder="সাইটের নাম (যেমন BMET Portal)" value={linkName} onChange={(e) => setLinkName(e.target.value)} className="h-9" />
                            <Input placeholder="https://example.com" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBookmark(f.id); } }} className="h-9" />
                            <div className="flex gap-2">
                              <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => { setAddingTo(null); setLinkName(""); setLinkUrl(""); }}>
                                <X className="h-4 w-4 mr-1" /> বাতিল
                              </Button>
                              <Button type="button" size="sm" className="flex-1" onClick={() => addBookmark(f.id)}>
                                <Plus className="h-4 w-4 mr-1" /> সেভ
                              </Button>
                            </div>
                          </div>
                        )}
                        {f.bookmarks.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-2 py-1">এই ফোল্ডারে কোনো লিংক নেই।</p>
                        ) : (
                          f.bookmarks.map((b) => (
                            <div key={b.id} className="flex items-center gap-1 group/bm hover:bg-muted/50 rounded px-1">
                              {editingBookmark === b.id ? (
                                <div className="flex-1 space-y-1 py-1.5">
                                  <Input value={editBmName} onChange={(e) => setEditBmName(e.target.value)} className="h-8 text-xs" placeholder="নাম" autoFocus />
                                  <Input value={editBmUrl} onChange={(e) => setEditBmUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEditBookmark(f.id, b.id); } }} className="h-8 text-xs" placeholder="https://..." />
                                  <div className="flex gap-1">
                                    <Button type="button" size="sm" variant="secondary" className="h-7 px-2 flex-1" onClick={() => saveEditBookmark(f.id, b.id)}>
                                      <Check className="h-3.5 w-3.5 mr-1" /> সেভ
                                    </Button>
                                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditingBookmark(null); }}>
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <a href={b.url} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center gap-2 text-sm py-2 truncate" title={b.url}>
                                    <ExternalLink className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                                    <span className="truncate">{b.name}</span>
                                  </a>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <button type="button" className="p-1.5 hover:bg-muted rounded" title="আরও অপশন" aria-label="More options">
                                        <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-auto p-1 flex items-center gap-0.5">
                                      <button type="button" onClick={() => startEditBookmark(b)} className="p-1.5 hover:bg-muted rounded" aria-label="Edit link" title="লিংক পরিবর্তন">
                                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                      </button>
                                      <button type="button" onClick={() => removeBookmark(f.id, b.id)} className="p-1.5 hover:bg-muted rounded" aria-label="Delete link" title="লিংক মুছুন">
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                      </button>
                                    </PopoverContent>
                                  </Popover>
                                </>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
